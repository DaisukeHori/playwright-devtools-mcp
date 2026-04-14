import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser-manager.js";
import { makeSuccess, makeError } from "../schemas/shared.js";

export function registerInteractiveTools(server: McpServer): void {
  // ─── interact_click_at ─────────────────────────────────────────
  server.registerTool(
    "interact_click_at",
    {
      title: "Click at Coordinates",
      description: `Click at specific x,y coordinates on the page. Use with browser_screenshot to identify click targets visually.
Useful for elements that are hard to target with CSS selectors (canvas, SVG, iframes, etc).

Args:
  - session_id (string): Browser session ID
  - x (number): X coordinate in pixels from left
  - y (number): Y coordinate in pixels from top
  - button (string, optional): "left", "right", "middle" (default: "left")
  - click_count (number, optional): 1=single, 2=double, 3=triple (default: 1)
  - modifiers (array, optional): ["Alt", "Control", "Meta", "Shift"]
  - delay (number, optional): Delay between mousedown and mouseup in ms (default: 0)

Returns:
  { clicked: true, x, y }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        x: z.number().describe("X coordinate in px"),
        y: z.number().describe("Y coordinate in px"),
        button: z.enum(["left", "right", "middle"]).default("left").describe("Mouse button"),
        click_count: z.number().int().min(1).max(3).default(1).describe("Click count"),
        modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).optional().describe("Key modifiers"),
        delay: z.number().int().min(0).max(5000).default(0).describe("Delay between down/up in ms"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        await session.page.mouse.click(params.x, params.y, {
          button: params.button,
          clickCount: params.click_count,
          delay: params.delay,
        });
        // Handle modifiers via keyboard if specified
        if (params.modifiers && params.modifiers.length > 0) {
          // For modifier clicks, use the low-level approach
          for (const mod of params.modifiers) await session.page.keyboard.down(mod);
          await session.page.mouse.click(params.x, params.y, {
            button: params.button,
            clickCount: params.click_count,
            delay: params.delay,
          });
          for (const mod of params.modifiers) await session.page.keyboard.up(mod);
        }
        browserManager.addFlowStep(session, "click_at", `Click at (${params.x}, ${params.y}) [${params.button}]`);
        return makeSuccess(params.session_id, { clicked: true, x: params.x, y: params.y }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Click failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_drag ─────────────────────────────────────────────
  server.registerTool(
    "interact_drag",
    {
      title: "Drag from A to B",
      description: `Drag from one coordinate to another. Useful for sliders, drag-and-drop, resizing, drawing on canvas, etc.

Args:
  - session_id (string): Browser session ID
  - from_x (number): Start X coordinate
  - from_y (number): Start Y coordinate
  - to_x (number): End X coordinate
  - to_y (number): End Y coordinate
  - steps (number, optional): Number of intermediate mouse move steps (default: 10, higher = smoother)

Returns:
  { dragged: true, from: {x,y}, to: {x,y} }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        from_x: z.number().describe("Start X"),
        from_y: z.number().describe("Start Y"),
        to_x: z.number().describe("End X"),
        to_y: z.number().describe("End Y"),
        steps: z.number().int().min(1).max(100).default(10).describe("Move steps"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        await session.page.mouse.move(params.from_x, params.from_y);
        await session.page.mouse.down();
        await session.page.mouse.move(params.to_x, params.to_y, { steps: params.steps });
        await session.page.mouse.up();
        browserManager.addFlowStep(session, "drag",
          `Drag (${params.from_x},${params.from_y}) → (${params.to_x},${params.to_y})`);
        return makeSuccess(params.session_id, {
          dragged: true,
          from: { x: params.from_x, y: params.from_y },
          to: { x: params.to_x, y: params.to_y },
        }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Drag failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_hover ────────────────────────────────────────────
  server.registerTool(
    "interact_hover",
    {
      title: "Hover at Coordinates / Selector",
      description: `Move the mouse to hover over a position or element. Triggers hover styles and tooltips.

Args:
  - session_id (string): Browser session ID
  - x (number, optional): X coordinate (use with y)
  - y (number, optional): Y coordinate (use with x)
  - selector (string, optional): CSS selector to hover (alternative to x,y)

Returns:
  { hovered: true }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        x: z.number().optional().describe("X coordinate"),
        y: z.number().optional().describe("Y coordinate"),
        selector: z.string().optional().describe("CSS selector"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        if (params.selector) {
          await session.page.locator(params.selector).hover();
        } else if (params.x !== undefined && params.y !== undefined) {
          await session.page.mouse.move(params.x, params.y);
        } else {
          return makeError(params.session_id, "INVALID_ARGS", "Provide either selector or both x and y");
        }
        return makeSuccess(params.session_id, { hovered: true }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Hover failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_scroll ───────────────────────────────────────────
  server.registerTool(
    "interact_scroll",
    {
      title: "Scroll Page or Element",
      description: `Scroll the page or a specific element. Supports pixel-based scrolling and scroll-to-element.

Args:
  - session_id (string): Browser session ID
  - direction (string): "up", "down", "left", "right"
  - amount (number, optional): Scroll amount in pixels (default: 500)
  - selector (string, optional): CSS selector of scrollable element (default: page)
  - scroll_to_selector (string, optional): Scroll until this element is visible (overrides direction/amount)

Returns:
  { scrolled: true, scrollPosition: { x, y } }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        direction: z.enum(["up", "down", "left", "right"]).default("down").describe("Scroll direction"),
        amount: z.number().int().min(0).max(10000).default(500).describe("Pixels to scroll"),
        selector: z.string().optional().describe("Scrollable element selector"),
        scroll_to_selector: z.string().optional().describe("Scroll to make this element visible"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);

        if (params.scroll_to_selector) {
          await session.page.locator(params.scroll_to_selector).scrollIntoViewIfNeeded();
        } else {
          const deltaX = params.direction === "left" ? -params.amount : params.direction === "right" ? params.amount : 0;
          const deltaY = params.direction === "up" ? -params.amount : params.direction === "down" ? params.amount : 0;

          if (params.selector) {
            await session.page.locator(params.selector).evaluate(
              (el, opts: { dx: number; dy: number }) => { el.scrollBy(opts.dx, opts.dy); },
              { dx: deltaX, dy: deltaY }
            );
          } else {
            await session.page.mouse.wheel(deltaX, deltaY);
          }
        }

        const scrollPos = await session.page.evaluate(() => ({
          x: window.scrollX, y: window.scrollY,
          maxX: document.documentElement.scrollWidth - window.innerWidth,
          maxY: document.documentElement.scrollHeight - window.innerHeight,
        }));

        return makeSuccess(params.session_id, { scrolled: true, scrollPosition: scrollPos }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Scroll failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_keyboard ─────────────────────────────────────────
  server.registerTool(
    "interact_keyboard",
    {
      title: "Press Keyboard Key(s)",
      description: `Send keyboard input. Supports single keys, shortcuts, and key sequences.

Key names: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12, etc.
Shortcuts: "Control+c", "Meta+a", "Shift+Tab", "Alt+F4"

Args:
  - session_id (string): Browser session ID
  - key (string, optional): Key or shortcut to press (e.g. "Enter", "Control+a")
  - text (string, optional): Text to type (alternative to key, types each character)

Returns:
  { pressed: true }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        key: z.string().optional().describe("Key or shortcut e.g. 'Enter', 'Control+a'"),
        text: z.string().optional().describe("Text to type"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        if (params.key) {
          await session.page.keyboard.press(params.key);
        } else if (params.text) {
          await session.page.keyboard.type(params.text);
        } else {
          return makeError(params.session_id, "INVALID_ARGS", "Provide either key or text");
        }
        browserManager.addFlowStep(session, "keyboard",
          params.key ? `Press key: ${params.key}` : `Type: "${params.text?.slice(0, 30)}"`);
        return makeSuccess(params.session_id, { pressed: true }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Keyboard failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_fill_form ────────────────────────────────────────
  server.registerTool(
    "interact_fill_form",
    {
      title: "Fill Form Field",
      description: `Fill a form field by selector. Uses Playwright's fill() which clears existing content and sets the value directly (faster than typing).

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector of the input/textarea
  - value (string): Value to set

Returns:
  { filled: true, selector }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector"),
        value: z.string().describe("Value to fill"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        await session.page.locator(params.selector).fill(params.value);
        browserManager.addFlowStep(session, "fill",
          `Fill "${params.selector}" with "${params.value.slice(0, 30)}${params.value.length > 30 ? "…" : ""}"`);
        return makeSuccess(params.session_id, { filled: true, selector: params.selector }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Fill failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_select_option ────────────────────────────────────
  server.registerTool(
    "interact_select_option",
    {
      title: "Select Dropdown Option",
      description: `Select an option from a <select> dropdown.

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector of the <select> element
  - value (string, optional): Option value attribute
  - label (string, optional): Option visible text
  - index (number, optional): Option index (0-based)

Returns:
  { selected: string[] }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector of <select>"),
        value: z.string().optional().describe("Option value"),
        label: z.string().optional().describe("Option label text"),
        index: z.number().int().optional().describe("Option index"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        let selected: string[];
        if (params.value !== undefined) {
          selected = await session.page.locator(params.selector).selectOption({ value: params.value });
        } else if (params.label !== undefined) {
          selected = await session.page.locator(params.selector).selectOption({ label: params.label });
        } else if (params.index !== undefined) {
          selected = await session.page.locator(params.selector).selectOption({ index: params.index });
        } else {
          return makeError(params.session_id, "INVALID_ARGS", "Provide value, label, or index");
        }
        browserManager.addFlowStep(session, "select", `Select option in "${params.selector}": ${selected.join(", ")}`);
        return makeSuccess(params.session_id, { selected }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Select failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_upload_file ──────────────────────────────────────
  server.registerTool(
    "interact_upload_file",
    {
      title: "Upload File to Input",
      description: `Set file(s) for a file input element. The files are created from provided content.

Args:
  - session_id (string): Browser session ID
  - selector (string): CSS selector of <input type="file">
  - files (array): Files to upload, each with name and content (base64 or text)

Returns:
  { uploaded: true, fileCount: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        selector: z.string().describe("CSS selector of file input"),
        files: z.array(z.object({
          name: z.string().describe("File name"),
          content: z.string().describe("File content (base64 for binary, text for text files)"),
          mime_type: z.string().default("application/octet-stream").describe("MIME type"),
        })).min(1).describe("Files to upload"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const filePayloads = params.files.map((f) => ({
          name: f.name,
          mimeType: f.mime_type,
          buffer: Buffer.from(f.content, "base64"),
        }));
        await session.page.locator(params.selector).setInputFiles(filePayloads);
        browserManager.addFlowStep(session, "upload",
          `Upload ${params.files.length} file(s): ${params.files.map((f) => f.name).join(", ")}`);
        return makeSuccess(params.session_id, { uploaded: true, fileCount: params.files.length }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_screenshot_and_annotate ──────────────────────────
  server.registerTool(
    "interact_screenshot_annotate",
    {
      title: "Screenshot with Grid Overlay",
      description: `Take a screenshot with an optional coordinate grid overlay to help identify click targets.
The grid divides the viewport into cells and labels them, making it easy to specify coordinates for interact_click_at.

Args:
  - session_id (string): Browser session ID
  - grid_size (number, optional): Grid cell size in pixels (default: 100). Smaller = more precise but noisier.
  - full_page (boolean, optional): Full page screenshot (default: false)
  - highlight_selector (string, optional): CSS selector to highlight with a red border before capture

Returns:
  Image content with grid overlay metadata`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        grid_size: z.number().int().min(20).max(500).default(100).describe("Grid cell size in px"),
        full_page: z.boolean().default(false).describe("Full page screenshot"),
        highlight_selector: z.string().optional().describe("Element to highlight"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);

        // Optionally highlight an element
        if (params.highlight_selector) {
          await session.page.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              (el as HTMLElement).style.outline = "3px solid red";
              (el as HTMLElement).style.outlineOffset = "2px";
            }
          }, params.highlight_selector);
        }

        // Inject grid overlay
        await session.page.evaluate((gridSize: number) => {
          const existing = document.getElementById("__mcp_grid_overlay");
          if (existing) existing.remove();

          const overlay = document.createElement("div");
          overlay.id = "__mcp_grid_overlay";
          overlay.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:999999;`;

          const vw = window.innerWidth;
          const vh = window.innerHeight;

          let svg = `<svg width="${vw}" height="${vh}" xmlns="http://www.w3.org/2000/svg">`;
          // Grid lines
          for (let x = 0; x <= vw; x += gridSize) {
            svg += `<line x1="${x}" y1="0" x2="${x}" y2="${vh}" stroke="rgba(255,0,0,0.3)" stroke-width="1"/>`;
          }
          for (let y = 0; y <= vh; y += gridSize) {
            svg += `<line x1="0" y1="${y}" x2="${vw}" y2="${y}" stroke="rgba(255,0,0,0.3)" stroke-width="1"/>`;
          }
          // Labels
          for (let x = 0; x < vw; x += gridSize) {
            for (let y = 0; y < vh; y += gridSize) {
              svg += `<text x="${x + 4}" y="${y + 14}" font-size="11" fill="rgba(255,0,0,0.7)" font-family="monospace">${x},${y}</text>`;
            }
          }
          svg += `</svg>`;
          overlay.innerHTML = svg;
          document.body.appendChild(overlay);
        }, params.grid_size);

        // Take screenshot
        const buffer = await session.page.screenshot({
          fullPage: params.full_page,
          type: "png",
        });

        // Remove overlay
        await session.page.evaluate(() => {
          document.getElementById("__mcp_grid_overlay")?.remove();
        });

        // Remove highlight
        if (params.highlight_selector) {
          await session.page.evaluate((sel: string) => {
            const el = document.querySelector(sel);
            if (el) {
              (el as HTMLElement).style.outline = "";
              (el as HTMLElement).style.outlineOffset = "";
            }
          }, params.highlight_selector);
        }

        const base64 = buffer.toString("base64");
        const viewport = session.page.viewportSize();

        return {
          content: [
            { type: "image" as const, data: base64, mimeType: "image/png" },
            {
              type: "text" as const,
              text: JSON.stringify({
                success: true,
                data: {
                  viewport: viewport ?? { width: 0, height: 0 },
                  gridSize: params.grid_size,
                  hint: "Use interact_click_at with x,y coordinates from the grid to click on elements. Grid labels show (x,y) at each cell's top-left corner.",
                },
                metadata: { timestamp: Date.now(), duration: Date.now() - start, sessionId: params.session_id },
              }, null, 2),
            },
          ],
        };
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_wait_for_navigation ──────────────────────────────
  server.registerTool(
    "interact_wait_for_navigation",
    {
      title: "Wait for Navigation",
      description: `Wait for a navigation event to complete (e.g. after clicking a link or submitting a form).

Args:
  - session_id (string): Browser session ID
  - url_pattern (string, optional): URL pattern to wait for (glob or regex)
  - timeout (number, optional): Timeout in ms (default: 30000)

Returns:
  { url: string, title: string }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url_pattern: z.string().optional().describe("URL pattern (glob)"),
        timeout: z.number().int().min(1000).max(120000).default(30000).describe("Timeout ms"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        if (params.url_pattern) {
          await session.page.waitForURL(params.url_pattern, { timeout: params.timeout });
        } else {
          await session.page.waitForLoadState("load", { timeout: params.timeout });
        }
        return makeSuccess(params.session_id, {
          url: session.page.url(),
          title: await session.page.title(),
        }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Wait failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_dialog_handle ────────────────────────────────────
  server.registerTool(
    "interact_dialog_handle",
    {
      title: "Handle Browser Dialog",
      description: `Set up auto-handling for the next browser dialog (alert, confirm, prompt, beforeunload).
Must be called BEFORE the action that triggers the dialog.

Args:
  - session_id (string): Browser session ID
  - action (string): "accept" or "dismiss"
  - prompt_text (string, optional): Text to enter for prompt dialogs

Returns:
  { handler_set: true }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        action: z.enum(["accept", "dismiss"]).describe("Accept or dismiss"),
        prompt_text: z.string().optional().describe("Text for prompt dialogs"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        session.page.once("dialog", async (dialog) => {
          if (params.action === "accept") {
            await dialog.accept(params.prompt_text);
          } else {
            await dialog.dismiss();
          }
        });
        return makeSuccess(params.session_id, { handler_set: true, action: params.action }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Dialog setup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_tab_management ───────────────────────────────────
  server.registerTool(
    "interact_new_tab",
    {
      title: "Open New Tab",
      description: `Open a new tab and optionally navigate to a URL. The new tab becomes the active page for the session.

Args:
  - session_id (string): Browser session ID
  - url (string, optional): URL to navigate to in the new tab

Returns:
  { url: string, tabCount: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        url: z.string().optional().describe("URL for new tab"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const newPage = await session.context.newPage();
        if (params.url) {
          await newPage.goto(params.url);
        }
        // Switch session's active page to the new tab
        session.page = newPage;
        // Re-attach CDP session
        session.cdpSession = await session.page.context().newCDPSession(session.page);

        const pages = session.context.pages();
        return makeSuccess(params.session_id, {
          url: newPage.url(),
          tabCount: pages.length,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `New tab failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ─── interact_switch_tab ───────────────────────────────────────
  server.registerTool(
    "interact_switch_tab",
    {
      title: "Switch Tab",
      description: `Switch to a different tab by index. Tab 0 is the first tab opened.

Args:
  - session_id (string): Browser session ID
  - tab_index (number): Tab index (0-based)

Returns:
  { url: string, title: string, tabIndex: number, totalTabs: number }`,
      inputSchema: {
        session_id: z.string().describe("Browser session ID"),
        tab_index: z.number().int().min(0).describe("Tab index"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (params) => {
      const start = Date.now();
      try {
        const session = browserManager.getOrThrow(params.session_id);
        const pages = session.context.pages();
        if (params.tab_index >= pages.length) {
          return makeError(params.session_id, "INVALID_ARGS",
            `Tab index ${params.tab_index} out of range. ${pages.length} tabs open.`);
        }
        session.page = pages[params.tab_index];
        session.cdpSession = await session.page.context().newCDPSession(session.page);
        return makeSuccess(params.session_id, {
          url: session.page.url(),
          title: await session.page.title(),
          tabIndex: params.tab_index,
          totalTabs: pages.length,
        }, start);
      } catch (err) {
        return makeError(params.session_id, "INTERACT_ERROR", `Switch failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );
}
