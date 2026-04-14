import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";
import type { SecurityHeaderAnalysis } from "../types.js";

export function registerSecurityTools(server: McpServer): void {
  server.registerTool(
    "security_analyze_headers",
    {
      title: "Analyze Security Headers",
      description: `Analyze HTTP security headers of the current page's main document. Checks HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc.

Args:
  - session_id (string): Browser session ID

Returns:
  { url, analysis: SecurityHeaderAnalysis[], score }`,
      inputSchema: { session_id: z.string().describe("Browser session ID") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const docRequests = [...session.capturedRequests.values()]
          .filter((r) => r.resourceType === "Document" && r.responseHeaders);
        const mainDoc = docRequests[docRequests.length - 1];

        if (!mainDoc?.responseHeaders) {
          return makeError(params.session_id, "NO_DATA", "No document response headers. Navigate to a page first.");
        }

        const rawHeaders = mainDoc.responseHeaders;
        // Normalize headers to lowercase for comparison
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(rawHeaders)) {
          headers[k.toLowerCase()] = v;
        }
        const analysis: SecurityHeaderAnalysis[] = [];

        const checks: Array<{ header: string; check: (v: string | undefined) => SecurityHeaderAnalysis }> = [
          { header: "strict-transport-security", check: (v) => ({
            header: "Strict-Transport-Security", present: !!v, value: v,
            rating: v ? (v.includes("max-age=") && parseInt(v.split("max-age=")[1]) >= 31536000 ? "good" : "warning") : "missing",
            recommendation: !v ? "Add HSTS with max-age >= 31536000" : undefined,
          })},
          { header: "content-security-policy", check: (v) => ({
            header: "Content-Security-Policy", present: !!v,
            value: v ? (v.length > 200 ? v.slice(0, 200) + "…" : v) : undefined,
            rating: v ? "good" : "missing",
            recommendation: !v ? "Add CSP to prevent XSS" : undefined,
          })},
          { header: "x-frame-options", check: (v) => ({
            header: "X-Frame-Options", present: !!v, value: v,
            rating: v ? (["DENY", "SAMEORIGIN"].includes(v.toUpperCase()) ? "good" : "warning") : "missing",
            recommendation: !v ? "Add X-Frame-Options: DENY" : undefined,
          })},
          { header: "x-content-type-options", check: (v) => ({
            header: "X-Content-Type-Options", present: !!v, value: v,
            rating: v === "nosniff" ? "good" : v ? "warning" : "missing",
            recommendation: !v ? "Add nosniff" : undefined,
          })},
          { header: "referrer-policy", check: (v) => ({
            header: "Referrer-Policy", present: !!v, value: v,
            rating: v ? "good" : "missing",
          })},
          { header: "permissions-policy", check: (v) => ({
            header: "Permissions-Policy", present: !!v, value: v?.slice(0, 200),
            rating: v ? "good" : "missing",
          })},
        ];

        for (const c of checks) analysis.push(c.check(headers[c.header]));
        const score = {
          total: analysis.length,
          passed: analysis.filter((a) => a.rating === "good").length,
          warnings: analysis.filter((a) => a.rating === "warning").length,
          missing: analysis.filter((a) => a.rating === "missing").length,
        };

        return makeSuccess(params.session_id, { url: mainDoc.url, analysis, score }, start);
      } catch (err) {
        return makeError(params.session_id, "SECURITY_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  server.registerTool(
    "security_get_certificate",
    {
      title: "Get SSL Certificate Info",
      description: `Get SSL/TLS info for the current page.

Args:
  - session_id (string): Browser session ID

Returns:
  { url, protocol, isSecure, cdpSecurityState }`,
      inputSchema: { session_id: z.string().describe("Browser session ID") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const securityInfo = await session.page.evaluate(() => ({
          url: window.location.href,
          protocol: window.location.protocol,
          isSecure: window.location.protocol === "https:",
        }));

        let cdpState: unknown = null;
        try {
          cdpState = await session.cdpSession.send("Security.enable");
        } catch { /* OK */ }

        return makeSuccess(params.session_id, { ...securityInfo, cdpState }, start);
      } catch (err) {
        return makeError(params.session_id, "SECURITY_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  server.registerTool(
    "security_check_mixed_content",
    {
      title: "Check Mixed Content",
      description: `Check for HTTP resources loaded on an HTTPS page.

Args:
  - session_id (string): Browser session ID

Returns:
  { isHttps, mixedContentRequests, count, verdict }`,
      inputSchema: { session_id: z.string().describe("Browser session ID") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const pageUrl = session.page.url();
        const isHttps = pageUrl.startsWith("https://");
        const mixed = [...session.capturedRequests.values()]
          .filter((r) => isHttps && r.url.startsWith("http://") && !r.url.startsWith("http://localhost"))
          .map((r) => ({ url: r.url, resourceType: r.resourceType, status: r.status }));

        return makeSuccess(params.session_id, {
          pageUrl, isHttps, mixedContentRequests: mixed, count: mixed.length,
          verdict: !isHttps ? "N/A (HTTP page)" : mixed.length === 0 ? "Clean" : `${mixed.length} mixed content issue(s)`,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "SECURITY_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
