#!/usr/bin/env node
/**
 * deploy-agent.mjs — Lightweight webhook receiver for CI/CD deployment.
 * 
 * Listens for POST /webhook with HMAC-SHA256 signature verification.
 * On valid request: git pull → npm ci → npm run build → systemctl restart
 * 
 * Usage:
 *   DEPLOY_SECRET=your-secret node scripts/deploy-agent.mjs
 * 
 * Environment variables:
 *   DEPLOY_SECRET  — HMAC shared secret (required)
 *   DEPLOY_PORT    — Listen port (default: 3101)
 *   APP_DIR        — Application directory (default: /opt/playwright-devtools-mcp)
 *   SERVICE_NAME   — systemd service name (default: playwright-mcp)
 */

import http from "node:http";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";

const DEPLOY_SECRET = process.env.DEPLOY_SECRET;
const PORT = parseInt(process.env.DEPLOY_PORT || "3101");
const APP_DIR = process.env.APP_DIR || "/opt/playwright-devtools-mcp";
const SERVICE_NAME = process.env.SERVICE_NAME || "playwright-mcp";
const LOG_FILE = process.env.DEPLOY_LOG || "/var/log/deploy-agent.log";

if (!DEPLOY_SECRET) {
  console.error("ERROR: DEPLOY_SECRET environment variable is required");
  process.exit(1);
}

// ─── Logging ────────────────────────────────────────────────────
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch { /* OK */ }
}

// ─── HMAC Verification ──────────────────────────────────────────
function verifySignature(body, signatureHeader) {
  if (!signatureHeader) return false;
  const [algo, signature] = signatureHeader.split("=");
  if (algo !== "sha256") return false;
  const expected = crypto.createHmac("sha256", DEPLOY_SECRET).update(body).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
}

// ─── Deploy Logic ───────────────────────────────────────────────
function deploy(payload) {
  const steps = [
    { name: "git fetch", cmd: "git fetch origin main" },
    { name: "git reset", cmd: "git reset --hard origin/main" },
    { name: "npm ci", cmd: "npm ci --omit=dev" },
    { name: "npm build", cmd: "npm run build" },
    { name: "restart service", cmd: `systemctl restart ${SERVICE_NAME}` },
    { name: "verify service", cmd: `systemctl is-active ${SERVICE_NAME}` },
  ];

  const results = [];
  const startTime = Date.now();

  for (const step of steps) {
    log(`  → ${step.name}`);
    try {
      const output = execSync(step.cmd, {
        cwd: APP_DIR,
        timeout: 120000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      results.push({ step: step.name, success: true, output: output.trim().slice(0, 500) });
      log(`    ✓ ${step.name} OK`);
    } catch (err) {
      const errMsg = err.stderr?.toString().slice(0, 500) || err.message;
      log(`    ✗ ${step.name} FAILED: ${errMsg}`);
      results.push({ step: step.name, success: false, error: errMsg });
      return { success: false, steps: results, duration: Date.now() - startTime, failedAt: step.name };
    }
  }

  return { success: true, steps: results, duration: Date.now() - startTime, sha: payload?.sha };
}

// ─── HTTP Server ────────────────────────────────────────────────
let deploying = false;

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", deploying, service: SERVICE_NAME, appDir: APP_DIR }));
    return;
  }

  // Deploy webhook
  if (req.method === "POST" && req.url === "/webhook") {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      // Verify signature
      const sig = req.headers["x-deploy-signature"];
      if (!verifySignature(body, sig)) {
        log("⚠ Invalid signature — rejected");
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid signature" }));
        return;
      }

      // Prevent concurrent deploys
      if (deploying) {
        log("⚠ Deploy already in progress — rejected");
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Deploy already in progress" }));
        return;
      }

      let payload;
      try { payload = JSON.parse(body); } catch { payload = {}; }

      log(`🚀 Deploy triggered (sha: ${payload.sha?.slice(0, 8) || "unknown"})`);
      deploying = true;

      try {
        const result = deploy(payload);
        deploying = false;

        if (result.success) {
          log(`✅ Deploy completed in ${result.duration}ms`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        } else {
          log(`❌ Deploy failed at step: ${result.failedAt}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      } catch (err) {
        deploying = false;
        log(`❌ Deploy crash: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => {
  log("=".repeat(50));
  log(`Deploy Agent started`);
  log(`  Port:    ${PORT}`);
  log(`  App:     ${APP_DIR}`);
  log(`  Service: ${SERVICE_NAME}`);
  log(`  Health:  http://0.0.0.0:${PORT}/health`);
  log(`  Webhook: http://0.0.0.0:${PORT}/webhook`);
  log("=".repeat(50));
});
