import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { type Server } from "http";
import { startTestHttpServer, startStaticServer, callTool, cleanupAllSessions } from "../helpers/test-utils.js";

describe("Integration: DOM Comprehensive", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };
  let sid: string;

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
    const r = await callTool(mcp.url, "browser_launch", {});
    sid = r.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
  });
  afterAll(async () => { await cleanupAllSessions(); mcp.server.close(); app.server.close(); });

  // ─── DOM Tree with various selectors ──────────────────────────
  const selectors = ["body", "#title", "#testForm", "#clickTarget", "#dragSource", "#dropTarget", "h1", "form", "select"];
  for (const sel of selectors) {
    it(`should get DOM tree for selector: ${sel}`, async () => {
      const r = await callTool(mcp.url, "debug_get_dom_tree", { session_id: sid, selector: sel, max_depth: 3 });
      expect(r.success).toBe(true);
      expect(r.data.tree).toBeDefined();
    });
  }

  // ─── Element properties for various elements ──────────────────
  const elements = [
    { sel: "#title", expectTag: "h1" },
    { sel: "#clickTarget", expectTag: "div" },
    { sel: "#username", expectTag: "input" },
    { sel: "#password", expectTag: "input" },
    { sel: "#email", expectTag: "input" },
    { sel: "#role", expectTag: "select" },
    { sel: "#notes", expectTag: "textarea" },
    { sel: "#submitBtn", expectTag: "button" },
    { sel: "#testForm", expectTag: "form" },
    { sel: "#counter", expectTag: "p" },
  ];
  for (const { sel, expectTag } of elements) {
    it(`should get element properties for ${sel} (${expectTag})`, async () => {
      const r = await callTool(mcp.url, "debug_get_element_properties", { session_id: sid, selector: sel });
      expect(r.success).toBe(true);
      const el = r.data.element as { tag: string };
      expect(el.tag).toBe(expectTag);
    });

    it(`should get bounding box for ${sel}`, async () => {
      const r = await callTool(mcp.url, "debug_get_element_properties", { session_id: sid, selector: sel });
      const bb = (r.data.element as Record<string, unknown>).boundingBox as Record<string, number>;
      expect(bb).toBeDefined();
      expect(bb.width).toBeGreaterThanOrEqual(0);
      expect(bb.height).toBeGreaterThanOrEqual(0);
    });
  }

  // ─── querySelectorAll for various selectors ───────────────────
  const qsTests: Array<{ sel: string; minCount: number }> = [
    { sel: "input", minCount: 4 },
    { sel: "div", minCount: 3 },
    { sel: "p", minCount: 2 },
    { sel: "button", minCount: 1 },
    { sel: "select", minCount: 1 },
    { sel: "option", minCount: 4 },
    { sel: "textarea", minCount: 1 },
    { sel: "[type='text']", minCount: 1 },
    { sel: "[type='password']", minCount: 1 },
    { sel: "[placeholder]", minCount: 3 },
    { sel: "form > *", minCount: 4 },
    { sel: "#testForm input", minCount: 4 },
  ];
  for (const { sel, minCount } of qsTests) {
    it(`querySelectorAll("${sel}") should find >= ${minCount} elements`, async () => {
      const r = await callTool(mcp.url, "debug_query_selector_all", { session_id: sid, selector: sel });
      expect(r.success).toBe(true);
      expect(r.data.totalMatches).toBeGreaterThanOrEqual(minCount);
    });
  }

  // ─── CSS computed styles ──────────────────────────────────────
  const cssTests = ["display", "position", "color", "font-size", "width", "height", "margin", "padding"];
  for (const prop of cssTests) {
    it(`should get computed style "${prop}" for #clickTarget`, async () => {
      const r = await callTool(mcp.url, "debug_get_element_properties", {
        session_id: sid, selector: "#clickTarget", style_properties: [prop],
      });
      const styles = (r.data.element as { computedStyles: Record<string, string> }).computedStyles;
      expect(styles[prop]).toBeDefined();
      expect(styles[prop]).toBeTypeOf("string");
    });
  }

  // ─── Page source stats ────────────────────────────────────────
  it("should report accurate node count", async () => {
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid });
    expect((r.data.stats as { nodeCount: number }).nodeCount).toBeGreaterThan(10);
  });

  it("should report script count", async () => {
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid });
    expect((r.data.stats as { scriptCount: number }).scriptCount).toBeGreaterThanOrEqual(1);
  });

  it("should report form count", async () => {
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid });
    expect((r.data.stats as { formCount: number }).formCount).toBeGreaterThanOrEqual(1);
  });

  it("should report link count", async () => {
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid });
    expect((r.data.stats as { linkCount: number }).linkCount).toBeTypeOf("number");
  });

  it("should include HTML content in page source", async () => {
    const r = await callTool(mcp.url, "debug_get_page_source", { session_id: sid, selector: "#testForm" });
    expect(r.data.html).toContain("form");
    expect(r.data.html).toContain("username");
  });

  it("should get accessibility tree as string", async () => {
    const r = await callTool(mcp.url, "debug_get_accessibility_tree", { session_id: sid });
    expect(r.success).toBe(true);
    expect(r.data.snapshot).toBeTypeOf("string");
    expect((r.data.snapshot as string).length).toBeGreaterThan(0);
  });
});

describe("Integration: Security Comprehensive", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => { mcp = await startTestHttpServer(); app = await startStaticServer(); });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  // ─── Security headers on secure page ──────────────────────────
  const expectedHeaders = [
    "Strict-Transport-Security",
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
  ];

  for (const header of expectedHeaders) {
    it(`should detect "${header}" on /secure page`, async () => {
      const r0 = await callTool(mcp.url, "browser_launch", {});
      const sid = r0.data.session_id as string;
      await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/secure` });
      await new Promise((r) => setTimeout(r, 1000));
      const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
      const analysis = r.data.analysis as Array<{ header: string; present: boolean }>;
      const found = analysis.find((a) => a.header === header);
      expect(found).toBeDefined();
      expect(found!.present).toBe(true);
    });
  }

  it("should rate HSTS as 'good' with proper max-age", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/secure` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
    const hsts = (r.data.analysis as Array<{ header: string; rating: string }>).find((a) => a.header === "Strict-Transport-Security");
    expect(hsts?.rating).toBe("good");
  });

  it("should rate XFO as 'good' with DENY", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/secure` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
    const xfo = (r.data.analysis as Array<{ header: string; rating: string }>).find((a) => a.header === "X-Frame-Options");
    expect(xfo?.rating).toBe("good");
  });

  // ─── Missing headers on insecure page ─────────────────────────
  for (const header of expectedHeaders) {
    it(`should detect missing "${header}" on / page`, async () => {
      const r0 = await callTool(mcp.url, "browser_launch", {});
      const sid = r0.data.session_id as string;
      await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
      await new Promise((r) => setTimeout(r, 1000));
      const r = await callTool(mcp.url, "security_analyze_headers", { session_id: sid });
      const analysis = r.data.analysis as Array<{ header: string; present: boolean; rating: string }>;
      const found = analysis.find((a) => a.header === header);
      expect(found).toBeDefined();
      expect(found!.present).toBe(false);
      expect(found!.rating).toBe("missing");
    });
  }

  it("should report HTTP protocol for local server", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "security_get_certificate", { session_id: sid });
    expect(r.data.protocol).toBe("http:");
    expect(r.data.isSecure).toBe(false);
  });

  it("should report no mixed content on HTTP page", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    const r = await callTool(mcp.url, "security_check_mixed_content", { session_id: sid });
    expect(r.data.verdict).toContain("N/A");
  });
});

describe("Integration: Console Deep", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };

  beforeAll(async () => { mcp = await startTestHttpServer(); app = await startStaticServer(); });
  afterEach(async () => { await cleanupAllSessions(); });
  afterAll(async () => { mcp.server.close(); app.server.close(); });

  it("should capture all log types from error page", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid });
    const types = new Set((r.data.logs as Array<{ type: string }>).map((l) => l.type));
    expect(types.has("error")).toBe(true);
    expect(types.has("warning")).toBe(true);
  });

  it("should filter by since timestamp", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await new Promise((r) => setTimeout(r, 500));
    const now = Date.now();
    // Generate new log
    await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "console.log('after-timestamp')" });
    await new Promise((r) => setTimeout(r, 300));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, since: now });
    const logs = r.data.logs as Array<{ text: string }>;
    expect(logs.some((l) => l.text.includes("after-timestamp"))).toBe(true);
  });

  it("should capture console.log from evaluate", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
    await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: "console.log('dynamic-log-test')" });
    await new Promise((r) => setTimeout(r, 300));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, search: "dynamic-log-test" });
    expect(r.data.filtered).toBeGreaterThanOrEqual(1);
  });

  it("should capture page errors", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1500));
    const r = await callTool(mcp.url, "console_get_exceptions", { session_id: sid });
    expect(r.data.count).toBeGreaterThanOrEqual(1);
    const exceptions = r.data.exceptions as Array<{ text: string }>;
    expect(exceptions.some((e) => e.text.includes("Uncaught") || e.text.includes("error"))).toBe(true);
  });

  it("should respect limit parameter for logs", async () => {
    const r0 = await callTool(mcp.url, "browser_launch", {});
    const sid = r0.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: `${app.url}/errors` });
    await new Promise((r) => setTimeout(r, 1000));
    const r = await callTool(mcp.url, "console_get_logs", { session_id: sid, limit: 1 });
    expect((r.data.logs as unknown[]).length).toBe(1);
  });
});

describe("Integration: JavaScript Evaluation Scenarios", () => {
  let mcp: { server: Server; url: string };
  let app: { server: Server; url: string };
  let sid: string;

  beforeAll(async () => {
    mcp = await startTestHttpServer();
    app = await startStaticServer();
    const r = await callTool(mcp.url, "browser_launch", {});
    sid = r.data.session_id as string;
    await callTool(mcp.url, "browser_navigate", { session_id: sid, url: app.url });
  });
  afterAll(async () => { await cleanupAllSessions(); mcp.server.close(); app.server.close(); });

  const evalTests: Array<{ expr: string; expected: unknown; desc: string }> = [
    { expr: "1 + 1", expected: 2, desc: "arithmetic" },
    { expr: "'hello' + ' world'", expected: "hello world", desc: "string concat" },
    { expr: "Math.max(1,2,3)", expected: 3, desc: "Math function" },
    { expr: "typeof window", expected: "object", desc: "typeof window" },
    { expr: "document.title", expected: "Test Page", desc: "document.title" },
    { expr: "location.protocol", expected: "http:", desc: "location.protocol" },
    { expr: "navigator.language", expected: "ja-JP", desc: "navigator.language" },
    { expr: "Array.isArray([])", expected: true, desc: "Array.isArray" },
    { expr: "JSON.stringify({a:1})", expected: '{"a":1}', desc: "JSON.stringify" },
    { expr: "null", expected: null, desc: "null literal" },
    { expr: "undefined", expected: undefined, desc: "undefined literal" },
    { expr: "[1,2,3].length", expected: 3, desc: "array length" },
    { expr: "Object.keys({a:1,b:2}).length", expected: 2, desc: "Object.keys" },
    { expr: "Date.now() > 0", expected: true, desc: "Date.now" },
    { expr: "window.innerWidth", expected: 1280, desc: "viewport width" },
    { expr: "window.innerHeight", expected: 720, desc: "viewport height" },
    { expr: "document.querySelectorAll('input').length", expected: expect.any(Number), desc: "DOM query count" },
    { expr: "document.getElementById('title').tagName", expected: "H1", desc: "getElementById" },
    { expr: "Boolean(document.getElementById('testForm'))", expected: true, desc: "form exists" },
    { expr: "document.getElementsByTagName('select').length", expected: 1, desc: "getElementsByTagName" },
  ];

  for (const { expr, expected, desc } of evalTests) {
    it(`should evaluate: ${desc}`, async () => {
      const r = await callTool(mcp.url, "browser_evaluate", { session_id: sid, expression: expr });
      expect(r.success).toBe(true);
      if (expected !== undefined && typeof expected !== "object") {
        expect(r.data.result).toBe(expected);
      }
    });
  }

  it("should handle async evaluation", async () => {
    const r = await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "new Promise(r => setTimeout(() => r(42), 100))",
    });
    expect(r.data.result).toBe(42);
  });

  it("should handle evaluation errors gracefully", async () => {
    const r = await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "nonExistentFunction()",
    });
    expect(r.success).toBe(false);
  });

  it("should modify DOM via evaluate", async () => {
    await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "document.getElementById('title').textContent = 'Modified'",
    });
    const r = await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "document.getElementById('title').textContent",
    });
    expect(r.data.result).toBe("Modified");
    // Restore
    await callTool(mcp.url, "browser_evaluate", {
      session_id: sid, expression: "document.getElementById('title').textContent = 'Test Page'",
    });
  });
});
