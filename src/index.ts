import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import crypto from "crypto";
import { spawn } from "child_process";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SERVER_NAME, SERVER_VERSION } from "./constants.js";
import { browserManager } from "./services/browser-manager.js";

import { registerBrowserTools } from "./tools/browser.js";
import { registerConsoleTools } from "./tools/console.js";
import { registerNetworkTools } from "./tools/network.js";
import { registerPerformanceTools } from "./tools/performance.js";
import { registerStorageTools } from "./tools/storage.js";
import { registerDebugTools } from "./tools/debug.js";
import { registerSecurityTools } from "./tools/security.js";
import { registerFlowTools } from "./tools/flow.js";
import { registerInteractiveTools } from "./tools/interactive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Server Factory ─────────────────────────────────────────────
function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
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
  if (!authHeader) { res.status(401).json({ error: "Missing Authorization header" }); return false; }
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== AUTH_TOKEN) { res.status(403).json({ error: "Invalid token" }); return false; }
  return true;
}

// ─── GitHub Webhook HMAC-SHA256 ─────────────────────────────────
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const DEPLOY_BRANCH = process.env.DEPLOY_BRANCH || "main";

interface DeployStatus {
  lastDeploy: string | null;
  lastCommit: string | null;
  lastStatus: "idle" | "deploying" | "success" | "failed";
  lastError: string | null;
  deployCount: number;
}

const deployStatus: DeployStatus = {
  lastDeploy: null, lastCommit: null,
  lastStatus: "idle", lastError: null, deployCount: 0,
};

function verifyGitHubSignature(payload: string, signature: string | undefined): boolean {
  if (!WEBHOOK_SECRET || !signature) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload, "utf8").digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}

function triggerDeploy(branch: string, commitSha: string): void {
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "deploy.sh");
  if (!existsSync(scriptPath)) {
    deployStatus.lastStatus = "failed";
    deployStatus.lastError = "Deploy script not found: " + scriptPath;
    return;
  }

  deployStatus.lastStatus = "deploying";
  deployStatus.lastCommit = commitSha;
  deployStatus.lastDeploy = new Date().toISOString();
  deployStatus.deployCount++;

  console.error(`[DEPLOY] Starting deploy for ${branch}@${commitSha.slice(0, 7)}...`);

  const child = spawn("bash", [scriptPath, branch], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, APP_DIR: PROJECT_ROOT, DEPLOY_COMMIT: commitSha },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout?.on("data", (d: Buffer) => { output += d.toString(); process.stderr.write("[DEPLOY] " + d.toString()); });
  child.stderr?.on("data", (d: Buffer) => { output += d.toString(); process.stderr.write("[DEPLOY:ERR] " + d.toString()); });

  child.on("exit", (code) => {
    if (code === 0) { deployStatus.lastStatus = "success"; deployStatus.lastError = null; }
    else { deployStatus.lastStatus = "failed"; deployStatus.lastError = `Exit code ${code}`; }
  });
  child.on("error", (err) => { deployStatus.lastStatus = "failed"; deployStatus.lastError = err.message; });
  child.unref();
}

// ─── HTTP Transport ─────────────────────────────────────────────
async function runHTTP(): Promise<void> {
  const app = express();

  // Raw body for webhook signature verification (BEFORE json parser)
  app.use("/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "10mb" }));

  // ─── Health ───────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok", server: SERVER_NAME, version: SERVER_VERSION,
      activeSessions: browserManager.listSessions().length,
      uptime: process.uptime(), deploy: deployStatus,
    });
  });

  // ─── MCP Endpoint ─────────────────────────────────────────────
  app.post("/mcp", async (req, res) => {
    if (!authenticateRequest(req, res)) return;
    try {
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  });

  app.get("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed. Use POST." }); });
  app.delete("/mcp", (_req, res) => { res.status(405).json({ error: "Method not allowed." }); });
  app.get("/sse", (_req, res) => { res.status(410).json({ error: "SSE deprecated. Use POST /mcp." }); });

  // ─── GitHub Webhook Deploy ────────────────────────────────────
  app.post("/webhook/deploy", (req, res) => {
    if (!WEBHOOK_SECRET) { res.status(503).json({ error: "WEBHOOK_SECRET not configured" }); return; }

    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);

    if (!verifyGitHubSignature(rawBody, signature)) {
      console.error("[WEBHOOK] Invalid signature rejected");
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    const event = req.headers["x-github-event"] as string;

    if (event !== "push") { res.json({ status: "ignored", reason: `Event '${event}' is not 'push'` }); return; }

    const ref = (payload as { ref?: string }).ref ?? "";
    const branch = ref.replace("refs/heads/", "");
    if (branch !== DEPLOY_BRANCH) {
      res.json({ status: "ignored", reason: `Branch '${branch}' is not '${DEPLOY_BRANCH}'` });
      return;
    }

    const headCommit = (payload as { head_commit?: { id?: string; message?: string } }).head_commit;
    const commitSha = headCommit?.id ?? "unknown";
    const commitMsg = headCommit?.message ?? "";

    if (deployStatus.lastStatus === "deploying") {
      res.status(429).json({ status: "busy", message: "Deploy already in progress" });
      return;
    }

    triggerDeploy(branch, commitSha);
    res.json({ status: "deploying", branch, commit: commitSha.slice(0, 7), message: commitMsg.slice(0, 100) });
  });

  // ─── Deploy Status & Log ──────────────────────────────────────
  app.get("/webhook/status", (_req, res) => { res.json(deployStatus); });

  app.get("/webhook/log", (_req, res) => {
    const logPath = path.join(PROJECT_ROOT, "deploy.log");
    if (existsSync(logPath)) {
      const log = readFileSync(logPath, "utf8");
      res.type("text/plain").send(log.split("\n").slice(-200).join("\n"));
    } else {
      res.status(404).send("No deploy log found");
    }
  });

  const host = process.env.HOST || "0.0.0.0";
  const port = parseInt(process.env.PORT || "3100");
  const webhookOn = !!WEBHOOK_SECRET;

  app.listen(port, host, () => {
    console.error("=".repeat(60));
    console.error(`  ${SERVER_NAME} v${SERVER_VERSION}`);
    console.error("=".repeat(60));
    console.error(`  MCP:       http://${host}:${port}/mcp`);
    console.error(`  Health:    http://${host}:${port}/health`);
    console.error(`  Auth:      ${AUTH_TOKEN ? "ENABLED" : "DISABLED"}`);
    console.error(`  Webhook:   ${webhookOn ? "ENABLED → /webhook/deploy (branch: " + DEPLOY_BRANCH + ")" : "DISABLED (set WEBHOOK_SECRET)"}`);
    console.error("  Tools(57): Browser(9) Console(3) Network(4) Perf(4) Storage(5)");
    console.error("             Debug(5) Security(3) Flow(5) Generate(4) Capture(2) Interactive(13)");
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
