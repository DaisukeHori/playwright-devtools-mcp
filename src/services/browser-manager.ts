import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from "playwright";
import { DEFAULT_TIMEOUT, DEFAULT_VIEWPORT, MAX_CONSOLE_LOGS } from "../constants.js";
import type { ConsoleLogEntry } from "../types.js";
import crypto from "crypto";

// ─── Full-fidelity network capture via CDP ──────────────────────
export interface CapturedRequest {
  requestId: string;
  seq: number;
  url: string;
  method: string;
  resourceType: string;
  requestHeaders: Record<string, string>;
  requestPostData?: string;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  responseBody?: string;
  responseBase64Encoded?: boolean;
  responseSize?: number;
  timing?: Record<string, number>;
  wallTimeMs?: number;
  failed?: boolean;
  failureText?: string;
  timestamp: number;
  cookies?: Array<{ name: string; value: string }>;
  isApiCall: boolean;
  initiator?: string;
  redirectedFrom?: string;
}

// ─── Flow recording ─────────────────────────────────────────────
export interface FlowStep {
  seq: number;
  action: string;
  description: string;
  request?: CapturedRequest;
  timestamp: number;
}

export interface BrowserSession {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdpSession: CDPSession;
  consoleLogs: ConsoleLogEntry[];
  capturedRequests: Map<string, CapturedRequest>;
  requestSeq: number;
  flow: FlowStep[];
  flowRecording: boolean;
  excludePatterns: RegExp[];
  createdAt: number;
}

class BrowserManager {
  private sessions: Map<string, BrowserSession> = new Map();

  async createSession(options?: {
    headless?: boolean;
    viewport?: { width: number; height: number };
    userAgent?: string;
    locale?: string;
    timezoneId?: string;
    extraHTTPHeaders?: Record<string, string>;
    excludePatterns?: string[];
  }): Promise<BrowserSession> {
    const id = `session-${crypto.randomUUID().slice(0, 8)}`;

    const browser = await chromium.launch({
      headless: options?.headless ?? true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });

    const context = await browser.newContext({
      viewport: options?.viewport ?? DEFAULT_VIEWPORT,
      userAgent: options?.userAgent,
      locale: options?.locale ?? "ja-JP",
      timezoneId: options?.timezoneId ?? "Asia/Tokyo",
      extraHTTPHeaders: options?.extraHTTPHeaders,
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();
    page.setDefaultTimeout(DEFAULT_TIMEOUT);
    const cdpSession = await page.context().newCDPSession(page);

    const defaultExcludes = [
      /google-analytics\.com/, /googletagmanager\.com/, /doubleclick\.net/,
      /facebook\.net.*\/tr/, /hotjar\.com/, /clarity\.ms/,
    ];
    const userExcludes = (options?.excludePatterns ?? []).map((p) => new RegExp(p));

    const session: BrowserSession = {
      id, browser, context, page, cdpSession,
      consoleLogs: [],
      capturedRequests: new Map(),
      requestSeq: 0,
      flow: [],
      flowRecording: false,
      excludePatterns: [...defaultExcludes, ...userExcludes],
      createdAt: Date.now(),
    };

    await this.setupCDPNetworkCapture(session);
    this.setupConsoleCollection(session);
    await this.enableCDPDomains(session);

    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): BrowserSession | undefined { return this.sessions.get(id); }

  getOrThrow(id: string): BrowserSession {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session '${id}' not found. Use browser_launch first. Active: ${[...this.sessions.keys()].join(", ") || "none"}`);
    }
    return session;
  }

  listSessions(): Array<{ id: string; createdAt: number; url: string; capturedRequests: number; flowSteps: number }> {
    return [...this.sessions.entries()].map(([id, s]) => ({
      id, createdAt: s.createdAt, url: s.page.url(),
      capturedRequests: s.capturedRequests.size, flowSteps: s.flow.length,
    }));
  }

  async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      await session.cdpSession.detach().catch(() => {});
      await session.context.close().catch(() => {});
      await session.browser.close().catch(() => {});
    } finally { this.sessions.delete(id); }
  }

  async closeAllSessions(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.closeSession(id);
  }

  addFlowStep(session: BrowserSession, action: string, description: string, request?: CapturedRequest): void {
    if (!session.flowRecording) return;
    session.flow.push({ seq: session.flow.length + 1, action, description, request, timestamp: Date.now() });
  }

  getApiCalls(session: BrowserSession): CapturedRequest[] {
    return [...session.capturedRequests.values()].filter((r) => r.isApiCall).sort((a, b) => a.seq - b.seq);
  }

  // ─── CDP Network Capture (generic event listener) ─────────────
  private async setupCDPNetworkCapture(session: BrowserSession): Promise<void> {
    const cdp = session.cdpSession;
    await cdp.send("Network.enable", { maxPostDataSize: 1048576 });

    // Use generic "event" listener to avoid TypeScript overload issues
    cdp.on("event", (data: { method: string; params?: Object }) => { const d = data as { method: string; params?: Object }; void 0; }); // @ts-ignore
    cdp.on("event", (data: { method: string; params?: Object }) => {
      if (!data.params) return;
      const p = data.params as Record<string, unknown>;

      switch (data.method) {
        case "Network.requestWillBeSent": {
          const req = p.request as Record<string, unknown>;
          const url = req.url as string;
          if (session.excludePatterns.some((pat) => pat.test(url))) return;

          const headers = (req.headers ?? {}) as Record<string, string>;
          const resType = (p.type ?? "Other") as string;
          const isApiCall = ["XHR", "Fetch"].includes(resType) ||
            headers["content-type"]?.includes("application/json") ||
            headers["accept"]?.includes("application/json");

          const entry: CapturedRequest = {
            requestId: p.requestId as string,
            seq: ++session.requestSeq,
            url,
            method: req.method as string,
            resourceType: resType,
            requestHeaders: headers,
            requestPostData: (req.postData as string) ?? undefined,
            timestamp: Date.now(),
            isApiCall,
            initiator: (p.initiator as Record<string, unknown>)?.type as string | undefined,
            redirectedFrom: (p.redirectResponse as Record<string, unknown>)?.url as string | undefined,
          };

          const cookieHeader = headers["cookie"] || headers["Cookie"];
          if (cookieHeader) {
            entry.cookies = cookieHeader.split(";").map((c) => {
              const [name, ...rest] = c.trim().split("=");
              return { name: name.trim(), value: rest.join("=").trim() };
            });
          }

          session.capturedRequests.set(entry.requestId, entry);
          if (session.capturedRequests.size > 2000) {
            const oldest = session.capturedRequests.keys().next().value;
            if (oldest) session.capturedRequests.delete(oldest);
          }
          break;
        }

        case "Network.responseReceived": {
          const resp = p.response as Record<string, unknown>;
          const entry = session.capturedRequests.get(p.requestId as string);
          if (!entry) return;
          entry.status = resp.status as number;
          entry.statusText = resp.statusText as string;
          entry.responseHeaders = (resp.headers ?? {}) as Record<string, string>;
          entry.mimeType = resp.mimeType as string;
          if (resp.timing) entry.timing = resp.timing as Record<string, number>;
          break;
        }

        case "Network.loadingFinished": {
          const entry = session.capturedRequests.get(p.requestId as string);
          if (!entry) return;
          entry.responseSize = p.encodedDataLength as number;

          const shouldCapture = entry.isApiCall ||
            (entry.mimeType && (
              entry.mimeType.includes("json") || entry.mimeType.includes("xml") ||
              entry.mimeType.includes("html") || entry.mimeType.includes("text")
            ) && (entry.responseSize ?? 0) < 5_000_000);

          if (shouldCapture) {
            cdp.send("Network.getResponseBody", { requestId: p.requestId as string })
              .then((result: unknown) => {
                const r = result as { body: string; base64Encoded: boolean };
                entry.responseBody = r.body;
                entry.responseBase64Encoded = r.base64Encoded;
                if (entry.isApiCall && session.flowRecording) {
                  try {
                    const pathname = new URL(entry.url).pathname;
                    this.addFlowStep(session, "api_call", `${entry.method} ${pathname} → ${entry.status}`, entry);
                  } catch { /* bad URL */ }
                }
              })
              .catch(() => {});
          }
          break;
        }

        case "Network.loadingFailed": {
          const entry = session.capturedRequests.get(p.requestId as string);
          if (!entry) return;
          entry.failed = true;
          entry.failureText = p.errorText as string;
          break;
        }
      }
    });
  }

  // ─── Console Collection ───────────────────────────────────────
  private setupConsoleCollection(session: BrowserSession): void {
    session.page.on("console", (msg) => {
      session.consoleLogs.push({
        type: msg.type(), text: msg.text(), timestamp: Date.now(),
        url: msg.location().url || undefined,
        lineNumber: msg.location().lineNumber,
        columnNumber: msg.location().columnNumber,
      });
      if (session.consoleLogs.length > MAX_CONSOLE_LOGS) session.consoleLogs.shift();
    });
    session.page.on("pageerror", (error) => {
      session.consoleLogs.push({ type: "error", text: error.message, timestamp: Date.now(), stackTrace: error.stack });
      if (session.consoleLogs.length > MAX_CONSOLE_LOGS) session.consoleLogs.shift();
    });
  }

  // ─── CDP Domain Enablement ────────────────────────────────────
  private async enableCDPDomains(session: BrowserSession): Promise<void> {
    const cdp = session.cdpSession;
    for (const domain of ["Runtime", "Performance", "Log", "Security", "DOM", "CSS"]) {
      try { await cdp.send(`${domain}.enable` as "Runtime.enable"); } catch { /* OK */ }
    }
    cdp.on("event", (data: { method: string; params?: Object }) => { const d = data as { method: string; params?: Object }; void 0; }); // @ts-ignore
    cdp.on("event", (data: { method: string; params?: Object }) => {
      if (data.method === "Log.entryAdded" && data.params) {
        const entry = ((data.params ?? {}) as Record<string, unknown>).entry as Record<string, unknown>;
        session.consoleLogs.push({
          type: entry.level as string,
          text: `[${entry.source}] ${entry.text}`,
          timestamp: entry.timestamp as number,
          url: entry.url as string | undefined,
          lineNumber: entry.lineNumber as number | undefined,
        });
        if (session.consoleLogs.length > MAX_CONSOLE_LOGS) session.consoleLogs.shift();
      }
    });
  }
}

export const browserManager = new BrowserManager();
