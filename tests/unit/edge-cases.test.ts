import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { type Server } from "http";
import { startTestHttpServer, startStaticServer, callTool, cleanupAllSessions } from "../helpers/test-utils.js";

describe("Unit: Browser Manager Edge Cases", () => {
  let mcp: { server: Server; url: string };

  beforeAll(async () => { mcp = await startTestHttpServer(); });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); });

  describe("Session Lifecycle", () => {
    it("should generate unique session IDs", async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const r = await callTool(mcp.url, "browser_launch", {});
        ids.add(r.data.session_id as string);
      }
      expect(ids.size).toBe(5);
    });

    it("should list zero sessions initially", async () => {
      const r = await callTool(mcp.url, "browser_list_sessions", {});
      expect(r.data.sessions).toEqual([]);
    });

    it("should track session count correctly after close", async () => {
      const r1 = await callTool(mcp.url, "browser_launch", {});
      const r2 = await callTool(mcp.url, "browser_launch", {});
      const list1 = await callTool(mcp.url, "browser_list_sessions", {});
      expect((list1.data.sessions as unknown[]).length).toBe(2);
      await callTool(mcp.url, "browser_close", { session_id: r1.data.session_id });
      const list2 = await callTool(mcp.url, "browser_list_sessions", {});
      expect((list2.data.sessions as unknown[]).length).toBe(1);
      await callTool(mcp.url, "browser_close", { session_id: r2.data.session_id });
      const list3 = await callTool(mcp.url, "browser_list_sessions", {});
      expect((list3.data.sessions as unknown[]).length).toBe(0);
    });

    it("should include capturedRequests count in session list", async () => {
      const r = await callTool(mcp.url, "browser_launch", {});
      const list = await callTool(mcp.url, "browser_list_sessions", {});
      const sessions = list.data.sessions as Array<{ capturedRequests: number; flowSteps: number }>;
      expect(sessions[0].capturedRequests).toBe(0);
      expect(sessions[0].flowSteps).toBe(0);
    });
  });

  describe("Launch Options", () => {
    it("should launch with default viewport 1280x720", async () => {
      const r = await callTool(mcp.url, "browser_launch", {});
      expect(r.data.viewport).toEqual({ width: 1280, height: 720 });
    });

    it("should launch with minimum viewport", async () => {
      const r = await callTool(mcp.url, "browser_launch", { viewport_width: 320, viewport_height: 240 });
      expect(r.data.viewport).toEqual({ width: 320, height: 240 });
    });

    it("should launch with large viewport", async () => {
      const r = await callTool(mcp.url, "browser_launch", { viewport_width: 3840, viewport_height: 2160 });
      expect(r.data.viewport).toEqual({ width: 3840, height: 2160 });
    });

    it("should launch with custom locale", async () => {
      const r = await callTool(mcp.url, "browser_launch", { locale: "en-US" });
      expect(r.success).toBe(true);
    });

    it("should launch with custom timezone", async () => {
      const r = await callTool(mcp.url, "browser_launch", { timezone: "America/New_York" });
      expect(r.success).toBe(true);
    });

    it("should launch with custom user agent", async () => {
      const r = await callTool(mcp.url, "browser_launch", { user_agent: "TestBot/1.0" });
      expect(r.success).toBe(true);
    });

    it("should launch with extra headers", async () => {
      const r = await callTool(mcp.url, "browser_launch", { extra_headers: { "X-Test": "value" } });
      expect(r.success).toBe(true);
    });
  });

  describe("Error Messages", () => {
    const toolsRequiringSession = [
      ["browser_navigate", { url: "http://example.com" }],
      ["browser_screenshot", {}],
      ["browser_click", { selector: "#x" }],
      ["browser_type", { selector: "#x", text: "t" }],
      ["browser_evaluate", { expression: "1" }],
      ["browser_wait", {}],
      ["console_get_logs", {}],
      ["console_clear_logs", {}],
      ["console_get_exceptions", {}],
      ["network_get_requests", {}],
      ["network_get_failed_requests", {}],
      ["network_get_summary", {}],
      ["network_clear", {}],
      ["performance_get_metrics", {}],
      ["performance_get_navigation_timing", {}],
      ["performance_get_core_web_vitals", {}],
      ["performance_get_resource_timing", {}],
      ["storage_get_local_storage", {}],
      ["storage_get_session_storage", {}],
      ["storage_get_cookies", {}],
      ["storage_get_indexeddb_info", {}],
      ["storage_clear_data", { types: ["cookies"] }],
      ["debug_get_dom_tree", {}],
      ["debug_get_element_properties", { selector: "#x" }],
      ["debug_get_page_source", {}],
      ["debug_get_accessibility_tree", {}],
      ["debug_query_selector_all", { selector: "*" }],
      ["security_analyze_headers", {}],
      ["security_get_certificate", {}],
      ["security_check_mixed_content", {}],
      ["flow_start_recording", {}],
      ["flow_stop_recording", {}],
      ["flow_add_step", { description: "test" }],
      ["flow_get_steps", {}],
      ["flow_get_captured_api_calls", {}],
      ["generate_curl_commands", {}],
      ["generate_python_requests", {}],
      ["generate_api_spec", {}],
      ["generate_har", {}],
      ["capture_get_all_requests", {}],
      ["capture_get_request_detail", { seq: 1 }],
      ["interact_click_at", { x: 0, y: 0 }],
      ["interact_drag", { from_x: 0, from_y: 0, to_x: 1, to_y: 1 }],
      ["interact_hover", { x: 0, y: 0 }],
      ["interact_scroll", {}],
      ["interact_keyboard", { key: "Enter" }],
      ["interact_fill_form", { selector: "#x", value: "v" }],
      ["interact_select_option", { selector: "#x", value: "v" }],
      ["interact_upload_file", { selector: "#x", files: [{ name: "f", content: "Y29udGVudA==", mime_type: "text/plain" }] }],
      ["interact_screenshot_annotate", {}],
      ["interact_wait_for_navigation", {}],
      ["interact_dialog_handle", { action: "accept" }],
      ["interact_new_tab", {}],
      ["interact_switch_tab", { tab_index: 0 }],
    ] as const;

    for (const [tool, args] of toolsRequiringSession) {
      it(`${tool} should return error with helpful message for invalid session`, async () => {
        const r = await callTool(mcp.url, tool as string, { session_id: "nonexistent", ...args });
        expect(r.success).toBe(false);
        expect(r.error?.message).toContain("not found");
      });
    }
  });
});

describe("Unit: Response Format Validation", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  async function launchAndNav(): Promise<string> {
    const r = await callTool(mcp.url, "browser_launch", {});
    const sid = r.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    return sid;
  }

  const toolsToValidate = [
    "browser_list_sessions",
    "console_get_logs",
    "console_get_exceptions",
    "network_get_requests",
    "network_get_failed_requests",
    "network_get_summary",
    "storage_get_local_storage",
    "storage_get_session_storage",
    "storage_get_cookies",
    "storage_get_indexeddb_info",
    "debug_get_dom_tree",
    "debug_get_page_source",
    "debug_get_accessibility_tree",
    "debug_query_selector_all",
    "security_get_certificate",
    "security_check_mixed_content",
    "performance_get_metrics",
    "flow_get_steps",
    "flow_get_captured_api_calls",
    "capture_get_all_requests",
  ];

  for (const tool of toolsToValidate) {
    it(`${tool} should return standard response format`, async () => {
      const sid = tool === "browser_list_sessions" ? undefined : await launchAndNav();
      const args = sid ? { session_id: sid, selector: "*", limit: 5 } : {};
      const r = await callTool(mcp.url, tool, args);
      expect(r).toHaveProperty("success");
      expect(r).toHaveProperty("data");
      expect(r).toHaveProperty("metadata");
      if (r.success) {
        expect(r.metadata).toHaveProperty("timestamp");
        expect(r.metadata).toHaveProperty("sessionId");
      }
    });
  }
});
