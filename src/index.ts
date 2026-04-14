import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { browserManager } from "./services/browser-manager.js";

// Tool registration imports
import { registerBrowserTools } from "./tools/browser.js";
import { registerConsoleTools } from "./tools/console.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerPerformanceTools } from "./tools/performance.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerDebugTools } from "./tools/debug.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerInteractiveTools } from "./tools/interactive.js";

// ─── Server Factory ─────────────────────────────────────────────
function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

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

// ─── Bearer Token Authentication ────────────────────────────────
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function authenticateRequest(req: express.Request, res: express.Response): boolean {
  if (!AUTH_TOKEN) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: "Missing Authorization header" });
    return false;
  }
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== AUTH_TOKEN) {
    res.status(403).json({ error: "Invalid token" });
    return false;
  }
  return true;
}

// ─── HTTP Transport ─────────────────────────────────────────────
async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      server: SERVER_NAME,
      version: SERVER_VERSION,
      activeSessions: browserManager.listSessions().length,
      uptime: process.uptime(),
    });
  });

  app.post("/mcp", async (req, res) => {
    if (!authenticateRequest(req, res)) return;
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Use POST." });
  });

  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed." });
  });

  app.get("/sse", (_req, res) => {
    res.status(410).json({ error: "SSE deprecated. Use POST /mcp." });
  });

  const host = process.env.HOST || "0.0.0.0";
  const port = parseInt(process.env.PORT || "3100");

  app.listen(port, host, () => {
    console.error("=".repeat(60));
    console.error(`  ${SERVER_NAME} v${SERVER_VERSION}`);
    console.error("=".repeat(60));
    console.error(`  Transport: Streamable HTTP (stateless)`);
    console.error(`  Endpoint:  http://${host}:${port}/mcp`);
    console.error(`  Health:    http://${host}:${port}/health`);
    console.error(`  Auth:      ${AUTH_TOKEN ? "Bearer token ENABLED" : "DISABLED (set MCP_AUTH_TOKEN)"}`);
    console.error("=".repeat(60));
    console.error("");
    console.error("  Tool groups:");
    console.error("    Browser  - launch, navigate, click, type, screenshot, evaluate, wait");
    console.error("    Console  - get_logs, clear_logs, get_exceptions");
    console.error("    Network  - get_requests, get_failed, get_summary, clear");
    console.error("    Perf     - metrics, navigation_timing, core_web_vitals, resource_timing");
    console.error("    Storage  - localStorage, sessionStorage, cookies, indexedDB, clear");
    console.error("    Debug    - dom_tree, element_properties, page_source, accessibility, querySelectorAll");
    console.error("    Security - analyze_headers, get_certificate, check_mixed_content");
    console.error("    Flow     - start/stop recording, get_steps, get_api_calls");
    console.error("    Generate - curl, python_requests, api_spec, HAR");
    console.error("    Interact - click_at, drag, hover, scroll, keyboard, fill, select, upload, tabs");
    console.error("=".repeat(60));
  });
}

// ─── stdio Transport ────────────────────────────────────────────
async function runStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
}

// ─── Graceful shutdown ──────────────────────────────────────────
async function shutdown(): Promise<void> {
  console.error("\nShutting down...");
  await browserManager.closeAllSessions();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── Entry point ────────────────────────────────────────────────
const transport = process.env.TRANSPORT || "http";
if (transport === "stdio") {
  runStdio().catch((err) => { console.error("Fatal:", err); process.exit(1); });
} else {
  runHTTP().catch((err) => { console.error("Fatal:", err); process.exit(1); });
}
