import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";
import { CHARACTER_LIMIT, MAX_DOM_DEPTH } from "../constants.js";

export function registerDebugTools(server: McpServer): void {
  // ─── debug_get_dom_tree ────────────────────────────────────────
  server.registerTool(
    "debug_get_dom_tree",
    {
      title: "Get DOM Tree",
      description: `Get a structured DOM tree representation of the page or a subtree.

Args:
  - session_id (string): Browser session ID
  - selector (string, optional): CSS selector for subtree root (default: "body")
  - max_depth (number, optional): Maximum tree depth (default: 5)
  - include_text (boolean, optional): Include text content (default: false)

Returns:
  { tree: DOMNode }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().default("body").describe("CSS selector for subtree root"),
        max_depth: z.number().int().min(1).max(MAX_DOM_DEPTH).default(5).describe("Max depth"),
        include_text: z.boolean().default(false).describe("Include text content"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const tree = await session.page.evaluate(
          (opts: { selector: string; maxDepth: number; includeText: boolean }) => {
            function serialize(el: Element, depth: number): Record<string, unknown> | null {
              if (depth > opts.maxDepth) return { tag: el.tagName.toLowerCase(), childCount: el.children.length };
              const node: Record<string, unknown> = {
                tag: el.tagName.toLowerCase(),
              };
              if (el.id) node.id = el.id;
              if (el.className && typeof el.className === "string") {
                const classes = el.className.trim().split(/\s+/).filter(Boolean);
                if (classes.length > 0) node.classes = classes;
              }
              // Attributes (skip class and id)
              const attrs: Record<string, string> = {};
              for (const attr of Array.from(el.attributes)) {
                if (attr.name !== "class" && attr.name !== "id") {
                  attrs[attr.name] = attr.value.slice(0, 200);
                }
              }
              if (Object.keys(attrs).length > 0) node.attributes = attrs;

              if (opts.includeText && el.children.length === 0) {
                const text = el.textContent?.trim();
                if (text) node.text = text.slice(0, 200);
              }

              if (el.children.length > 0) {
                const children = Array.from(el.children)
                  .map((child) => serialize(child, depth + 1))
                  .filter(Boolean);
                node.children = children;
                node.childCount = el.children.length;
              }
              return node;
            }

            const root = document.querySelector(opts.selector);
            if (!root) return null;
            return serialize(root, 0);
          },
          { selector: params.selector, maxDepth: params.max_depth, includeText: params.include_text }
        );

        if (!tree) {
          return makeError(params.session_id, "NOT_FOUND", `No element found for selector: ${params.selector}`);
        }

        return makeSuccess(params.session_id, { tree }, start);
      } catch (err) {
        return makeError(params.session_id, "DEBUG_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── debug_get_element_properties ──────────────────────────────
  server.registerTool(
    "debug_get_element_properties",
    {
      title: "Get Element Properties",
      description: `Deep inspection of a specific element: attributes, computed styles, bounding box, dimensions, accessibility properties.

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector for the element
  - include_computed_styles (boolean, optional): Include computed CSS styles (default: false, can be large)
  - style_properties (array, optional): Specific CSS properties to include (instead of all)

Returns:
  { element: ElementProperties }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector"),
        include_computed_styles: z.boolean().default(false).describe("Include all computed styles"),
        style_properties: z.array(z.string()).optional().describe("Specific CSS properties to include"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const props = await session.page.evaluate(
          (opts: { selector: string; includeStyles: boolean; styleProps?: string[] }) => {
            const el = document.querySelector(opts.selector);
            if (!el) return null;

            const result: Record<string, unknown> = {
              tag: el.tagName.toLowerCase(),
              id: el.id || undefined,
              classes: el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [],
            };

            // All attributes
            const attrs: Record<string, string> = {};
            for (const attr of Array.from(el.attributes)) {
              attrs[attr.name] = attr.value;
            }
            result.attributes = attrs;

            // Bounding box
            const rect = el.getBoundingClientRect();
            result.boundingBox = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              top: Math.round(rect.top),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
              left: Math.round(rect.left),
            };

            // Text content (truncated)
            result.innerText = (el as HTMLElement).innerText?.slice(0, 1000);
            result.innerHTML = el.innerHTML?.slice(0, 2000);

            // Computed styles
            if (opts.includeStyles || opts.styleProps) {
              const computed = getComputedStyle(el);
              const styles: Record<string, string> = {};
              if (opts.styleProps) {
                for (const prop of opts.styleProps) {
                  styles[prop] = computed.getPropertyValue(prop);
                }
              } else {
                // Top common properties
                const common = [
                  "display", "position", "width", "height", "margin", "padding",
                  "border", "background-color", "color", "font-family", "font-size",
                  "font-weight", "line-height", "opacity", "z-index", "overflow",
                  "visibility", "flex-direction", "justify-content", "align-items",
                  "grid-template-columns", "grid-template-rows",
                ];
                for (const prop of common) {
                  styles[prop] = computed.getPropertyValue(prop);
                }
              }
              result.computedStyles = styles;
            }

            // Accessibility
            result.accessibility = {
              role: el.getAttribute("role") ?? (el as HTMLElement).ariaRoleDescription ?? undefined,
              ariaLabel: el.getAttribute("aria-label") ?? undefined,
              ariaDescribedBy: el.getAttribute("aria-describedby") ?? undefined,
              ariaExpanded: el.getAttribute("aria-expanded") ?? undefined,
              ariaHidden: el.getAttribute("aria-hidden") ?? undefined,
              tabIndex: (el as HTMLElement).tabIndex,
            };

            return result;
          },
          {
            selector: params.selector,
            includeStyles: params.include_computed_styles,
            styleProps: params.style_properties,
          }
        );

        if (!props) {
          return makeError(params.session_id, "NOT_FOUND", `No element found for selector: ${params.selector}`);
        }

        return makeSuccess(params.session_id, { element: props }, start);
      } catch (err) {
        return makeError(params.session_id, "DEBUG_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── debug_get_page_source ─────────────────────────────────────
  server.registerTool(
    "debug_get_page_source",
    {
      title: "Get Page Source",
      description: `Get the current DOM HTML source and page statistics (node count, script count, etc).

Args:
  - session_id (string): Browser session ID
  - selector (string, optional): CSS selector for a subtree (default: "html" = full page)
  - max_length (number, optional): Max HTML length to return (default: 30000)

Returns:
  { html: string, stats: { nodeCount, scriptCount, styleCount, imageCount, formCount, linkCount }, truncated: boolean }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().default("html").describe("CSS selector"),
        max_length: z.number().int().min(100).max(100000).default(30000).describe("Max HTML length"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const result = await session.page.evaluate((selector: string) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          return {
            html: el.outerHTML,
            stats: {
              nodeCount: document.querySelectorAll("*").length,
              scriptCount: document.querySelectorAll("script").length,
              styleCount: document.querySelectorAll("style, link[rel='stylesheet']").length,
              imageCount: document.querySelectorAll("img").length,
              formCount: document.querySelectorAll("form").length,
              linkCount: document.querySelectorAll("a[href]").length,
              iframeCount: document.querySelectorAll("iframe").length,
            },
          };
        }, params.selector);

        if (!result) {
          return makeError(params.session_id, "NOT_FOUND", `No element found for selector: ${params.selector}`);
        }

        const truncated = result.html.length > params.max_length;
        const html = truncated ? result.html.slice(0, params.max_length) + "\n<!-- TRUNCATED -->" : result.html;

        return makeSuccess(params.session_id, {
          html,
          stats: result.stats,
          truncated,
          originalLength: result.html.length,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "DEBUG_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── debug_get_accessibility_tree ──────────────────────────────
  server.registerTool(
    "debug_get_accessibility_tree",
    {
      title: "Get Accessibility Tree",
      description: `Get the page's accessibility tree snapshot via Playwright's ARIA snapshot. Shows the same structure screen readers use.

Args:
  - session_id (string): Browser session ID

Returns:
  { snapshot: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const snapshot = await session.page.locator("body").ariaSnapshot({ timeout: 10000 });
        if (!snapshot) {
          return makeError(params.session_id, "NO_DATA", "No accessibility tree available");
        }

        // Truncate if too large
        const truncated = snapshot.length > CHARACTER_LIMIT;
        const result = truncated ? snapshot.slice(0, CHARACTER_LIMIT) + "\n... (truncated)" : snapshot;

        return makeSuccess(params.session_id, { snapshot: result, truncated }, start);
      } catch (err) {
        return makeError(params.session_id, "DEBUG_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── debug_query_selector_all ──────────────────────────────────
  server.registerTool(
    "debug_query_selector_all",
    {
      title: "Query Selector All",
      description: `Find all elements matching a CSS selector and return a summary of each.

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector
  - limit (number, optional): Max elements (default: 50)

Returns:
  { elements: [{ index, tag, id, classes, text, visible }], count: number, totalMatches: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector"),
        limit: z.number().int().min(1).max(200).default(50).describe("Max elements"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const result = await session.page.evaluate(
          (opts: { selector: string; limit: number }) => {
            const all = document.querySelectorAll(opts.selector);
            const totalMatches = all.length;
            const elements: Array<{
              index: number;
              tag: string;
              id: string;
              classes: string[];
              text: string;
              visible: boolean;
              href?: string;
              src?: string;
              type?: string;
            }> = [];

            for (let i = 0; i < Math.min(all.length, opts.limit); i++) {
              const el = all[i];
              const rect = el.getBoundingClientRect();
              const htmlEl = el as HTMLElement;
              elements.push({
                index: i,
                tag: el.tagName.toLowerCase(),
                id: el.id || "",
                classes: el.className && typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [],
                text: htmlEl.innerText?.slice(0, 100)?.trim() ?? "",
                visible: rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden",
                href: el.getAttribute("href") ?? undefined,
                src: el.getAttribute("src") ?? undefined,
                type: el.getAttribute("type") ?? undefined,
              });
            }
            return { elements, totalMatches };
          },
          { selector: params.selector, limit: params.limit }
        );

        return makeSuccess(params.session_id, {
          elements: result.elements,
          count: result.elements.length,
          totalMatches: result.totalMatches,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "DEBUG_ERROR", `Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
