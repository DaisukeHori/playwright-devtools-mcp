import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerConsoleTools(server: McpServer): void {
  // ─── console_get_logs ──────────────────────────────────────────
  server.registerTool(
    "console_get_logs",
    {
      title: "Get Console Logs",
      description: `Retrieve captured console logs from the browser session.
Logs are collected automatically during page lifecycle (console.log, console.warn, console.error, page errors, CDP Log events).

Args:
  - session_id (string): Browser session ID
  - types (array, optional): Filter by log types e.g. ["error", "warning", "log", "info", "debug"] (default: all)
  - limit (number, optional): Maximum logs to return (default: 100)
  - since (number, optional): Only return logs after this timestamp (epoch ms)
  - search (string, optional): Filter logs containing this text (case-insensitive)

Returns:
  { logs: ConsoleLogEntry[], total: number, filtered: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        types: z.array(z.string()).optional().describe('Filter by type: "error", "warning", "log", "info", "debug"'),
        limit: z.number().int().min(1).max(500).default(100).describe("Max logs to return"),
        since: z.number().optional().describe("Only return logs after this epoch ms"),
        search: z.string().optional().describe("Filter by text (case-insensitive)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let logs = [...session.consoleLogs];

        if (params.types && params.types.length > 0) {
          const typeSet = new Set(params.types);
          logs = logs.filter((l) => typeSet.has(l.type));
        }
        if (params.since) {
          logs = logs.filter((l) => l.timestamp >= params.since!);
        }
        if (params.search) {
          const needle = params.search.toLowerCase();
          logs = logs.filter((l) => l.text.toLowerCase().includes(needle));
        }

        const total = session.consoleLogs.length;
        const filtered = logs.length;
        logs = logs.slice(-params.limit);

        return makeSuccess(params.session_id, { logs, total, filtered, returned: logs.length }, start);
      } catch (err) {
        return makeError(params.session_id, "CONSOLE_ERROR", `Failed to get console logs: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── console_clear_logs ────────────────────────────────────────
  server.registerTool(
    "console_clear_logs",
    {
      title: "Clear Console Logs",
      description: `Clear stored console logs for a session to free memory.

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
        const count = session.consoleLogs.length;
        session.consoleLogs.length = 0;
        return makeSuccess(params.session_id, { cleared: count }, start);
      } catch (err) {
        return makeError(params.session_id, "CLEAR_ERROR", `Failed to clear logs: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── console_get_exceptions ────────────────────────────────────
  server.registerTool(
    "console_get_exceptions",
    {
      title: "Get JavaScript Exceptions",
      description: `Get only error-level console messages and unhandled exceptions. Convenience wrapper around console_get_logs filtered to errors.

Args:
  - session_id (string): Browser session ID
  - limit (number, optional): Maximum exceptions to return (default: 50)

Returns:
  { exceptions: ConsoleLogEntry[], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        limit: z.number().int().min(1).max(200).default(50).describe("Max exceptions"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const exceptions = session.consoleLogs
          .filter((l) => l.type === "error" || l.type === "pageerror")
          .slice(-params.limit);
        return makeSuccess(params.session_id, { exceptions, count: exceptions.length }, start);
      } catch (err) {
        return makeError(params.session_id, "EXCEPTIONS_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
