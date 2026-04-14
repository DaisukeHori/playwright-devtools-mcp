#!/bin/bash
# playwright-devtools-mcp deploy script
# Called by webhook handler. Runs detached so server restart doesn't kill it.
#
# Usage: ./scripts/deploy.sh [branch]
# Environment: APP_DIR (default: /opt/playwright-devtools-mcp)

set -euo pipefail

BRANCH="${1:-main}"
APP_DIR="${APP_DIR:-/opt/playwright-devtools-mcp}"
LOG_FILE="${APP_DIR}/deploy.log"
LOCK_FILE="/tmp/playwright-mcp-deploy.lock"
SERVICE_NAME="playwright-mcp"

# ─── Prevent concurrent deploys ─────────────────────────────────
if [ -f "$LOCK_FILE" ]; then
  LOCK_PID=$(cat "$LOCK_FILE" 2>/dev/null || echo "")
  if [ -n "$LOCK_PID" ] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "$(date -Iseconds) Deploy already running (PID $LOCK_PID), skipping" | tee -a "$LOG_FILE"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

# ─── Logging ─────────────────────────────────────────────────────
exec > >(tee -a "$LOG_FILE") 2>&1
echo ""
echo "================================================================"
echo "  DEPLOY START: $(date -Iseconds)"
echo "  Branch: $BRANCH"
echo "  Directory: $APP_DIR"
echo "================================================================"

cd "$APP_DIR"

# ─── Step 1: Git Pull ───────────────────────────────────────────
echo ""
echo "[1/5] Git pull..."
BEFORE=$(git rev-parse HEAD)
git fetch origin "$BRANCH" --force
git reset --hard "origin/$BRANCH"
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "  No changes detected (HEAD=$BEFORE). Skipping build."
  echo "  Deploy completed (no-op) at $(date -Iseconds)"
  exit 0
fi

echo "  $BEFORE → $AFTER"
git log --oneline "$BEFORE..$AFTER" | head -10

# ─── Step 2: npm install ─────────────────────────────────────────
echo ""
echo "[2/5] npm install..."
npm ci --omit=dev 2>&1 | tail -3

# ─── Step 3: Build ───────────────────────────────────────────────
echo ""
echo "[3/5] TypeScript build..."
npm run build 2>&1 | tail -3

# ─── Step 4: Restart service ─────────────────────────────────────
echo ""
echo "[4/5] Restart service..."
if systemctl is-active --quiet "$SERVICE_NAME"; then
  systemctl restart "$SERVICE_NAME"
  echo "  systemctl restart $SERVICE_NAME → OK"
else
  echo "  Service $SERVICE_NAME not found, attempting direct restart..."
  # Fallback: kill old process and start new one
  pkill -f "node dist/index.js" || true
  sleep 1
  cd "$APP_DIR"
  nohup node dist/index.js >> /var/log/playwright-mcp.log 2>&1 &
  echo "  Started as background process PID=$!"
fi

# ─── Step 5: Health check ────────────────────────────────────────
echo ""
echo "[5/5] Health check..."
sleep 3
HEALTH=$(curl -sf http://localhost:${PORT:-3100}/health 2>&1 || echo "FAIL")
if echo "$HEALTH" | grep -q '"status":"ok"'; then
  echo "  Health check: PASSED"
  echo "  $HEALTH"
else
  echo "  Health check: FAILED"
  echo "  Response: $HEALTH"
  echo "  WARNING: Service may not have started correctly!"
fi

echo ""
echo "================================================================"
echo "  DEPLOY COMPLETE: $(date -Iseconds)"
echo "  Commit: $AFTER"
echo "================================================================"
