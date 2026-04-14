import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { type Server } from "http";
import express from "express";
import crypto from "crypto";

const WEBHOOK_SECRET = "test-webhook-secret-vitest";

// We need a custom test server that includes webhook routes
async function startWebhookTestServer(): Promise<{ server: Server; port: number; url: string }> {
  // Set env before importing
  process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.MCP_AUTH_TOKEN = "test-token";

  const app = express();
  app.use("/webhook", express.raw({ type: "application/json", limit: "1mb" }));
  app.use(express.json({ limit: "10mb" }));

  // Inline webhook handler (mirrors production logic)
  function verifySignature(payload: string, sig: string | undefined): boolean {
    if (!sig) return false;
    const expected = "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload, "utf8").digest("hex");
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
    catch { return false; }
  }

  app.post("/webhook/deploy", (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : JSON.stringify(req.body);

    if (!verifySignature(rawBody, signature)) {
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

    const payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : req.body;
    const event = req.headers["x-github-event"] as string;

    if (event !== "push") {
      res.json({ status: "ignored", reason: `Event '${event}' is not 'push'` });
      return;
    }

    const ref = (payload as { ref?: string }).ref ?? "";
    const branch = ref.replace("refs/heads/", "");
    if (branch !== "main") {
      res.json({ status: "ignored", reason: `Branch '${branch}' is not 'main'` });
      return;
    }

    const sha = (payload as { head_commit?: { id?: string } }).head_commit?.id ?? "unknown";
    res.json({ status: "deploying", branch, commit: sha.slice(0, 7) });
  });

  app.get("/webhook/status", (_req, res) => {
    res.json({ lastStatus: "idle", deployCount: 0 });
  });

  return new Promise((resolve) => {
    const httpServer = app.listen(0, "127.0.0.1", () => {
      const addr = httpServer.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: httpServer, port: p, url: `http://127.0.0.1:${p}` });
    });
  });
}

function sign(payload: string): string {
  return "sha256=" + crypto.createHmac("sha256", WEBHOOK_SECRET).update(payload, "utf8").digest("hex");
}

describe("Unit: Webhook CI/CD", () => {
  let srv: { server: Server; url: string };

  beforeAll(async () => { srv = await startWebhookTestServer(); });
  afterAll(() => { srv.server.close(); });

  // ─── Signature Verification ────────────────────────────────────
  it("should reject request without signature", async () => {
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: '{"ref":"refs/heads/main"}',
    });
    expect(resp.status).toBe(403);
  });

  it("should reject request with wrong signature", async () => {
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=invalid" },
      body: '{"ref":"refs/heads/main"}',
    });
    expect(resp.status).toBe(403);
  });

  it("should reject request with signature for different payload", async () => {
    const payload = '{"ref":"refs/heads/main"}';
    const wrongSig = sign('{"ref":"refs/heads/develop"}');
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": wrongSig, "X-GitHub-Event": "push" },
      body: payload,
    });
    expect(resp.status).toBe(403);
  });

  it("should accept request with valid HMAC-SHA256 signature", async () => {
    const payload = '{"ref":"refs/heads/main","head_commit":{"id":"abc123"}}';
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": "push" },
      body: payload,
    });
    expect(resp.status).toBe(200);
    const data = await resp.json() as { status: string };
    expect(data.status).toBe("deploying");
  });

  // ─── Event Type Filtering ─────────────────────────────────────
  const nonPushEvents = ["ping", "workflow_run", "pull_request", "issues", "create", "delete", "release", "check_run"];
  for (const event of nonPushEvents) {
    it(`should ignore '${event}' event`, async () => {
      const payload = '{"action":"completed"}';
      const resp = await fetch(`${srv.url}/webhook/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": event },
        body: payload,
      });
      const data = await resp.json() as { status: string; reason: string };
      expect(data.status).toBe("ignored");
      expect(data.reason).toContain("not 'push'");
    });
  }

  // ─── Branch Filtering ─────────────────────────────────────────
  const nonMainBranches = ["develop", "feature/test", "staging", "release/1.0"];
  for (const branch of nonMainBranches) {
    it(`should ignore push to '${branch}' branch`, async () => {
      const payload = JSON.stringify({ ref: `refs/heads/${branch}`, head_commit: { id: "abc" } });
      const resp = await fetch(`${srv.url}/webhook/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": "push" },
        body: payload,
      });
      const data = await resp.json() as { status: string; reason: string };
      expect(data.status).toBe("ignored");
      expect(data.reason).toContain(`'${branch}'`);
    });
  }

  // ─── Payload Parsing ──────────────────────────────────────────
  it("should extract commit sha from push payload", async () => {
    const payload = JSON.stringify({ ref: "refs/heads/main", head_commit: { id: "abcdef1234567890" } });
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": "push" },
      body: payload,
    });
    const data = await resp.json() as { commit: string };
    expect(data.commit).toBe("abcdef1");
  });

  it("should handle missing head_commit gracefully", async () => {
    const payload = JSON.stringify({ ref: "refs/heads/main" });
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": "push" },
      body: payload,
    });
    const data = await resp.json() as { commit: string };
    expect(data.commit).toBe("unknown");
  });

  it("should return branch name in response", async () => {
    const payload = JSON.stringify({ ref: "refs/heads/main", head_commit: { id: "abc" } });
    const resp = await fetch(`${srv.url}/webhook/deploy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(payload), "X-GitHub-Event": "push" },
      body: payload,
    });
    const data = await resp.json() as { branch: string };
    expect(data.branch).toBe("main");
  });

  // ─── Status Endpoint ──────────────────────────────────────────
  it("should return deploy status", async () => {
    const resp = await fetch(`${srv.url}/webhook/status`);
    expect(resp.status).toBe(200);
    const data = await resp.json() as { lastStatus: string; deployCount: number };
    expect(data.lastStatus).toBe("idle");
    expect(data.deployCount).toBe(0);
  });
});
