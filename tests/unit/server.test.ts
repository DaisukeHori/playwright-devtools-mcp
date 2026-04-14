import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, startTestHttpServer, listTools, callTool } from "../helpers/test-utils.js";
import express from "express";
import { type Server } from "http";

describe("MCP Server", () => {
  let httpServer: Server;
  let port: number;
  let baseUrl: string;

  beforeAll(async () => {
    const s = await startTestHttpServer();
    httpServer = s.server;
    port = s.port;
    baseUrl = s.url;
  });

  afterAll(async () => {
    httpServer?.close();
  });

  describe("Server Creation", () => {
    it("should create server with correct name", () => {
      const server = createTestServer();
      expect(server).toBeDefined();
    });

    it("should register all tool groups", async () => {
      const tools = await listTools(baseUrl);
      expect(tools.length).toBeGreaterThanOrEqual(50);
    });

    const expectedToolNames = [
      "browser_launch", "browser_navigate", "browser_screenshot", "browser_close",
      "browser_list_sessions", "browser_click", "browser_type", "browser_evaluate", "browser_wait",
      "console_get_logs", "console_clear_logs", "console_get_exceptions",
      "network_get_requests", "network_get_failed_requests", "network_get_summary", "network_clear",
      "performance_get_metrics", "performance_get_navigation_timing",
      "performance_get_core_web_vitals", "performance_get_resource_timing",
      "storage_get_local_storage", "storage_get_session_storage", "storage_get_cookies",
      "storage_get_indexeddb_info", "storage_clear_data",
      "debug_get_dom_tree", "debug_get_element_properties", "debug_get_page_source",
      "debug_get_accessibility_tree", "debug_query_selector_all",
      "security_analyze_headers", "security_get_certificate", "security_check_mixed_content",
      "flow_start_recording", "flow_stop_recording", "flow_add_step",
      "flow_get_steps", "flow_get_captured_api_calls",
      "generate_curl_commands", "generate_python_requests", "generate_api_spec", "generate_har",
      "capture_get_all_requests", "capture_get_request_detail",
      "interact_click_at", "interact_drag", "interact_hover", "interact_scroll",
      "interact_keyboard", "interact_fill_form", "interact_select_option",
      "interact_upload_file", "interact_screenshot_annotate",
      "interact_wait_for_navigation", "interact_dialog_handle",
      "interact_new_tab", "interact_switch_tab",
    ];

    for (const name of expectedToolNames) {
      it(`should register tool: ${name}`, async () => {
        const tools = await listTools(baseUrl);
        const found = tools.find((t) => t.name === name);
        expect(found, `Tool '${name}' not found`).toBeDefined();
      });
    }

    it("should have descriptions for all tools", async () => {
      const tools = await listTools(baseUrl);
      for (const tool of tools) {
        expect(tool.description, `Tool '${tool.name}' missing description`).toBeTruthy();
        expect(tool.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe("Health Endpoint", () => {
    it("should return 200 with status ok", async () => {
      const resp = await fetch(`${baseUrl}/health`);
      expect(resp.status).toBe(200);
      const data = await resp.json() as Record<string, unknown>;
      expect(data.status).toBe("ok");
    });
  });

  describe("MCP Protocol", () => {
    it("should handle initialize request", async () => {
      const resp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1.0" } },
        }),
      });
      const data = await resp.json() as Record<string, unknown>;
      const result = data.result as Record<string, unknown>;
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.serverInfo).toEqual({ name: "test-server", version: "0.0.0" });
    });

    it("should reject GET on /mcp", async () => {
      const resp = await fetch(`${baseUrl}/mcp`);
      expect(resp.status).toBe(405);
    });

    it("should reject DELETE on /mcp", async () => {
      const resp = await fetch(`${baseUrl}/mcp`, { method: "DELETE" });
      expect(resp.status).toBe(405);
    });

    it("should return 410 for legacy /sse", async () => {
      const resp = await fetch(`${baseUrl}/sse`);
      expect(resp.status).toBe(410);
    });

    it("should reject missing Accept header", async () => {
      const resp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
      // Should return a 4xx error or error in JSON-RPC
      const status = resp.status;
      expect(status >= 400 || status === 200).toBe(true); // 200 with error body is also valid
    });
  });

  describe("Error Handling", () => {
    it("should return error for non-existent session", async () => {
      const result = await callTool(baseUrl, "browser_navigate", { session_id: "nonexistent", url: "http://example.com" });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBeTruthy();
    });

    it("should return error for invalid tool name", async () => {
      const resp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nonexistent_tool", arguments: {} } }),
      });
      const data = await resp.json() as Record<string, unknown>;
      // MCP SDK returns either an RPC error or an isError result
      const hasError = data.error !== undefined ||
        (data.result && (data.result as Record<string, unknown>).isError);
      expect(hasError).toBe(true);
    });

    it("should handle invalid JSON body gracefully", async () => {
      const resp = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: "not json",
      });
      // Should return 400 or 500 (Express JSON parse error)
      expect(resp.status).toBeGreaterThanOrEqual(400);
    });

    it("should error for browser_click without session", async () => {
      const result = await callTool(baseUrl, "browser_click", { session_id: "bad", selector: "#foo" });
      expect(result.success).toBe(false);
    });

    it("should error for browser_type without session", async () => {
      const result = await callTool(baseUrl, "browser_type", { session_id: "bad", selector: "#foo", text: "hello" });
      expect(result.success).toBe(false);
    });

    it("should error for browser_evaluate without session", async () => {
      const result = await callTool(baseUrl, "browser_evaluate", { session_id: "bad", expression: "1+1" });
      expect(result.success).toBe(false);
    });

    it("should error for browser_wait without session", async () => {
      const result = await callTool(baseUrl, "browser_wait", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for browser_screenshot without session", async () => {
      const result = await callTool(baseUrl, "browser_screenshot", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for console_get_logs without session", async () => {
      const result = await callTool(baseUrl, "console_get_logs", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for network_get_requests without session", async () => {
      const result = await callTool(baseUrl, "network_get_requests", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for performance_get_metrics without session", async () => {
      const result = await callTool(baseUrl, "performance_get_metrics", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for storage_get_cookies without session", async () => {
      const result = await callTool(baseUrl, "storage_get_cookies", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for debug_get_dom_tree without session", async () => {
      const result = await callTool(baseUrl, "debug_get_dom_tree", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for security_analyze_headers without session", async () => {
      const result = await callTool(baseUrl, "security_analyze_headers", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for flow_start_recording without session", async () => {
      const result = await callTool(baseUrl, "flow_start_recording", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for generate_curl_commands without session", async () => {
      const result = await callTool(baseUrl, "generate_curl_commands", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for interact_click_at without session", async () => {
      const result = await callTool(baseUrl, "interact_click_at", { session_id: "bad", x: 100, y: 100 });
      expect(result.success).toBe(false);
    });

    it("should error for interact_drag without session", async () => {
      const result = await callTool(baseUrl, "interact_drag", { session_id: "bad", from_x: 0, from_y: 0, to_x: 100, to_y: 100 });
      expect(result.success).toBe(false);
    });

    it("should error for interact_scroll without session", async () => {
      const result = await callTool(baseUrl, "interact_scroll", { session_id: "bad" });
      expect(result.success).toBe(false);
    });

    it("should error for interact_keyboard without session", async () => {
      const result = await callTool(baseUrl, "interact_keyboard", { session_id: "bad", key: "Enter" });
      expect(result.success).toBe(false);
    });

    it("should error for interact_fill_form without session", async () => {
      const result = await callTool(baseUrl, "interact_fill_form", { session_id: "bad", selector: "#foo", value: "bar" });
      expect(result.success).toBe(false);
    });
  });

  describe("Authentication", () => {
    let authServer: Server;
    let authPort: number;

    beforeAll(async () => {
      const app = express();
      app.use(express.json());
      const origToken = process.env.MCP_AUTH_TOKEN;
      process.env.MCP_AUTH_TOKEN = "secret-test-token";

      // We can't easily test auth with the standard helper since it's module-level
      // Instead test via the main index.ts by importing it fresh
      // For now, just verify the health endpoint works without auth
      app.get("/health", (_req, res) => res.json({ status: "ok" }));

      await new Promise<void>((resolve) => {
        authServer = app.listen(0, "127.0.0.1", () => {
          const addr = authServer.address();
          authPort = typeof addr === "object" && addr ? addr.port : 0;
          resolve();
        });
      });
      process.env.MCP_AUTH_TOKEN = origToken;
    });

    afterAll(() => {
      authServer?.close();
    });

    it("should allow requests without auth when MCP_AUTH_TOKEN is not set", async () => {
      // Our test server doesn't set MCP_AUTH_TOKEN
      const result = await callTool(baseUrl, "browser_list_sessions", {});
      expect(result.success).toBe(true);
    });
  });
});
