import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { type Server } from "http";
import { startTestHttpServer, startStaticServer, callTool, cleanupAllSessions } from "../helpers/test-utils.js";

describe("Integration: Flow Recording & API Spec Generation", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  async function launchAndNav(path = "/app"): Promise<string> {
    const r = await callTool(mcp.url, "browser_launch", {});
    const sid = r.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}${path}` });
    await new Promise((r) => setTimeout(r, 2000));
    return sid;
  }

  // ─── Flow Recording ────────────────────────────────────────────

  it("should start flow recording", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "flow_start_recording", { session_id: sid, flow_name: "Test Flow" });
    expect(r.success).toBe(true);
    expect(r.data.recording).toBe(true);
  });

  it("should stop flow recording with summary", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "flow_start_recording", { session_id: sid });
    const r = await callTool(mcp.url, "flow_stop_recording", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.recording).toBe(false);
    expect(r.data.totalSteps).toBeTypeOf("number");
  });

  it("should add manual annotation steps", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "flow_start_recording", { session_id: sid });
    const r = await callTool(mcp.url, "flow_add_step", { session_id: sid, description: "ユーザーがログインページを開く" });
    expect(r.success).toBe(true);
    expect(r.data.stepSeq).toBeGreaterThanOrEqual(1);
  });

  it("should record navigation steps in flow", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "flow_start_recording", { session_id: sid });
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/app` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "flow_get_steps", { session_id: sid });
    expect(r.success).toBe(true);
    const steps = r.data.steps as Array<{ action: string }>;
    expect(steps.filter((s) => s.action === "navigate").length).toBeGreaterThanOrEqual(2);
  });

  it("should record click steps in flow", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "flow_start_recording", { session_id: sid });
    await callTool(mcp.url, "browser_click", { session_id: sid, selector: "#clickTarget" });
    const r = await callTool(mcp.url, "flow_get_steps", { session_id: sid });
    const steps = r.data.steps as Array<{ action: string }>;
    expect(steps.some((s) => s.action === "click")).toBe(true);
  });

  it("should filter flow steps by action", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "flow_start_recording", { session_id: sid });
    await callTool(mcp.url, "flow_add_step", { session_id: sid, description: "annotation 1" });
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "flow_get_steps", { session_id: sid, action_filter: "annotation" });
    const steps = r.data.steps as Array<{ action: string }>;
    for (const s of steps) expect(s.action).toBe("annotation");
  });

  // ─── Captured API Calls ────────────────────────────────────────

  it("should capture API calls with bodies", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, include_bodies: true });
    expect(r.success).toBe(true);
    expect(r.data.count).toBeGreaterThanOrEqual(1);
  });

  it("should filter captured API calls by URL", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, url_filter: "login" });
    const calls = r.data.apiCalls as Array<{ url: string }>;
    for (const c of calls) expect(c.url).toContain("login");
  });

  it("should filter captured API calls by method", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, method_filter: "POST" });
    const calls = r.data.apiCalls as Array<{ method: string }>;
    for (const c of calls) expect(c.method).toBe("POST");
  });

  it("should capture request post data", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, method_filter: "POST", include_bodies: true });
    const calls = r.data.apiCalls as Array<{ requestPostData?: string }>;
    const postCall = calls.find((c) => c.requestPostData);
    expect(postCall).toBeDefined();
    expect(postCall!.requestPostData).toContain("admin");
  });

  it("should capture response bodies", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, include_bodies: true });
    const calls = r.data.apiCalls as Array<{ responseBody?: string }>;
    const withBody = calls.filter((c) => c.responseBody);
    expect(withBody.length).toBeGreaterThanOrEqual(1);
  });

  it("should get all captured requests (not just API)", async () => {
    const sid = await launchAndNav("/perf");
    const r = await callTool(mcp.url, "capture_get_all_requests", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.total).toBeGreaterThanOrEqual(3); // HTML + CSS + JS + IMG
  });

  it("should get request detail by seq", async () => {
    const sid = await launchAndNav("/app");
    const all = await callTool(mcp.url, "capture_get_all_requests", { session_id: sid });
    const reqs = all.data.requests as Array<{ seq: number }>;
    if (reqs.length > 0) {
      const detail = await callTool(mcp.url, "capture_get_request_detail", { session_id: sid, seq: reqs[0].seq });
      expect(detail.success).toBe(true);
      expect(detail.data.request).toBeDefined();
    }
  });

  // ─── curl Generation ───────────────────────────────────────────

  it("should generate curl commands", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_curl_commands", { session_id: sid });
    expect(r.success).toBe(true);
    const cmds = r.data.commands as Array<{ curl: string }>;
    expect(cmds.length).toBeGreaterThanOrEqual(1);
    for (const cmd of cmds) {
      expect(cmd.curl).toContain("curl");
    }
  });

  it("should generate curl with all headers", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_curl_commands", { session_id: sid, include_common_headers: true });
    const cmds = r.data.commands as Array<{ curl: string }>;
    if (cmds.length > 0) {
      expect(cmds[0].curl).toContain("-H");
    }
  });

  it("should filter curl by URL", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_curl_commands", { session_id: sid, url_filter: "login" });
    const cmds = r.data.commands as Array<{ curl: string }>;
    for (const cmd of cmds) expect(cmd.curl).toContain("login");
  });

  // ─── Python requests Generation ────────────────────────────────

  it("should generate Python requests code", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_python_requests", { session_id: sid });
    expect(r.success).toBe(true);
    const code = r.data.code as string;
    expect(code).toContain("import requests");
    expect(code).toContain("session = requests.Session()");
    expect(r.data.callCount).toBeGreaterThanOrEqual(1);
  });

  it("should generate Python without session", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_python_requests", { session_id: sid, use_session: false });
    const code = r.data.code as string;
    expect(code).not.toContain("session = requests.Session()");
    expect(code).toContain("requests.");
  });

  // ─── API Spec Generation ───────────────────────────────────────

  it("should generate Markdown API spec", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_api_spec", { session_id: sid, format: "markdown" });
    expect(r.success).toBe(true);
    const spec = r.data.spec as string;
    expect(spec).toContain("# API Specification");
    expect(r.data.endpoints).toBeGreaterThanOrEqual(1);
  });

  it("should generate JSON API spec", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_api_spec", { session_id: sid, format: "json" });
    expect(r.success).toBe(true);
    expect(r.data.spec).toBeDefined();
    expect(r.data.format).toBe("json");
  });

  // ─── HAR Generation ────────────────────────────────────────────

  it("should generate HAR", async () => {
    const sid = await launchAndNav("/app");
    const r = await callTool(mcp.url, "generate_har", { session_id: sid });
    expect(r.success).toBe(true);
    const har = r.data.har as { log: { version: string; entries: unknown[] } };
    expect(har.log.version).toBe("1.2");
    expect(har.log.entries.length).toBeGreaterThanOrEqual(1);
  });

  it("should generate HAR with API calls only", async () => {
    const sid = await launchAndNav("/app");
    const all = await callTool(mcp.url, "generate_har", { session_id: sid });
    const apiOnly = await callTool(mcp.url, "generate_har", { session_id: sid, api_only: true });
    expect((apiOnly.data.har as { log: { entries: unknown[] } }).log.entries.length)
      .toBeLessThanOrEqual((all.data.har as { log: { entries: unknown[] } }).log.entries.length);
  });
});

describe("Integration: Interactive Tools", () => {
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
    return sid;
  }

  // ─── Coordinate Click ─────────────────────────────────────────

  it("should click at coordinates", async () => {
    const sid = await launchAndNav();
    // Get clickTarget position
    const props = await callTool(mcp.url, "debug_get_element_properties", { session_id: sid, selector: "#clickTarget" });
    const box = (props.data.element as Record<string, unknown>).boundingBox as { x: number; y: number; width: number; height: number };
    const r = await callTool(mcp.url, "interact_click_at", {
      session_id: sid, x: box.x + box.width / 2, y: box.y + box.height / 2,
    });
    expect(r.success).toBe(true);
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "window.clickCount" });
    expect(ev.data.result).toBeGreaterThanOrEqual(1);
  });

  it("should right-click at coordinates", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_click_at", { session_id: sid, x: 100, y: 100, button: "right" });
    expect(r.success).toBe(true);
  });

  // ─── Drag ──────────────────────────────────────────────────────

  it("should drag from A to B", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_drag", {
      session_id: sid, from_x: 90, from_y: 240, to_x: 400, to_y: 300,
    });
    expect(r.success).toBe(true);
    expect(r.data.dragged).toBe(true);
  });

  // ─── Hover ─────────────────────────────────────────────────────

  it("should hover at coordinates", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_hover", { session_id: sid, x: 200, y: 200 });
    expect(r.success).toBe(true);
  });

  it("should hover on selector", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_hover", { session_id: sid, selector: "#clickTarget" });
    expect(r.success).toBe(true);
  });

  it("should error hover without x/y or selector", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_hover", { session_id: sid });
    expect(r.success).toBe(false);
  });

  // ─── Scroll ────────────────────────────────────────────────────

  it("should scroll down", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_scroll", { session_id: sid, direction: "down", amount: 500 });
    expect(r.success).toBe(true);
    expect((r.data.scrollPosition as { y: number }).y).toBeGreaterThan(0);
  });

  it("should scroll up after scrolling down", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "interact_scroll", { session_id: sid, direction: "down", amount: 500 });
    const r = await callTool(mcp.url, "interact_scroll", { session_id: sid, direction: "up", amount: 200 });
    expect(r.success).toBe(true);
  });

  it("should scroll to element", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_scroll", { session_id: sid, scroll_to_selector: "#bottom" });
    expect(r.success).toBe(true);
    expect((r.data.scrollPosition as { y: number }).y).toBeGreaterThan(1000);
  });

  // ─── Keyboard ──────────────────────────────────────────────────

  it("should press Enter key", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_keyboard", { session_id: sid, key: "Enter" });
    expect(r.success).toBe(true);
  });

  it("should press shortcut keys", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_keyboard", { session_id: sid, key: "Control+a" });
    expect(r.success).toBe(true);
  });

  it("should type text via keyboard", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "browser_click", { session_id: sid, selector: "#username" });
    const r = await callTool(mcp.url, "interact_keyboard", { session_id: sid, text: "hello" });
    expect(r.success).toBe(true);
  });

  it("should error keyboard without key or text", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_keyboard", { session_id: sid });
    expect(r.success).toBe(false);
  });

  // ─── Fill Form ─────────────────────────────────────────────────

  it("should fill form field", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#username", value: "admin" });
    expect(r.success).toBe(true);
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "document.getElementById('username').value" });
    expect(ev.data.result).toBe("admin");
  });

  it("should fill multiple form fields", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#username", value: "admin" });
    await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#password", value: "secret" });
    await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#email", value: "a@b.com" });
    const ev = await callTool(mcp.url, "browser_evaluate", {
      session_id: sid,
      expression: "JSON.stringify({u: document.getElementById('username').value, p: document.getElementById('password').value, e: document.getElementById('email').value})",
    });
    const vals = JSON.parse(ev.data.result as string);
    expect(vals).toEqual({ u: "admin", p: "secret", e: "a@b.com" });
  });

  // ─── Select Dropdown ───────────────────────────────────────────

  it("should select by value", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_select_option", { session_id: sid, selector: "#role", value: "admin" });
    expect(r.success).toBe(true);
    expect(r.data.selected).toContain("admin");
  });

  it("should select by label", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_select_option", { session_id: sid, selector: "#role", label: "Guest" });
    expect(r.success).toBe(true);
    expect(r.data.selected).toContain("guest");
  });

  it("should select by index", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_select_option", { session_id: sid, selector: "#role", index: 2 });
    expect(r.success).toBe(true);
  });

  // ─── Screenshot with Grid ─────────────────────────────────────

  it("should take screenshot with grid overlay", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_screenshot_annotate", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.hasImage).toBe(true);
  });

  it("should take screenshot with custom grid size", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_screenshot_annotate", { session_id: sid, grid_size: 50 });
    expect(r.success).toBe(true);
  });

  it("should highlight element in screenshot", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_screenshot_annotate", { session_id: sid, highlight_selector: "#clickTarget" });
    expect(r.success).toBe(true);
  });

  // ─── Wait for Navigation ───────────────────────────────────────

  it("should wait for load state", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_wait_for_navigation", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.url).toBeDefined();
  });

  // ─── Dialog Handling ───────────────────────────────────────────

  it("should set up dialog handler for accept", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_dialog_handle", { session_id: sid, action: "accept" });
    expect(r.success).toBe(true);
    expect(r.data.handler_set).toBe(true);
  });

  it("should set up dialog handler for dismiss", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_dialog_handle", { session_id: sid, action: "dismiss" });
    expect(r.success).toBe(true);
  });

  // ─── Tab Management ────────────────────────────────────────────

  it("should open new tab", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_new_tab", { session_id: sid, url: `${app.url}/secure` });
    expect(r.success).toBe(true);
    expect(r.data.tabCount).toBe(2);
  });

  it("should switch between tabs", async () => {
    const sid = await launchAndNav();
    await callTool(mcp.url, "interact_new_tab", { session_id: sid, url: `${app.url}/secure` });
    const r = await callTool(mcp.url, "interact_switch_tab", { session_id: sid, tab_index: 0 });
    expect(r.success).toBe(true);
    expect(r.data.tabIndex).toBe(0);
  });

  it("should error on invalid tab index", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "interact_switch_tab", { session_id: sid, tab_index: 99 });
    expect(r.success).toBe(false);
  });
});

describe("Integration: End-to-End Reverse Engineering Flow", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  it("should complete a full reverse engineering workflow", async () => {
    // 1. Launch browser
    const launch = await callTool(mcp.url, "browser_launch", {});
    const sid = launch.data.session_id as string;

    // 2. Start flow recording
    const startFlow = await callTool(mcp.url, "flow_start_recording", { session_id: sid, flow_name: "Login Flow" });
    expect(startFlow.data.recording).toBe(true);

    // 3. Navigate to app (triggers API calls)
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/app` });
    await callTool(mcp.url, "flow_add_step", { session_id: sid, description: "Open application page" });
    await new Promise((r) => setTimeout(r, 3000));

    // 4. Check captured API calls
    const apiCalls = await callTool(mcp.url, "flow_get_captured_api_calls", { session_id: sid, include_bodies: true });
    expect(apiCalls.data.count).toBeGreaterThanOrEqual(2);

    // 5. Stop recording
    const stopFlow = await callTool(mcp.url, "flow_stop_recording", { session_id: sid });
    expect(stopFlow.data.totalSteps).toBeGreaterThanOrEqual(2);

    // 6. Generate outputs
    const curl = await callTool(mcp.url, "generate_curl_commands", { session_id: sid });
    expect((curl.data.commands as unknown[]).length).toBeGreaterThanOrEqual(1);

    const python = await callTool(mcp.url, "generate_python_requests", { session_id: sid });
    expect(python.data.code).toContain("import requests");

    const spec = await callTool(mcp.url, "generate_api_spec", { session_id: sid });
    expect(spec.data.endpoints).toBeGreaterThanOrEqual(1);

    const har = await callTool(mcp.url, "generate_har", { session_id: sid, api_only: true });
    expect((har.data.har as { log: { entries: unknown[] } }).log.entries.length).toBeGreaterThanOrEqual(1);

    // 7. Close
    const close = await callTool(mcp.url, "browser_close", { session_id: sid });
    expect(close.data.closed).toBe(true);
  });

  it("should handle multi-page flow with form interaction", async () => {
    const launch = await callTool(mcp.url, "browser_launch", {});
    const sid = launch.data.session_id as string;

    await callTool(mcp.url, "flow_start_recording", { session_id: sid, flow_name: "Form Submit" });

    // Navigate to form page
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "flow_add_step", { session_id: sid, description: "Open form page" });

    // Fill form
    await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#username", value: "testuser" });
    await callTool(mcp.url, "interact_fill_form", { session_id: sid, selector: "#email", value: "test@example.com" });
    await callTool(mcp.url, "interact_select_option", { session_id: sid, selector: "#role", value: "admin" });
    await callTool(mcp.url, "flow_add_step", { session_id: sid, description: "Fill in form fields" });

    // Submit
    await callTool(mcp.url, "browser_click", { session_id: sid, selector: "#submitBtn" });
    await new Promise((r) => setTimeout(r, 500));

    // Verify form submission result
    const result = await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "document.getElementById('result').textContent",
    });
    expect(result.data.result).toContain("testuser");

    // Stop and verify flow
    const flow = await callTool(mcp.url, "flow_stop_recording", { session_id: sid });
    expect(flow.data.totalSteps).toBeGreaterThanOrEqual(4);
  });
});
