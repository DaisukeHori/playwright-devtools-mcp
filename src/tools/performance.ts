import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerPerformanceTools(server: McpServer): void {
  // ─── performance_get_metrics ───────────────────────────────────
  server.registerTool(
    "performance_get_metrics",
    {
      title: "Get Performance Metrics",
      description: `Get CDP Performance.getMetrics data: JS heap size, DOM node count, layout count, script duration, and more.

Args:
  - session_id (string): Browser session ID

Returns:
  { metrics: Record<string, number> }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const result = await session.cdpSession.send("Performance.getMetrics") as { metrics: Array<{ name: string; value: number }> };
        const metrics: Record<string, number> = {};
        for (const m of result.metrics) {
          metrics[m.name] = m.value;
        }
        return makeSuccess(params.session_id, { metrics }, start);
      } catch (err) {
        return makeError(params.session_id, "PERF_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── performance_get_navigation_timing ─────────────────────────
  server.registerTool(
    "performance_get_navigation_timing",
    {
      title: "Get Navigation Timing",
      description: `Get Navigation Timing API data: DNS lookup, TCP connect, request/response times, DOM processing, load event timing.

Args:
  - session_id (string): Browser session ID

Returns:
  { timing: NavigationTiming, calculated: { dnsLookup, tcpConnect, ttfb, contentDownload, domProcessing, pageLoad } }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const timing = await session.page.evaluate(() => {
          const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
          if (!nav) return null;
          return {
            startTime: nav.startTime,
            redirectStart: nav.redirectStart,
            redirectEnd: nav.redirectEnd,
            fetchStart: nav.fetchStart,
            domainLookupStart: nav.domainLookupStart,
            domainLookupEnd: nav.domainLookupEnd,
            connectStart: nav.connectStart,
            connectEnd: nav.connectEnd,
            secureConnectionStart: nav.secureConnectionStart,
            requestStart: nav.requestStart,
            responseStart: nav.responseStart,
            responseEnd: nav.responseEnd,
            domInteractive: nav.domInteractive,
            domContentLoadedEventStart: nav.domContentLoadedEventStart,
            domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
            domComplete: nav.domComplete,
            loadEventStart: nav.loadEventStart,
            loadEventEnd: nav.loadEventEnd,
            duration: nav.duration,
            transferSize: nav.transferSize,
            encodedBodySize: nav.encodedBodySize,
            decodedBodySize: nav.decodedBodySize,
          };
        });

        if (!timing) {
          return makeError(params.session_id, "NO_DATA", "No navigation timing data available. Navigate to a page first.");
        }

        const calculated = {
          dnsLookupMs: timing.domainLookupEnd - timing.domainLookupStart,
          tcpConnectMs: timing.connectEnd - timing.connectStart,
          tlsHandshakeMs: timing.secureConnectionStart > 0 ? timing.connectEnd - timing.secureConnectionStart : 0,
          ttfbMs: timing.responseStart - timing.requestStart,
          contentDownloadMs: timing.responseEnd - timing.responseStart,
          domProcessingMs: timing.domComplete - timing.responseEnd,
          domContentLoadedMs: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
          pageLoadMs: timing.loadEventEnd - timing.startTime,
          totalDurationMs: timing.duration,
        };

        return makeSuccess(params.session_id, { timing, calculated }, start);
      } catch (err) {
        return makeError(params.session_id, "PERF_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── performance_get_core_web_vitals ───────────────────────────
  server.registerTool(
    "performance_get_core_web_vitals",
    {
      title: "Get Core Web Vitals",
      description: `Measure Core Web Vitals: LCP (Largest Contentful Paint), CLS (Cumulative Layout Shift), FCP (First Contentful Paint), TTFB (Time to First Byte).
Note: FID (First Input Delay) requires user interaction.

Args:
  - session_id (string): Browser session ID
  - wait_ms (number, optional): Wait time in ms before measuring to allow for layout shifts (default: 3000)

Returns:
  { vitals: { lcp, cls, fcp, ttfb }, ratings: { lcp: "good"|"needs-improvement"|"poor", ... } }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        wait_ms: z.number().int().min(0).max(30000).default(3000).describe("Wait before measuring (ms)"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);

        // Wait for stability
        if (params.wait_ms > 0) {
          await session.page.waitForTimeout(params.wait_ms);
        }

        const vitals = await session.page.evaluate(() => {
          return new Promise<Record<string, number | null>>((resolve) => {
            const result: Record<string, number | null> = {
              lcp: null,
              cls: null,
              fcp: null,
              ttfb: null,
            };

            // TTFB from Navigation Timing
            const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
            if (nav) {
              result.ttfb = nav.responseStart - nav.requestStart;
            }

            // FCP from Paint Timing
            const paintEntries = performance.getEntriesByType("paint");
            const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");
            if (fcp) {
              result.fcp = fcp.startTime;
            }

            // LCP via PerformanceObserver
            let lcpValue: number | null = null;
            try {
              const lcpObserver = new PerformanceObserver((list) => {
                const entries = list.getEntries();
                if (entries.length > 0) {
                  lcpValue = entries[entries.length - 1].startTime;
                }
              });
              lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
              setTimeout(() => lcpObserver.disconnect(), 100);
            } catch { /* not supported */ }

            // CLS via PerformanceObserver
            let clsValue = 0;
            try {
              const clsObserver = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  if (!(entry as any).hadRecentInput) {
                    clsValue += (entry as any).value ?? 0;
                  }
                }
              });
              clsObserver.observe({ type: "layout-shift", buffered: true });
              setTimeout(() => clsObserver.disconnect(), 100);
            } catch { /* not supported */ }

            // Collect after short delay
            setTimeout(() => {
              result.lcp = lcpValue;
              result.cls = clsValue;
              resolve(result);
            }, 200);
          });
        });

        // Rate the vitals
        const rate = (metric: string, value: number | null): string => {
          if (value === null) return "unmeasured";
          switch (metric) {
            case "lcp": return value <= 2500 ? "good" : value <= 4000 ? "needs-improvement" : "poor";
            case "cls": return value <= 0.1 ? "good" : value <= 0.25 ? "needs-improvement" : "poor";
            case "fcp": return value <= 1800 ? "good" : value <= 3000 ? "needs-improvement" : "poor";
            case "ttfb": return value <= 800 ? "good" : value <= 1800 ? "needs-improvement" : "poor";
            default: return "unknown";
          }
        };

        const ratings: Record<string, string> = {};
        for (const [key, value] of Object.entries(vitals)) {
          ratings[key] = rate(key, value as number | null);
        }

        return makeSuccess(params.session_id, { vitals, ratings }, start);
      } catch (err) {
        return makeError(params.session_id, "PERF_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── performance_get_resource_timing ───────────────────────────
  server.registerTool(
    "performance_get_resource_timing",
    {
      title: "Get Resource Timing",
      description: `Get Resource Timing API entries: individual resource load times, sizes, and initiators.

Args:
  - session_id (string): Browser session ID
  - resource_type (string, optional): Filter by initiator type e.g. "script", "link", "img", "xmlhttprequest", "fetch"
  - sort_by (string, optional): Sort by "duration", "transferSize", "startTime" (default: "duration")
  - limit (number, optional): Max entries (default: 50)

Returns:
  { resources: ResourceTimingEntry[], count: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        resource_type: z.string().optional().describe("Filter by initiator type"),
        sort_by: z.enum(["duration", "transferSize", "startTime"]).default("duration").describe("Sort field"),
        limit: z.number().int().min(1).max(200).default(50).describe("Max entries"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const resources = await session.page.evaluate(
          (opts: { resourceType?: string; sortBy: string; limit: number }) => {
            let entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
            if (opts.resourceType) {
              entries = entries.filter((e) => e.initiatorType === opts.resourceType);
            }
            entries.sort((a, b) => {
              switch (opts.sortBy) {
                case "duration": return b.duration - a.duration;
                case "transferSize": return b.transferSize - a.transferSize;
                case "startTime": return a.startTime - b.startTime;
                default: return 0;
              }
            });
            return entries.slice(0, opts.limit).map((e) => ({
              name: e.name.length > 150 ? e.name.slice(0, 150) + "…" : e.name,
              initiatorType: e.initiatorType,
              startTime: Math.round(e.startTime),
              duration: Math.round(e.duration),
              transferSize: e.transferSize,
              encodedBodySize: e.encodedBodySize,
              decodedBodySize: e.decodedBodySize,
            }));
          },
          { resourceType: params.resource_type, sortBy: params.sort_by, limit: params.limit }
        );

        return makeSuccess(params.session_id, { resources, count: resources.length }, start);
      } catch (err) {
        return makeError(params.session_id, "PERF_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
