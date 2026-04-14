import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager, type CapturedRequest, type FlowStep } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerFlowTools(server: McpServer): void {
  // ─── flow_start_recording ──────────────────────────────────────
  server.registerTool(
    "flow_start_recording",
    {
      title: "Start Flow Recording",
      description: `Start recording a user workflow. All subsequent browser actions and API calls (XHR/fetch) will be captured as ordered flow steps.
Use this when beginning to trace a user's browser workflow for reverse engineering.

Args:
  - session_id (string): Browser session ID
  - flow_name (string, optional): Name for this flow (default: "Untitled Flow")
  - capture_static (boolean, optional): Also capture static resources like images/CSS (default: false, usually you only want API calls)

Returns:
  { recording: true, flowName: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        flow_name: z.string().default("Untitled Flow").describe("Name for this flow"),
        capture_static: z.boolean().default(false).describe("Also capture non-API requests"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        session.flowRecording = true;
        session.flow = [];
        browserManager.addFlowStep(session, "start", `Flow recording started: ${params.flow_name}`);
        return makeSuccess(params.session_id, { recording: true, flowName: params.flow_name }, start);
      } catch (err) {
        return makeError(params.session_id, "FLOW_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── flow_stop_recording ───────────────────────────────────────
  server.registerTool(
    "flow_stop_recording",
    {
      title: "Stop Flow Recording",
      description: `Stop recording the workflow. Returns a summary of captured steps.

Args:
  - session_id (string): Browser session ID

Returns:
  { recording: false, totalSteps: number, apiCalls: number, summary: FlowStep[] }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        session.flowRecording = false;
        browserManager.addFlowStep(session, "stop", "Flow recording stopped");

        const apiSteps = session.flow.filter((s) => s.action === "api_call");
        const summary = session.flow.map((s) => ({
          seq: s.seq,
          action: s.action,
          description: s.description,
          timestamp: s.timestamp,
        }));

        return makeSuccess(params.session_id, {
          recording: false,
          totalSteps: session.flow.length,
          apiCalls: apiSteps.length,
          summary,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "FLOW_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── flow_add_step ─────────────────────────────────────────────
  server.registerTool(
    "flow_add_step",
    {
      title: "Add Flow Step (Annotation)",
      description: `Manually add a descriptive step to the flow recording. Use this to annotate what the user is doing (e.g. "ログイン画面でユーザー名を入力").

Args:
  - session_id (string): Browser session ID
  - description (string): Description of what the user is doing

Returns:
  { added: true, stepSeq: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        description: z.string().describe("Step description"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const seq = session.flow.length + 1;
        session.flow.push({
          seq,
          action: "annotation",
          description: params.description,
          timestamp: Date.now(),
        });
        return makeSuccess(params.session_id, { added: true, stepSeq: seq }, start);
      } catch (err) {
        return makeError(params.session_id, "FLOW_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── flow_get_steps ────────────────────────────────────────────
  server.registerTool(
    "flow_get_steps",
    {
      title: "Get Flow Steps",
      description: `Get the recorded flow steps. Use action_filter to see only API calls, annotations, or navigations.

Args:
  - session_id (string): Browser session ID
  - action_filter (string, optional): Filter by action type: "api_call", "navigate", "annotation", "click", "type"
  - include_request_details (boolean, optional): Include full request/response data (default: false, for summary only)

Returns:
  { steps: FlowStep[], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        action_filter: z.string().optional().describe("Filter by action type"),
        include_request_details: z.boolean().default(false).describe("Include full request data"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let steps = [...session.flow];

        if (params.action_filter) {
          steps = steps.filter((s) => s.action === params.action_filter);
        }

        const mapped = steps.map((s) => {
          const base: Record<string, unknown> = {
            seq: s.seq,
            action: s.action,
            description: s.description,
            timestamp: s.timestamp,
          };
          if (params.include_request_details && s.request) {
            base.request = {
              method: s.request.method,
              url: s.request.url,
              status: s.request.status,
              requestHeaders: s.request.requestHeaders,
              requestPostData: s.request.requestPostData,
              responseHeaders: s.request.responseHeaders,
              responseBody: s.request.responseBody?.slice(0, 5000),
              mimeType: s.request.mimeType,
              cookies: s.request.cookies,
            };
          }
          return base;
        });

        return makeSuccess(params.session_id, { steps: mapped, count: mapped.length }, start);
      } catch (err) {
        return makeError(params.session_id, "FLOW_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── flow_get_captured_api_calls ───────────────────────────────
  server.registerTool(
    "flow_get_captured_api_calls",
    {
      title: "Get Captured API Calls",
      description: `Get all captured XHR/fetch API calls with full request and response details. This is the raw data for generating API specs.

Args:
  - session_id (string): Browser session ID
  - url_filter (string, optional): Filter by URL substring
  - method_filter (string, optional): Filter by HTTP method
  - include_bodies (boolean, optional): Include request/response bodies (default: true)
  - max_body_length (number, optional): Max body length per request (default: 10000)

Returns:
  { apiCalls: CapturedRequest[], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_filter: z.string().optional().describe("Filter by URL substring"),
        method_filter: z.string().optional().describe("Filter by HTTP method"),
        include_bodies: z.boolean().default(true).describe("Include bodies"),
        max_body_length: z.number().int().min(0).max(100000).default(10000).describe("Max body length"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let calls = browserManager.getApiCalls(session);

        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          calls = calls.filter((c) => c.url.toLowerCase().includes(needle));
        }
        if (params.method_filter) {
          const method = params.method_filter.toUpperCase();
          calls = calls.filter((c) => c.method === method);
        }

        const mapped = calls.map((c) => ({
          seq: c.seq,
          method: c.method,
          url: c.url,
          status: c.status,
          statusText: c.statusText,
          mimeType: c.mimeType,
          requestHeaders: c.requestHeaders,
          requestPostData: params.include_bodies ? c.requestPostData?.slice(0, params.max_body_length) : undefined,
          responseHeaders: c.responseHeaders,
          responseBody: params.include_bodies ? c.responseBody?.slice(0, params.max_body_length) : undefined,
          responseSize: c.responseSize,
          cookies: c.cookies,
          failed: c.failed,
          failureText: c.failureText,
          timestamp: c.timestamp,
        }));

        return makeSuccess(params.session_id, { apiCalls: mapped, count: mapped.length }, start);
      } catch (err) {
        return makeError(params.session_id, "FLOW_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── generate_curl_commands ────────────────────────────────────
  server.registerTool(
    "generate_curl_commands",
    {
      title: "Generate curl Commands",
      description: `Generate curl commands that reproduce all captured API calls. This is the primary output for reverse engineering.
Each API call becomes a self-contained curl command with all headers, cookies, and body data.

Args:
  - session_id (string): Browser session ID
  - url_filter (string, optional): Only generate for URLs matching this substring
  - include_common_headers (boolean, optional): Include all headers (default: false = only essential headers like Auth, Content-Type, Cookie)
  - shell (string, optional): Shell format - "bash", "powershell" (default: "bash")

Returns:
  { commands: [{ seq, description, curl }], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_filter: z.string().optional().describe("Filter URLs"),
        include_common_headers: z.boolean().default(false).describe("Include all headers"),
        shell: z.enum(["bash", "powershell"]).default("bash").describe("Shell format"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let calls = browserManager.getApiCalls(session);

        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          calls = calls.filter((c) => c.url.toLowerCase().includes(needle));
        }

        // Essential headers to always include
        const essentialHeaders = new Set([
          "authorization", "content-type", "accept", "cookie",
          "x-csrf-token", "x-requested-with", "x-api-key",
          "origin", "referer",
        ]);

        const commands = calls.map((c) => {
          const parts: string[] = ["curl"];

          // Method
          if (c.method !== "GET") {
            parts.push(`-X ${c.method}`);
          }

          // URL
          parts.push(`'${c.url}'`);

          // Headers
          for (const [key, value] of Object.entries(c.requestHeaders)) {
            const lk = key.toLowerCase();
            if (params.include_common_headers || essentialHeaders.has(lk)) {
              // Skip host (derived from URL) and some internal headers
              if (lk === "host" || lk === "connection" || lk === "accept-encoding" || lk === "content-length") continue;
              parts.push(`-H '${key}: ${value.replace(/'/g, "'\\''")}'`);
            }
          }

          // Body
          if (c.requestPostData) {
            // Check if it's JSON
            try {
              JSON.parse(c.requestPostData);
              parts.push(`-d '${c.requestPostData.replace(/'/g, "'\\''")}'`);
            } catch {
              // Form data or other
              parts.push(`--data-raw '${c.requestPostData.replace(/'/g, "'\\''")}'`);
            }
          }

          const separator = params.shell === "bash" ? " \\\n  " : " `\n  ";
          const curl = parts.join(separator);

          return {
            seq: c.seq,
            description: `${c.method} ${new URL(c.url).pathname} → ${c.status ?? "pending"}`,
            curl,
            response_preview: c.responseBody?.slice(0, 200),
          };
        });

        return makeSuccess(params.session_id, { commands, count: commands.length }, start);
      } catch (err) {
        return makeError(params.session_id, "GENERATE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── generate_python_requests ──────────────────────────────────
  server.registerTool(
    "generate_python_requests",
    {
      title: "Generate Python requests Code",
      description: `Generate Python code using the 'requests' library that reproduces all captured API calls as a complete, runnable script.
Includes session management for cookies, proper headers, and error handling.

Args:
  - session_id (string): Browser session ID
  - url_filter (string, optional): Only generate for URLs matching this substring
  - use_session (boolean, optional): Use requests.Session() for cookie persistence (default: true)

Returns:
  { code: string, callCount: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_filter: z.string().optional().describe("Filter URLs"),
        use_session: z.boolean().default(true).describe("Use requests.Session()"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let calls = browserManager.getApiCalls(session);

        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          calls = calls.filter((c) => c.url.toLowerCase().includes(needle));
        }

        const lines: string[] = [
          `"""`,
          `Auto-generated API replay script`,
          `Generated: ${new Date().toISOString()}`,
          `Source URL: ${session.page.url()}`,
          `Total API calls: ${calls.length}`,
          `"""`,
          `import requests`,
          `import json`,
          ``,
        ];

        if (params.use_session) {
          lines.push(`session = requests.Session()`);
          lines.push(``);
        }

        // Extract common base URL
        const urls = calls.map((c) => new URL(c.url));
        const origins = [...new Set(urls.map((u) => u.origin))];
        if (origins.length === 1) {
          lines.push(`BASE_URL = "${origins[0]}"`);
          lines.push(``);
        }

        // Essential headers to include
        const skipHeaders = new Set([
          "host", "connection", "accept-encoding", "content-length",
          "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-ch-ua",
          "sec-ch-ua-mobile", "sec-ch-ua-platform",
        ]);

        for (let i = 0; i < calls.length; i++) {
          const c = calls[i];
          const parsedUrl = new URL(c.url);
          const urlStr = origins.length === 1
            ? `BASE_URL + "${parsedUrl.pathname}${parsedUrl.search}"`
            : `"${c.url}"`;

          lines.push(`# Step ${i + 1}: ${c.method} ${parsedUrl.pathname} → ${c.status ?? "?"}`);

          // Headers
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(c.requestHeaders)) {
            if (!skipHeaders.has(key.toLowerCase())) {
              headers[key] = value;
            }
          }

          const caller = params.use_session ? "session" : "requests";
          const method = c.method.toLowerCase();

          if (c.requestPostData) {
            let bodyArg: string;
            try {
              const parsed = JSON.parse(c.requestPostData);
              lines.push(`payload_${i + 1} = ${JSON.stringify(parsed, null, 2)}`);
              bodyArg = `json=payload_${i + 1}`;
            } catch {
              lines.push(`data_${i + 1} = ${JSON.stringify(c.requestPostData)}`);
              bodyArg = `data=data_${i + 1}`;
            }

            lines.push(`headers_${i + 1} = ${JSON.stringify(headers, null, 2)}`);
            lines.push(`resp_${i + 1} = ${caller}.${method}(${urlStr}, ${bodyArg}, headers=headers_${i + 1})`);
          } else {
            if (Object.keys(headers).length > 0) {
              lines.push(`headers_${i + 1} = ${JSON.stringify(headers, null, 2)}`);
              lines.push(`resp_${i + 1} = ${caller}.${method}(${urlStr}, headers=headers_${i + 1})`);
            } else {
              lines.push(`resp_${i + 1} = ${caller}.${method}(${urlStr})`);
            }
          }

          lines.push(`print(f"Step ${i + 1}: {resp_${i + 1}.status_code} {resp_${i + 1}.url}")`);
          lines.push(``);
        }

        const code = lines.join("\n");
        return makeSuccess(params.session_id, { code, callCount: calls.length }, start);
      } catch (err) {
        return makeError(params.session_id, "GENERATE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── generate_api_spec ─────────────────────────────────────────
  server.registerTool(
    "generate_api_spec",
    {
      title: "Generate API Specification",
      description: `Generate a structured API specification document from captured API calls. Groups endpoints by path, extracts common patterns, documents request/response schemas.
Output is a structured Markdown or JSON document suitable for developer documentation.

Args:
  - session_id (string): Browser session ID
  - format (string, optional): Output format - "markdown" or "json" (default: "markdown")
  - url_filter (string, optional): Only include URLs matching this substring
  - group_by (string, optional): Grouping - "path" or "domain" (default: "path")

Returns:
  { spec: string, endpoints: number, format: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
        url_filter: z.string().optional().describe("Filter URLs"),
        group_by: z.enum(["path", "domain"]).default("path").describe("Grouping method"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let calls = browserManager.getApiCalls(session);

        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          calls = calls.filter((c) => c.url.toLowerCase().includes(needle));
        }

        // Group by endpoint (method + path pattern)
        interface EndpointInfo {
          method: string;
          pathPattern: string;
          examples: Array<{
            url: string;
            status: number | undefined;
            requestHeaders: Record<string, string>;
            requestBody?: string;
            responseHeaders?: Record<string, string>;
            responseBody?: string;
            mimeType?: string;
          }>;
        }
        const endpoints = new Map<string, EndpointInfo>();

        for (const c of calls) {
          const parsed = new URL(c.url);
          // Create path pattern (replace UUIDs and numbers with placeholders)
          const pathPattern = parsed.pathname
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{uuid}")
            .replace(/\/\d+/g, "/{id}")
            .replace(/\/{id}\/{id}/g, "/{id}");

          const key = `${c.method} ${parsed.origin}${pathPattern}`;

          if (!endpoints.has(key)) {
            endpoints.set(key, {
              method: c.method,
              pathPattern: `${parsed.origin}${pathPattern}`,
              examples: [],
            });
          }

          endpoints.get(key)!.examples.push({
            url: c.url,
            status: c.status,
            requestHeaders: c.requestHeaders,
            requestBody: c.requestPostData?.slice(0, 3000),
            responseHeaders: c.responseHeaders,
            responseBody: c.responseBody?.slice(0, 3000),
            mimeType: c.mimeType,
          });
        }

        if (params.format === "json") {
          const spec = Object.fromEntries(
            [...endpoints.entries()].map(([key, info]) => [
              key,
              {
                method: info.method,
                pathPattern: info.pathPattern,
                callCount: info.examples.length,
                examples: info.examples.slice(0, 3),
              },
            ])
          );
          return makeSuccess(params.session_id, { spec, endpoints: endpoints.size, format: "json" }, start);
        }

        // Markdown format
        const md: string[] = [
          `# API Specification`,
          ``,
          `Generated: ${new Date().toISOString()}`,
          `Source: ${session.page.url()}`,
          `Total endpoints: ${endpoints.size}`,
          `Total API calls captured: ${calls.length}`,
          ``,
          `---`,
          ``,
        ];

        for (const [key, info] of endpoints) {
          md.push(`## \`${info.method}\` ${info.pathPattern}`);
          md.push(``);
          md.push(`**Call count:** ${info.examples.length}`);
          md.push(``);

          const example = info.examples[0];
          if (!example) continue;

          md.push(`**Status:** ${example.status ?? "unknown"}`);
          md.push(`**Content-Type:** ${example.mimeType ?? "unknown"}`);
          md.push(``);

          // Request headers (essential ones)
          const essentialReqHeaders = ["authorization", "content-type", "accept", "cookie", "x-csrf-token", "x-api-key", "origin", "referer"];
          const relevantHeaders = Object.entries(example.requestHeaders)
            .filter(([k]) => essentialReqHeaders.includes(k.toLowerCase()));
          if (relevantHeaders.length > 0) {
            md.push(`### Request Headers`);
            md.push(`\`\`\``);
            for (const [k, v] of relevantHeaders) {
              md.push(`${k}: ${v.length > 100 ? v.slice(0, 100) + "…" : v}`);
            }
            md.push(`\`\`\``);
            md.push(``);
          }

          // Request body
          if (example.requestBody) {
            md.push(`### Request Body`);
            md.push(`\`\`\`json`);
            try {
              md.push(JSON.stringify(JSON.parse(example.requestBody), null, 2).slice(0, 2000));
            } catch {
              md.push(example.requestBody.slice(0, 2000));
            }
            md.push(`\`\`\``);
            md.push(``);
          }

          // Response body
          if (example.responseBody) {
            md.push(`### Response Body`);
            md.push(`\`\`\`json`);
            try {
              md.push(JSON.stringify(JSON.parse(example.responseBody), null, 2).slice(0, 2000));
            } catch {
              md.push(example.responseBody.slice(0, 2000));
            }
            md.push(`\`\`\``);
            md.push(``);
          }

          md.push(`---`);
          md.push(``);
        }

        const spec = md.join("\n");
        return makeSuccess(params.session_id, { spec, endpoints: endpoints.size, format: "markdown" }, start);
      } catch (err) {
        return makeError(params.session_id, "GENERATE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── generate_har ──────────────────────────────────────────────
  server.registerTool(
    "generate_har",
    {
      title: "Generate HAR (HTTP Archive)",
      description: `Generate a HAR 1.2 format export of all captured requests. HAR files can be imported into Chrome DevTools, Postman, Charles Proxy, etc.

Args:
  - session_id (string): Browser session ID
  - api_only (boolean, optional): Only include API calls (default: false)

Returns:
  { har: object (HAR 1.2), entryCount: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        api_only: z.boolean().default(false).describe("Only API calls"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const requests = params.api_only
          ? browserManager.getApiCalls(session)
          : [...session.capturedRequests.values()].sort((a, b) => a.seq - b.seq);

        const entries = requests.map((r) => {
          const parsedUrl = new URL(r.url);
          return {
            startedDateTime: new Date(r.timestamp).toISOString(),
            time: r.timing?.receiveHeadersEnd ? r.timing.receiveHeadersEnd - (r.timing.sendStart ?? 0) : -1,
            request: {
              method: r.method,
              url: r.url,
              httpVersion: "HTTP/1.1",
              cookies: (r.cookies ?? []).map((c) => ({ name: c.name, value: c.value })),
              headers: Object.entries(r.requestHeaders).map(([name, value]) => ({ name, value })),
              queryString: [...parsedUrl.searchParams.entries()].map(([name, value]) => ({ name, value })),
              postData: r.requestPostData
                ? {
                    mimeType: r.requestHeaders["content-type"] ?? "application/octet-stream",
                    text: r.requestPostData,
                  }
                : undefined,
              headersSize: -1,
              bodySize: r.requestPostData?.length ?? 0,
            },
            response: {
              status: r.status ?? 0,
              statusText: r.statusText ?? "",
              httpVersion: "HTTP/1.1",
              cookies: [],
              headers: r.responseHeaders
                ? Object.entries(r.responseHeaders).map(([name, value]) => ({ name, value }))
                : [],
              content: {
                size: r.responseSize ?? 0,
                mimeType: r.mimeType ?? "application/octet-stream",
                text: r.responseBody,
                encoding: r.responseBase64Encoded ? "base64" : undefined,
              },
              redirectURL: "",
              headersSize: -1,
              bodySize: r.responseSize ?? 0,
            },
            cache: {},
            timings: {
              send: 0,
              wait: r.timing ? (r.timing.receiveHeadersStart ?? 0) - (r.timing.sendEnd ?? 0) : -1,
              receive: r.timing ? (r.timing.receiveHeadersEnd ?? 0) - (r.timing.receiveHeadersStart ?? 0) : -1,
            },
          };
        });

        const har = {
          log: {
            version: "1.2",
            creator: { name: "playwright-devtools-mcp", version: "1.0.0" },
            browser: { name: "Chromium (Playwright)", version: "" },
            pages: [{
              startedDateTime: new Date(session.createdAt).toISOString(),
              id: "page_1",
              title: session.page.url(),
              pageTimings: {},
            }],
            entries,
          },
        };

        return makeSuccess(params.session_id, { har, entryCount: entries.length }, start);
      } catch (err) {
        return makeError(params.session_id, "GENERATE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── capture_get_all_requests ──────────────────────────────────
  server.registerTool(
    "capture_get_all_requests",
    {
      title: "Get All Captured Requests",
      description: `Get ALL captured network requests (not just API calls). Use filters to narrow down. Returns compact summaries by default.

Args:
  - session_id (string): Browser session ID
  - url_filter (string, optional): Filter by URL substring
  - resource_types (array, optional): Filter by types e.g. ["XHR", "Fetch", "Document", "Script", "Stylesheet", "Image"]
  - status_min (number, optional): Min status code
  - status_max (number, optional): Max status code
  - limit (number, optional): Max results (default: 200)

Returns:
  { requests: [], total: number, returned: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_filter: z.string().optional().describe("URL filter"),
        resource_types: z.array(z.string()).optional().describe("Resource type filter"),
        status_min: z.number().int().optional().describe("Min status"),
        status_max: z.number().int().optional().describe("Max status"),
        limit: z.number().int().min(1).max(1000).default(200).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let requests = [...session.capturedRequests.values()].sort((a, b) => a.seq - b.seq);

        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          requests = requests.filter((r) => r.url.toLowerCase().includes(needle));
        }
        if (params.resource_types) {
          const types = new Set(params.resource_types);
          requests = requests.filter((r) => types.has(r.resourceType));
        }
        if (params.status_min !== undefined) {
          requests = requests.filter((r) => r.status !== undefined && r.status >= params.status_min!);
        }
        if (params.status_max !== undefined) {
          requests = requests.filter((r) => r.status !== undefined && r.status <= params.status_max!);
        }

        const total = requests.length;
        requests = requests.slice(0, params.limit);

        const compact = requests.map((r) => ({
          seq: r.seq,
          method: r.method,
          url: r.url.length > 150 ? r.url.slice(0, 150) + "…" : r.url,
          status: r.status,
          resourceType: r.resourceType,
          mimeType: r.mimeType,
          responseSize: r.responseSize,
          isApiCall: r.isApiCall,
          failed: r.failed,
          hasBody: !!r.responseBody,
        }));

        return makeSuccess(params.session_id, { requests: compact, total, returned: compact.length }, start);
      } catch (err) {
        return makeError(params.session_id, "CAPTURE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── capture_get_request_detail ────────────────────────────────
  server.registerTool(
    "capture_get_request_detail",
    {
      title: "Get Captured Request Detail",
      description: `Get full details of a specific captured request including complete headers and response body.

Args:
  - session_id (string): Browser session ID
  - seq (number): Request sequence number from capture_get_all_requests
  - max_body_length (number, optional): Max body length to return (default: 50000)

Returns:
  Full CapturedRequest with all data`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        seq: z.number().int().describe("Request sequence number"),
        max_body_length: z.number().int().min(0).max(500000).default(50000).describe("Max body length"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const request = [...session.capturedRequests.values()].find((r) => r.seq === params.seq);

        if (!request) {
          return makeError(params.session_id, "NOT_FOUND", `Request seq=${params.seq} not found`);
        }

        const detail = {
          ...request,
          requestPostData: request.requestPostData?.slice(0, params.max_body_length),
          responseBody: request.responseBody?.slice(0, params.max_body_length),
          responseBodyTruncated: (request.responseBody?.length ?? 0) > params.max_body_length,
        };

        return makeSuccess(params.session_id, { request: detail }, start);
      } catch (err) {
        return makeError(params.session_id, "CAPTURE_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
