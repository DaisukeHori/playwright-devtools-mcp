import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { SessionIdSchema, makeSuccess, makeError } from "../schemas/shared.js";
import { DEFAULT_VIEWPORT } from "../constants.js";

export function registerBrowserTools(server: McpServer): void {
  // ─── browser_launch ─────────────────────────────────────────────
  server.registerTool(
    "browser_launch",
    {
      title: "Launch Browser",
      description: `Launch a new headless Chromium browser session with DevTools Protocol enabled.
Returns a session_id used by all other tools. CDP domains (Runtime, Network, Performance, Log, Security, DOM, CSS) are auto-enabled.

Args:
  - viewport_width (number, optional): Browser viewport width in px (default: 1280)
  - viewport_height (number, optional): Browser viewport height in px (default: 720)
  - user_agent (string, optional): Custom User-Agent string
  - locale (string, optional): Browser locale (default: "ja-JP")
  - timezone (string, optional): Timezone ID (default: "Asia/Tokyo")
  - extra_headers (object, optional): Extra HTTP headers to send with every request

Returns:
  { session_id: string, viewport: { width, height } }`,
      inputSchema: {
        viewport_width: z.number().int().min(320).max(3840).default(DEFAULT_VIEWPORT.width).describe("Viewport width in px"),
        viewport_height: z.number().int().min(240).max(2160).default(DEFAULT_VIEWPORT.height).describe("Viewport height in px"),
        user_agent: z.string().optional().describe("Custom User-Agent string"),
        locale: z.string().default("ja-JP").describe("Browser locale"),
        timezone: z.string().default("Asia/Tokyo").describe("Timezone ID"),
        extra_headers: z.record(z.string()).optional().describe("Extra HTTP headers"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = await browserManager.createSession({
          headless: true,
          viewport: { width: params.viewport_width, height: params.viewport_height },
          userAgent: params.user_agent,
          locale: params.locale,
          timezoneId: params.timezone,
          extraHTTPHeaders: params.extra_headers,
        });
        return makeSuccess(session.id, {
          session_id: session.id,
          viewport: { width: params.viewport_width, height: params.viewport_height },
        }, start);
      } catch (err) {
        return makeError("none", "LAUNCH_FAILED", `Failed to launch browser: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_navigate ───────────────────────────────────────────
  server.registerTool(
    "browser_navigate",
    {
      title: "Navigate to URL",
      description: `Navigate the browser to a URL and wait for the page to load.
Console logs and network requests are automatically captured during navigation.

Args:
  - session_id (string): Browser session ID
  - url (string): URL to navigate to
  - wait_until (string, optional): Wait condition - "load", "domcontentloaded", "networkidle", "commit" (default: "load")
  - timeout (number, optional): Navigation timeout in ms (default: 30000)

Returns:
  { url: string, title: string, status: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url: z.string().url().describe("URL to navigate to"),
        wait_until: z.enum(["load", "domcontentloaded", "networkidle", "commit"]).default("load").describe("Wait condition"),
        timeout: z.number().int().min(1000).max(120000).default(30000).describe("Timeout in ms"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const response = await session.page.goto(params.url, {
          waitUntil: params.wait_until,
          timeout: params.timeout,
        });
        const title = await session.page.title();
        // Record in flow
        browserManager.addFlowStep(session, "navigate", `Navigate to ${params.url} (${title})`);
        return makeSuccess(params.session_id, {
          url: session.page.url(),
          title,
          status: response?.status() ?? 0,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "NAVIGATION_FAILED", `Navigation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_screenshot ─────────────────────────────────────────
  server.registerTool(
    "browser_screenshot",
    {
      title: "Take Screenshot",
      description: `Capture a screenshot of the current page or a specific element.
Returns the image as base64-encoded PNG or JPEG.

Args:
  - session_id (string): Browser session ID
  - full_page (boolean, optional): Capture the full scrollable page (default: false)
  - selector (string, optional): CSS selector to screenshot a specific element
  - format (string, optional): Image format - "png" or "jpeg" (default: "png")
  - quality (number, optional): JPEG quality 0-100 (only for jpeg)

Returns:
  { format: string, base64: string, width: number, height: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        full_page: z.boolean().default(false).describe("Capture full scrollable page"),
        selector: z.string().optional().describe("CSS selector for element screenshot"),
        format: z.enum(["png", "jpeg"]).default("png").describe("Image format"),
        quality: z.number().int().min(0).max(100).optional().describe("JPEG quality"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let buffer: Buffer;

        if (params.selector) {
          const element = session.page.locator(params.selector);
          buffer = await element.screenshot({
            type: params.format,
            quality: params.format === "jpeg" ? params.quality : undefined,
          });
        } else {
          buffer = await session.page.screenshot({
            fullPage: params.full_page,
            type: params.format,
            quality: params.format === "jpeg" ? params.quality : undefined,
          });
        }

        const base64 = buffer.toString("base64");

        return {
          content: [
            {
              type: "image" as const,
              data: base64,
              mimeType: params.format === "png" ? "image/png" : "image/jpeg",
            },
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                data: { format: params.format, size: buffer.length },
                metadata: { timestamp: Date.now(), duration: Date.now() - start, sessionId: params.session_id },
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return makeError(params.session_id, "SCREENSHOT_FAILED", `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_close ──────────────────────────────────────────────
  server.registerTool(
    "browser_close",
    {
      title: "Close Browser Session",
      description: `Close a browser session and release all resources.

Args:
  - session_id (string): Browser session ID to close

Returns:
  { closed: true }`,
      inputSchema: SessionIdSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        await browserManager.closeSession(params.session_id);
        return makeSuccess(params.session_id, { closed: true }, start);
      } catch (err) {
        return makeError(params.session_id, "CLOSE_FAILED", `Close failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_list_sessions ──────────────────────────────────────
  server.registerTool(
    "browser_list_sessions",
    {
      title: "List Browser Sessions",
      description: `List all active browser sessions.

Returns:
  { sessions: [{ id: string, createdAt: number, url: string }] }`,
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      return makeSuccess("global", { sessions: browserManager.listSessions() });
    }
  );

  // ─── browser_click ──────────────────────────────────────────────
  server.registerTool(
    "browser_click",
    {
      title: "Click Element",
      description: `Click an element on the page by CSS selector.

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector for the element to click
  - button (string, optional): Mouse button - "left", "right", "middle" (default: "left")
  - click_count (number, optional): Number of clicks (default: 1, use 2 for double-click)
  - timeout (number, optional): Timeout in ms (default: 30000)

Returns:
  { clicked: true, selector: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector for element"),
        button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button"),
        click_count: z.number().int().min(1).max(3).default(1).describe("Click count"),
        timeout: z.number().int().min(0).max(60000).default(30000).describe("Timeout in ms"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        await session.page.click(params.selector, {
          button: params.button,
          clickCount: params.click_count,
          timeout: params.timeout,
        });
        browserManager.addFlowStep(session, "click", `Click "${params.selector}" (${params.button})`);
        return makeSuccess(params.session_id, { clicked: true, selector: params.selector }, start);
      } catch (err) {
        return makeError(params.session_id, "CLICK_FAILED", `Click failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_type ───────────────────────────────────────────────
  server.registerTool(
    "browser_type",
    {
      title: "Type Text",
      description: `Type text into an element (input, textarea, contenteditable).

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector for the element
  - text (string): Text to type
  - clear_first (boolean, optional): Clear existing content before typing (default: false)
  - delay (number, optional): Delay between key presses in ms (default: 0)

Returns:
  { typed: true, selector: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector for element"),
        text: z.string().describe("Text to type"),
        clear_first: z.boolean().default(false).describe("Clear existing content first"),
        delay: z.number().int().min(0).max(1000).default(0).describe("Delay between key presses in ms"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        if (params.clear_first) {
          await session.page.locator(params.selector).clear();
        }
        await session.page.locator(params.selector).pressSequentially(params.text, { delay: params.delay });
        browserManager.addFlowStep(session, "type", `Type "${params.text.slice(0, 30)}${params.text.length > 30 ? "…" : ""}" into "${params.selector}"`);
        return makeSuccess(params.session_id, { typed: true, selector: params.selector }, start);
      } catch (err) {
        return makeError(params.session_id, "TYPE_FAILED", `Type failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_evaluate ───────────────────────────────────────────
  server.registerTool(
    "browser_evaluate",
    {
      title: "Evaluate JavaScript",
      description: `Execute JavaScript code in the browser page context and return the result.
The expression is evaluated as-is. Use 'return' only inside functions.

Args:
  - session_id (string): Browser session ID
  - expression (string): JavaScript expression to evaluate

Returns:
  { result: any }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        expression: z.string().describe("JavaScript expression to evaluate"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const result = await session.page.evaluate(params.expression);
        return makeSuccess(params.session_id, { result }, start);
      } catch (err) {
        return makeError(params.session_id, "EVALUATE_FAILED", `JS evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── browser_wait ───────────────────────────────────────────────
  server.registerTool(
    "browser_wait",
    {
      title: "Wait for Condition",
      description: `Wait for a selector to appear, a timeout, or a specific page state.

Args:
  - session_id (string): Browser session ID
  - selector (string, optional): CSS selector to wait for
  - state (string, optional): Element state - "attached", "detached", "visible", "hidden" (default: "visible")
  - timeout (number, optional): Maximum wait time in ms (default: 30000)

Returns:
  { waited: true }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().optional().describe("CSS selector to wait for"),
        state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible").describe("Element state to wait for"),
        timeout: z.number().int().min(0).max(120000).default(30000).describe("Timeout in ms"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        if (params.selector) {
          await session.page.locator(params.selector).waitFor({ state: params.state, timeout: params.timeout });
        } else {
          await session.page.waitForTimeout(params.timeout);
        }
        return makeSuccess(params.session_id, { waited: true }, start);
      } catch (err) {
        return makeError(params.session_id, "WAIT_FAILED", `Wait failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
