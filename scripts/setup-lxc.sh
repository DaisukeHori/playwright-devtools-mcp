#!/bin/bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════
# playwright-devtools-mcp — LXC Setup Script
# 
# Run inside a fresh Ubuntu 24.04 LXC container on Proxmox.
# This script installs Node.js, Chromium, the MCP server, deploy agent,
# and configures systemd services.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/DaisukeHori/playwright-devtools-mcp/main/scripts/setup-lxc.sh | bash
#
# Or clone first:
#   git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git /opt/playwright-devtools-mcp
#   cd /opt/playwright-devtools-mcp
#   bash scripts/setup-lxc.sh
# ═══════════════════════════════════════════════════════════════════

APP_DIR="/opt/playwright-devtools-mcp"
MCP_PORT=3100
DEPLOY_PORT=3101

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  playwright-devtools-mcp — LXC Setup                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ─── 1. Node.js 22 LTS ──────────────────────────────────────────
echo "▶ Step 1: Installing Node.js 22..."
if ! command -v node &>/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "  Node.js $(node -v) installed"

# ─── 2. System dependencies ─────────────────────────────────────
echo "▶ Step 2: Installing system dependencies..."
apt-get install -y git curl

# ─── 3. Clone or update repository ──────────────────────────────
echo "▶ Step 3: Setting up application..."
if [ -d "$APP_DIR/.git" ]; then
  echo "  Repository exists, pulling latest..."
  cd "$APP_DIR"
  git fetch origin main
  git reset --hard origin/main
else
  echo "  Cloning repository..."
  git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git "$APP_DIR"
  cd "$APP_DIR"
fi

# ─── 4. Install & build ─────────────────────────────────────────
echo "▶ Step 4: Installing dependencies & building..."
npm ci
npx playwright install chromium --with-deps
npm run build
echo "  Build complete"

# ─── 5. Generate secrets ────────────────────────────────────────
echo "▶ Step 5: Generating configuration..."
MCP_TOKEN=$(openssl rand -hex 32)
DEPLOY_SECRET=$(openssl rand -hex 32)

cat > "$APP_DIR/.env" << ENVEOF
# MCP Server
MCP_AUTH_TOKEN=$MCP_TOKEN
PORT=$MCP_PORT
HOST=0.0.0.0

# Deploy Agent
DEPLOY_SECRET=$DEPLOY_SECRET
DEPLOY_PORT=$DEPLOY_PORT
APP_DIR=$APP_DIR
SERVICE_NAME=playwright-mcp
ENVEOF

chmod 600 "$APP_DIR/.env"
echo "  Configuration written to $APP_DIR/.env"

# ─── 6. systemd: MCP Server ─────────────────────────────────────
echo "▶ Step 6: Creating systemd services..."

cat > /etc/systemd/system/playwright-mcp.service << SVCEOF
[Unit]
Description=Playwright DevTools MCP Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
SVCEOF

# ─── 7. systemd: Deploy Agent ───────────────────────────────────
cat > /etc/systemd/system/deploy-agent.service << SVCEOF
[Unit]
Description=Deploy Agent (GitHub Webhook Receiver)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node scripts/deploy-agent.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

# ─── 8. Start services ──────────────────────────────────────────
echo "▶ Step 7: Starting services..."
systemctl daemon-reload
systemctl enable --now playwright-mcp
systemctl enable --now deploy-agent
sleep 2

# ─── 9. Verify ──────────────────────────────────────────────────
echo "▶ Step 8: Verifying..."
echo ""

MCP_STATUS=$(curl -sf http://localhost:$MCP_PORT/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','FAIL'))" 2>/dev/null || echo "FAIL")
DEPLOY_STATUS=$(curl -sf http://localhost:$DEPLOY_PORT/health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','FAIL'))" 2>/dev/null || echo "FAIL")

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Setup Complete!                                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  MCP Server:     http://0.0.0.0:$MCP_PORT/mcp  [$MCP_STATUS]     ║"
echo "║  Deploy Agent:   http://0.0.0.0:$DEPLOY_PORT/webhook  [$DEPLOY_STATUS]     ║"
echo "║                                                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  IMPORTANT — Save these tokens:                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "  MCP_AUTH_TOKEN:    $MCP_TOKEN"
echo "  DEPLOY_SECRET:     $DEPLOY_SECRET"
echo "║                                                        ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║  Next Steps:                                           ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                        ║"
echo "║  1. Cloudflare Tunnel config に追加:                     ║"
echo "║     - hostname: playwright-mcp.appserver.tokyo          ║"
echo "║       service: http://$(hostname -I | awk '{print $1}'):$MCP_PORT           ║"
echo "║     - hostname: deploy-playwright-mcp.appserver.tokyo   ║"
echo "║       service: http://$(hostname -I | awk '{print $1}'):$DEPLOY_PORT           ║"
echo "║                                                        ║"
echo "║  2. GitHub Secrets に設定:                              ║"
echo "║     DEPLOY_WEBHOOK_URL:                                 ║"
echo "║       https://deploy-playwright-mcp.appserver.tokyo/webhook"
echo "║     DEPLOY_WEBHOOK_SECRET:                              ║"
echo "║       $DEPLOY_SECRET"
echo "║                                                        ║"
echo "║  3. Claude.AI Connector に登録:                         ║"
echo "║     URL: https://playwright-mcp.appserver.tokyo/mcp     ║"
echo "║     Token: $MCP_TOKEN"
echo "║                                                        ║"
echo "╚══════════════════════════════════════════════════════════╝"
