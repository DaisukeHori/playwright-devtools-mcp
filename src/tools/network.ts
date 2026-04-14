import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerNetworkTools(server: McpServer): void {
  // ─── network_get_requests ──────────────────────────────────────
  server.registerTool(
    "network_get_requests",
    {
      title: "Get Network Requests",
      description: `Get captured network requests. All requests are captured via CDP with full fidelity.

Args:
  - session_id (string): Browser session ID
  - url_filter (string, optional): Filter by URL substring (case-insensitive)
  - method_filter (string, optional): Filter by HTTP method
  - resource_type (string, optional): Filter by type e.g. "XHR", "Fetch", "Document", "Script"
  - api_only (boolean, optional): Only show XHR/Fetch requests (default: false)
  - limit (number, optional): Max results (default: 100)

Returns:
  { requests: [], total: number, returned: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_filter: z.string().optional().describe("Filter by URL substring"),
        method_filter: z.string().optional().describe("Filter by HTTP method"),
        resource_type: z.string().optional().describe("Filter by resource type"),
        api_only: z.boolean().default(false).describe("Only XHR/Fetch"),
        limit: z.number().int().min(1).max(500).default(100).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let requests = [...session.capturedRequests.values()].sort((a, b) => a.seq - b.seq);

        if (params.api_only) {
          requests = requests.filter((r) => r.isApiCall);
        }
        if (params.url_filter) {
          const needle = params.url_filter.toLowerCase();
          requests = requests.filter((r) => r.url.toLowerCase().includes(needle));
        }
        if (params.method_filter) {
          const method = params.method_filter.toUpperCase();
          requests = requests.filter((r) => r.method === method);
        }
        if (params.resource_type) {
          requests = requests.filter((r) => r.resourceType === params.resource_type);
        }

        const total = requests.length;
        const compact = requests.slice(-params.limit).map((r) => ({
          seq: r.seq,
          method: r.method,
          url: r.url.length > 200 ? r.url.slice(0, 200) + "…" : r.url,
          status: r.status,
          resourceType: r.resourceType,
          mimeType: r.mimeType,
          responseSize: r.responseSize,
          isApiCall: r.isApiCall,
          failed: r.failed,
          failureText: r.failureText,
          hasBody: !!r.responseBody,
        }));

        return makeSuccess(params.session_id, { requests: compact, total, returned: compact.length }, start);
      } catch (err) {
        return makeError(params.session_id, "NETWORK_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── network_get_failed_requests ───────────────────────────────
  server.registerTool(
    "network_get_failed_requests",
    {
      title: "Get Failed Network Requests",
      description: `Get requests that failed or returned 4xx/5xx.

Args:
  - session_id (string): Browser session ID
  - limit (number, optional): Max results (default: 50)

Returns:
  { failed_requests: [], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        limit: z.number().int().min(1).max(200).default(50).describe("Max results"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const failed = [...session.capturedRequests.values()]
          .filter((r) => r.failed || (r.status !== undefined && r.status >= 400))
          .sort((a, b) => a.seq - b.seq)
          .slice(-params.limit)
          .map((r) => ({
            seq: r.seq,
            url: r.url,
            method: r.method,
            status: r.status,
            statusText: r.statusText,
            failed: r.failed,
            failureText: r.failureText,
            resourceType: r.resourceType,
          }));
        return makeSuccess(params.session_id, { failed_requests: failed, count: failed.length }, start);
      } catch (err) {
        return makeError(params.session_id, "NETWORK_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── network_get_summary ───────────────────────────────────────
  server.registerTool(
    "network_get_summary",
    {
      title: "Get Network Summary",
      description: `Summary of all network activity: counts by type, status, failures, slowest requests.

Args:
  - session_id (string): Browser session ID

Returns:
  { totalRequests, apiCalls, byResourceType, byStatusCode, failedCount, slowestRequests }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const requests = [...session.capturedRequests.values()];

        const byResourceType: Record<string, number> = {};
        const byStatusCode: Record<string, number> = {};
        let failedCount = 0;
        let apiCallCount = 0;

        for (const r of requests) {
          byResourceType[r.resourceType] = (byResourceType[r.resourceType] ?? 0) + 1;
          if (r.status !== undefined) {
            const group = `${Math.floor(r.status / 100)}xx`;
            byStatusCode[group] = (byStatusCode[group] ?? 0) + 1;
          }
          if (r.failed || (r.status !== undefined && r.status >= 400)) failedCount++;
          if (r.isApiCall) apiCallCount++;
        }

        return makeSuccess(params.session_id, {
          totalRequests: requests.length,
          apiCalls: apiCallCount,
          byResourceType,
          byStatusCode,
          failedCount,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "NETWORK_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── network_clear ─────────────────────────────────────────────
  server.registerTool(
    "network_clear",
    {
      title: "Clear Captured Requests",
      description: `Clear all captured network requests to free memory.

Args:
  - session_id (string): Browser session ID

Returns:
  { cleared: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const count = session.capturedRequests.size;
        session.capturedRequests.clear();
        session.requestSeq = 0;
        return makeSuccess(params.session_id, { cleared: count }, start);
      } catch (err) {
        return makeError(params.session_id, "CLEAR_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
