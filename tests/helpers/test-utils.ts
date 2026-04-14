import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { type Server } from "http";
import { browserManager } from "../../src/services/browser-manager.js";
import { registerBrowserTools } from "../../src/tools/browser.js";
import { registerConsoleTools } from "../../src/tools/console.js";
import { registerNetworkTools } from "../../src/tools/network.js";
import { registerPerformanceTools } from "../../src/tools/performance.js";
import { registerStorageTools } from "../../src/tools/storage.js";
import { registerDebugTools } from "../../src/tools/debug.js";
import { registerSecurityTools } from "../../src/tools/security.js";
import { registerFlowTools } from "../../src/tools/flow.js";
import { registerInteractiveTools } from "../../src/tools/interactive.js";

// ─── Create an MCP server with all tools ────────────────────────
export function createTestServer(): McpServer {
  const server = new McpServer({ name: "test-server", version: "0.0.0" });
  registerBrowserTools(server);
  registerConsoleTools(server);
  registerNetworkTools(server);
  registerPerformanceTools(server);
  registerStorageTools(server);
  registerDebugTools(server);
  registerSecurityTools(server);
  registerFlowTools(server);
  registerInteractiveTools(server);
  return server;
}

// ─── Start HTTP test server ─────────────────────────────────────
export async function startTestHttpServer(port = 0): Promise<{ server: Server; port: number; url: string }> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.post("/mcp", async (req, res) => {
    const mcpServer = createTestServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => { transport.close(); mcpServer.close(); });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed" }); });
  app.delete("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed" }); });
  app.get("/sse", (_req, res) => { res.status(410).json({ error: "SSE deprecated" }); });

  return new Promise((resolve) => {
    const httpServer = app.listen(port, "127.0.0.1", () => {
      const addr = httpServer.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({ server: httpServer, port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}

// ─── Call MCP tool via HTTP ─────────────────────────────────────
export async function callTool(
  baseUrl: string,
  toolName: string,
  args: Record<string, unknown> = {},
  id = 1,
): Promise<{ success: boolean; data: Record<string, unknown>; error?: { code: string; message: string } }> {
  const resp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name: toolName, arguments: args },
    }),
  });

  const rpc = await resp.json() as Record<string, unknown>;
  const result = rpc.result as { content: Array<{ type: string; text?: string; data?: string }> } | undefined;
  if (!result?.content?.[0]) {
    throw new Error(`No content in response: ${JSON.stringify(rpc)}`);
  }

  const textBlock = result.content.find((c) => c.type === "text");
  const hasImage = result.content.some((c) => c.type === "image");

  if (!textBlock?.text) {
    // Image-only or non-text response
    return { success: true, data: { hasImage } };
  }

  const parsed = JSON.parse(textBlock.text) as {
    success: boolean;
    data: Record<string, unknown>;
    error?: { code: string; message: string };
  };

  // Inject hasImage flag into data
  if (hasImage && parsed.data) {
    parsed.data.hasImage = true;
  }

  return parsed;
}

// ─── Initialize MCP session via HTTP ────────────────────────────
export async function mcpInitialize(baseUrl: string): Promise<void> {
  await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    }),
  });
}

// ─── List tools via HTTP ────────────────────────────────────────
export async function listTools(baseUrl: string): Promise<Array<{ name: string; description: string }>> {
  const resp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      method: "tools/list",
      params: {},
    }),
  });
  const rpc = await resp.json() as { result: { tools: Array<{ name: string; description: string }> } };
  return rpc.result.tools;
}

// ─── Cleanup helper ─────────────────────────────────────────────
export async function cleanupAllSessions(): Promise<void> {
  await browserManager.closeAllSessions();
}

// ─── Static HTML server for testing ─────────────────────────────
export async function startStaticServer(): Promise<{ server: Server; port: number; url: string }> {
  const app = express();

  // Basic HTML page
  app.get("/", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html><head><title>Test Page</title>
<style>
  body { font-family: sans-serif; margin: 20px; }
  #counter { font-size: 24px; color: blue; }
  .hidden { display: none; }
  #clickTarget { width: 100px; height: 50px; background: green; cursor: pointer; margin: 10px 0; }
  #dragSource { width: 80px; height: 80px; background: red; position: absolute; left: 50px; top: 200px; cursor: grab; }
  #dropTarget { width: 200px; height: 200px; background: #eee; border: 2px dashed #999; position: absolute; left: 300px; top: 200px; }
  input, select, textarea { display: block; margin: 5px 0; padding: 5px; }
</style>
</head><body>
  <h1 id="title">Test Page</h1>
  <p id="counter">Count: 0</p>
  <div id="clickTarget" onclick="document.getElementById('counter').textContent='Count: '+(++window.clickCount)">Click Me</div>
  <div id="dragSource" draggable="true">Drag</div>
  <div id="dropTarget">Drop Here</div>
  <form id="testForm">
    <input type="text" id="username" name="username" placeholder="Username">
    <input type="password" id="password" name="password" placeholder="Password">
    <input type="email" id="email" name="email" placeholder="Email">
    <select id="role" name="role">
      <option value="">Select Role</option>
      <option value="admin">Admin</option>
      <option value="user">User</option>
      <option value="guest">Guest</option>
    </select>
    <textarea id="notes" name="notes" placeholder="Notes"></textarea>
    <input type="file" id="fileInput" name="file">
    <button type="submit" id="submitBtn">Submit</button>
  </form>
  <div id="result" class="hidden"></div>
  <div id="scrollContent" style="height: 3000px; background: linear-gradient(white, lightblue);">
    <p style="position: absolute; top: 1500px;">Middle of page</p>
    <p style="position: absolute; top: 2900px;" id="bottom">Bottom of page</p>
  </div>
  <script>
    window.clickCount = 0;
    localStorage.setItem("testKey", "testValue");
    localStorage.setItem("user_prefs", JSON.stringify({theme: "dark", lang: "ja"}));
    sessionStorage.setItem("sessionToken", "abc123");
    document.getElementById("testForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      document.getElementById("result").textContent = JSON.stringify(Object.fromEntries(fd));
      document.getElementById("result").classList.remove("hidden");
    });
    console.log("Page loaded");
    console.warn("Test warning");
  </script>
</body></html>`);
  });

  // API endpoint (JSON)
  app.get("/api/data", (_req, res) => {
    res.json({ items: [{ id: 1, name: "Alpha" }, { id: 2, name: "Beta" }], total: 2 });
  });

  app.post("/api/login", express.json(), (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (username === "admin" && password === "secret") {
      res.json({ token: "jwt-token-123", user: { id: 1, name: "Admin" } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/error", (_req, res) => {
    res.status(500).json({ error: "Internal Server Error" });
  });

  app.get("/redirect", (_req, res) => {
    res.redirect("/api/data");
  });

  // Page with mixed content / security headers
  app.get("/secure", (_req, res) => {
    res.set({
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
      "Content-Security-Policy": "default-src 'self'",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.type("html").send("<html><body><h1>Secure Page</h1></body></html>");
  });

  // Page for performance testing
  app.get("/perf", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html><head><title>Perf Test</title>
<link rel="stylesheet" href="/style.css">
<script src="/script.js"></script>
</head><body>
<img src="/img/test.png" width="100" height="100">
<h1>Performance Test Page</h1>
</body></html>`);
  });

  app.get("/style.css", (_req, res) => {
    res.type("css").send("body { color: black; }");
  });

  app.get("/script.js", (_req, res) => {
    res.type("js").send("console.log('script loaded');");
  });

  app.get("/img/test.png", (_req, res) => {
    // 1x1 transparent PNG
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    res.type("png").send(png);
  });

  // Error-producing page
  app.get("/errors", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html><body>
<script>
  console.error("Intentional error");
  console.warn("Intentional warning");
  console.info("Info message");
  console.debug("Debug message");
  fetch("/api/error").catch(() => {});
  fetch("/nonexistent").catch(() => {});
  throw new Error("Uncaught error on page");
</script>
</body></html>`);
  });

  // Multi-API page (simulates real app)
  app.get("/app", (_req, res) => {
    res.type("html").send(`<!DOCTYPE html>
<html><body>
<h1>App Page</h1>
<script>
  fetch("/api/data").then(r => r.json()).then(d => {
    document.body.innerHTML += "<p>Loaded: " + d.total + " items</p>";
  });
  fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "secret" })
  }).then(r => r.json()).then(d => {
    document.body.innerHTML += "<p>Token: " + d.token + "</p>";
  });
</script>
</body></html>`);
  });

  return new Promise((resolve) => {
    const httpServer = app.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: httpServer, port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}
