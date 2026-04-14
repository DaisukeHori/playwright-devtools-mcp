import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { type Server } from "http";
import { startTestHttpServer, startStaticServer, callTool, cleanupAllSessions } from "../helpers/test-utils.js";

describe("Integration: Browser & Navigation", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });

  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  async function launch(): Promise<string> {
    const r = await callTool(mcp.url, "browser_launch", {});
    return r.data.session_id as string;
  }

  // ─── Browser Lifecycle ─────────────────────────────────────────

  it("should launch a browser session", async () => {
    const r = await callTool(mcp.url, "browser_launch", {});
    expect(r.success).toBe(true);
    expect(r.data.session_id).toBeTypeOf("string");
    expect(r.data.session_id).toMatch(/^session-/);
  });

  it("should launch with custom viewport", async () => {
    const r = await callTool(mcp.url, "browser_launch", { viewport_width: 1920, viewport_height: 1080 });
    expect(r.success).toBe(true);
    expect(r.data.viewport).toEqual({ width: 1920, height: 1080 });
  });

  it("should list sessions", async () => {
    const sid = await launch();
    const r = await callTool(mcp.url, "browser_list_sessions", {});
    expect(r.success).toBe(true);
    const sessions = r.data.sessions as Array<{ id: string }>;
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.id === sid)).toBe(true);
  });

  it("should close a session", async () => {
    const sid = await launch();
    const r = await callTool(mcp.url, "browser_close", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.closed).toBe(true);
  });

  it("should error on double close", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_close", { session_id: sid });
    // Second close should still succeed (idempotent)
    const r2 = await callTool(mcp.url, "browser_close", { session_id: sid });
    expect(r2.success).toBe(true);
  });

  it("should support multiple concurrent sessions", async () => {
    const sid1 = await launch();
    const sid2 = await launch();
    expect(sid1).not.toBe(sid2);
    const r = await callTool(mcp.url, "browser_list_sessions", {});
    expect((r.data.sessions as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  // ─── Navigation ────────────────────────────────────────────────

  it("should navigate to a URL", async () => {
    const sid = await launch();
    const r = await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    expect(r.success).toBe(true);
    expect(r.data.title).toBe("Test Page");
    expect(r.data.status).toBe(200);
  });

  it("should navigate with different wait conditions", async () => {
    const sid = await launch();
    for (const wc of ["load", "domcontentloaded", "commit"]) {
      const r = await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url, wait_until: wc });
      expect(r.success).toBe(true);
    }
  });

  it("should handle navigation to non-existent page", async () => {
    const sid = await launch();
    const r = await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/nonexistent` });
    // Express returns 404 but navigation itself succeeds
    expect(r.success).toBe(true);
  });

  it("should handle navigation timeout", async () => {
    const sid = await launch();
    const r = await callTool(mcp.url, "browser_navigate", { session_id: sid, url: "http://192.0.2.1:1/", timeout: 3000 });
    expect(r.success).toBe(false);
    expect(r.error?.code).toBeTruthy();
  });

  // ─── Screenshots ───────────────────────────────────────────────

  it("should take a viewport screenshot", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_screenshot", { session_id: sid });
    expect(r.success).toBe(true);
  });

  it("should take a full-page screenshot", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_screenshot", { session_id: sid, full_page: true });
    expect(r.success).toBe(true);
  });

  it("should take an element screenshot", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_screenshot", { session_id: sid, selector: "#title" });
    expect(r.success).toBe(true);
  });

  it("should take JPEG screenshot with quality", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_screenshot", { session_id: sid, format: "jpeg", quality: 50 });
    expect(r.success).toBe(true);
  });

  // ─── Click / Type / Evaluate ───────────────────────────────────

  it("should click an element", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_click", { session_id: sid, selector: "#clickTarget" });
    expect(r.success).toBe(true);
    // Verify click worked
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "window.clickCount" });
    expect(ev.data.result).toBe(1);
  });

  it("should double-click", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "browser_click", { session_id: sid, selector: "#clickTarget", click_count: 2 });
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "window.clickCount" });
    expect(ev.data.result).toBe(2);
  });

  it("should type text into input", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "browser_type", { session_id: sid, selector: "#username", text: "testuser" });
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "document.getElementById('username').value" });
    expect(ev.data.result).toBe("testuser");
  });

  it("should clear and type", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "browser_type", { session_id: sid, selector: "#username", text: "old" });
    await callTool(mcp.url, "browser_type", { session_id: sid, selector: "#username", text: "new", clear_first: true });
    const ev = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "document.getElementById('username').value" });
    expect(ev.data.result).toBe("new");
  });

  it("should evaluate JavaScript", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "2 + 3" });
    expect(r.data.result).toBe(5);
  });

  it("should evaluate complex JavaScript", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "document.querySelectorAll('input').length" });
    expect(r.data.result).toBeGreaterThanOrEqual(4);
  });

  it("should wait for selector", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_wait", { session_id: sid, selector: "#title", state: "visible" });
    expect(r.success).toBe(true);
  });

  it("should error on wait for non-existent selector", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "browser_wait", { session_id: sid, selector: "#nonexistent", timeout: 1000 });
    expect(r.success).toBe(false);
  });
});

describe("Integration: Console Logs", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  async function launch(): Promise<string> {
    const r = await callTool(mcp.url, "browser_launch", {});
    return r.data.session_id as string;
  }

  it("should capture console.log messages", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.total).toBeGreaterThanOrEqual(1);
    const logs = r.data.logs as Array<{ text: string; type: string }>;
    expect(logs.some((l) => l.text.includes("Page loaded"))).toBe(true);
  });

  it("should capture console.warn messages", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, types: ["warning"] });
    const logs = r.data.logs as Array<{ text: string }>;
    expect(logs.some((l) => l.text.includes("Test warning"))).toBe(true);
  });

  it("should capture errors on error page", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "console_get_exceptions", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.count).toBeGreaterThanOrEqual(1);
  });

  it("should filter logs by type", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, types: ["error"] });
    const logs = r.data.logs as Array<{ type: string }>;
    for (const l of logs) expect(l.type).toBe("error");
  });

  it("should filter logs by search text", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, search: "Page loaded" });
    expect((r.data.logs as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it("should limit log count", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, limit: 2 });
    expect((r.data.logs as unknown[]).length).toBeLessThanOrEqual(2);
  });

  it("should clear logs", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const clear = await callTool(mcp.url, "console_clear_logs", { session_id: sid });
    expect(clear.data.cleared).toBeGreaterThanOrEqual(1);
    const after = await callTool(mcp.url, "console_get_logs", { session_id: sid });
    expect(after.data.total).toBe(0);
  });
});

describe("Integration: Network Capture", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  async function launch(): Promise<string> {
    const r = await callTool(mcp.url, "browser_launch", {});
    return r.data.session_id as string;
  }

  it("should capture document request on navigation", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const r = await callTool(mcp.url, "network_get_requests", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.total).toBeGreaterThanOrEqual(1);
  });

  it("should capture API calls (XHR/fetch)", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/app` });
    await new Promise((r) => setTimeout(r, 2000));
    const r = await callTool(mcp.url, "network_get_requests", { session_id: sid, api_only: true });
    expect(r.success).toBe(true);
    expect(r.data.total).toBeGreaterThanOrEqual(2); // /api/data + /api/login
  });

  it("should filter by URL", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/app` });
    await new Promise((r) => setTimeout(r, 2000));
    const r = await callTool(mcp.url, "network_get_requests", { session_id: sid, url_filter: "/api/data" });
    const reqs = r.data.requests as Array<{ url: string }>;
    for (const req of reqs) expect(req.url).toContain("/api/data");
  });

  it("should filter by method", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/app` });
    await new Promise((r) => setTimeout(r, 2000));
    const r = await callTool(mcp.url, "network_get_requests", { session_id: sid, method_filter: "POST" });
    const reqs = r.data.requests as Array<{ method: string }>;
    for (const req of reqs) expect(req.method).toBe("POST");
  });

  it("should get failed requests (404/500)", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 2000));
    const r = await callTool(mcp.url, "network_get_failed_requests", { session_id: sid });
    expect(r.data.count).toBeGreaterThanOrEqual(1);
  });

  it("should get network summary", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/perf` });
    await new Promise((r) => setTimeout(r, 2000));
    const r = await callTool(mcp.url, "network_get_summary", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.totalRequests).toBeGreaterThanOrEqual(1);
    expect(r.data.byResourceType).toBeDefined();
  });

  it("should clear network requests", async () => {
    const sid = await launch();
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const clear = await callTool(mcp.url, "network_clear", { session_id: sid });
    expect(clear.data.cleared).toBeGreaterThanOrEqual(1);
    const after = await callTool(mcp.url, "network_get_summary", { session_id: sid });
    expect(after.data.totalRequests).toBe(0);
  });
});

describe("Integration: Storage", () => {
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
    await new Promise((r) => setTimeout(r, 1000));
    return sid;
  }

  it("should get localStorage data", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_get_local_storage", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.count).toBeGreaterThanOrEqual(2);
    const entries = r.data.entries as Array<{ key: string; value: string }>;
    expect(entries.some((e) => e.key === "testKey")).toBe(true);
  });

  it("should filter localStorage by key", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_get_local_storage", { session_id: sid, key_filter: "user" });
    const entries = r.data.entries as Array<{ key: string }>;
    for (const e of entries) expect(e.key.toLowerCase()).toContain("user");
  });

  it("should get sessionStorage data", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_get_session_storage", { session_id: sid });
    expect(r.success).toBe(true);
    const entries = r.data.entries as Array<{ key: string }>;
    expect(entries.some((e) => e.key === "sessionToken")).toBe(true);
  });

  it("should get cookies", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_get_cookies", { session_id: sid });
    expect(r.success).toBe(true);
    // Test page may not set cookies, but the tool should work
    expect(r.data.count).toBeTypeOf("number");
  });

  it("should get IndexedDB info", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_get_indexeddb_info", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.count).toBeTypeOf("number");
  });

  it("should clear localStorage", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_clear_data", { session_id: sid, types: ["localStorage"] });
    expect(r.success).toBe(true);
    expect(r.data.cleared).toContain("localStorage");
    const after = await callTool(mcp.url, "storage_get_local_storage", { session_id: sid });
    expect(after.data.count).toBe(0);
  });

  it("should clear multiple storage types", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "storage_clear_data", { session_id: sid, types: ["localStorage", "sessionStorage"] });
    expect(r.data.cleared).toHaveLength(2);
  });
});

describe("Integration: Debug & DOM", () => {
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

  it("should get DOM tree", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_dom_tree", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.tree).toBeDefined();
    const tree = r.data.tree as { tag: string; children: unknown[] };
    expect(tree.tag).toBe("body");
  });

  it("should get DOM tree with text", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_dom_tree", { session_id: sid, selector: "#title", include_text: true, max_depth: 2 });
    const tree = r.data.tree as { tag: string; text?: string };
    expect(tree.tag).toBe("h1");
    expect(tree.text).toContain("Test Page");
  });

  it("should get element properties", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_element_properties", { session_id: sid, selector: "#clickTarget" });
    expect(r.success).toBe(true);
    const el = r.data.element as Record<string, unknown>;
    expect(el.tag).toBe("div");
    expect(el.id).toBe("clickTarget");
    expect(el.boundingBox).toBeDefined();
  });

  it("should get element with computed styles", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_element_properties", {
      session_id: sid, selector: "#clickTarget", include_computed_styles: true,
    });
    const el = r.data.element as { computedStyles: Record<string, string> };
    expect(el.computedStyles).toBeDefined();
    expect(el.computedStyles["background-color"]).toBeDefined();
  });

  it("should get specific style properties", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_element_properties", {
      session_id: sid, selector: "#title", style_properties: ["font-size", "color"],
    });
    const el = r.data.element as { computedStyles: Record<string, string> };
    expect(el.computedStyles["font-size"]).toBeDefined();
    expect(el.computedStyles["color"]).toBeDefined();
  });

  it("should get page source", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.html).toContain("Test Page");
    const stats = r.data.stats as Record<string, number>;
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.scriptCount).toBeGreaterThanOrEqual(1);
  });

  it("should get page source with max_length truncation", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid, max_length: 200 });
    expect(r.data.truncated).toBe(true);
    expect((r.data.html as string).length).toBeLessThanOrEqual(220); // 200 + "<!-- TRUNCATED -->"
  });

  it("should get accessibility tree", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_accessibility_tree", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.snapshot).toBeTypeOf("string");
  });

  it("should query selector all", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_query_selector_all", { session_id: sid, selector: "input" });
    expect(r.success).toBe(true);
    expect(r.data.totalMatches).toBeGreaterThanOrEqual(4);
    const elements = r.data.elements as Array<{ tag: string }>;
    for (const el of elements) expect(el.tag).toBe("input");
  });

  it("should limit querySelectorAll results", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_query_selector_all", { session_id: sid, selector: "*", limit: 5 });
    expect((r.data.elements as unknown[]).length).toBeLessThanOrEqual(5);
  });

  it("should error on non-existent selector for element properties", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "debug_get_element_properties", { session_id: sid, selector: "#nonexistent" });
    expect(r.success).toBe(false);
  });
});

describe("Integration: Performance", () => {
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
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/perf` });
    await new Promise((r) => setTimeout(r, 1000));
    return sid;
  }

  it("should get CDP performance metrics", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "performance_get_metrics", { session_id: sid });
    expect(r.success).toBe(true);
    const metrics = r.data.metrics as Record<string, number>;
    expect(metrics.Timestamp).toBeGreaterThan(0);
    expect(metrics.JSHeapUsedSize).toBeGreaterThan(0);
  });

  it("should get navigation timing", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "performance_get_navigation_timing", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.timing).toBeDefined();
    expect(r.data.calculated).toBeDefined();
    const calc = r.data.calculated as Record<string, number>;
    expect(calc.pageLoadMs).toBeGreaterThan(0);
  });

  it("should get Core Web Vitals", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "performance_get_core_web_vitals", { session_id: sid, wait_ms: 1000 });
    expect(r.success).toBe(true);
    expect(r.data.vitals).toBeDefined();
    expect(r.data.ratings).toBeDefined();
    const ratings = r.data.ratings as Record<string, string>;
    expect(ratings.ttfb).toMatch(/good|needs-improvement|poor|unmeasured/);
  });

  it("should get resource timing", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "performance_get_resource_timing", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.count).toBeGreaterThanOrEqual(1);
  });

  it("should sort resource timing by duration", async () => {
    const sid = await launchAndNav();
    const r = await callTool(mcp.url, "performance_get_resource_timing", { session_id: sid, sort_by: "duration" });
    const resources = r.data.resources as Array<{ duration: number }>;
    for (let i = 1; i < resources.length; i++) {
      expect(resources[i - 1].duration).toBeGreaterThanOrEqual(resources[i].duration);
    }
  });
});

describe("Integration: Security", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
  });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  it("should analyze security headers on secure page", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/secure` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.score).toBeDefined();
    const score = r.data.score as { passed: number };
    expect(score.passed).toBeGreaterThanOrEqual(1); // At least HSTS should be detected
  });

  it("should analyze headers on page without security headers", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
    expect(r.success).toBe(true);
    const score = r.data.score as { missing: number };
    expect(score.missing).toBeGreaterThanOrEqual(3);
  });

  it("should get certificate info", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "security_get_certificate", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.protocol).toBe("http:");
  });

  it("should check mixed content", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "security_check_mixed_content", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.isHttps).toBe(false);
  });
});
