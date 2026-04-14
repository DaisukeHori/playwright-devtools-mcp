# playwright-devtools-mcp

[![Tests](https://img.shields.io/badge/tests-556%20passed-brightgreen)](https://github.com/DaisukeHori/playwright-devtools-mcp)
[![Tools](https://img.shields.io/badge/MCP%20tools-57-blue)](https://github.com/DaisukeHori/playwright-devtools-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Playwright + Chrome DevTools Protocol MCP Server**

ブラウザ操作のリバースエンジニアリング & 完全なDevToolsデバッグ機能を Claude.AI / Claude Desktop / Claude Code から利用可能にするMCPサーバー。

> 🔬 **核心機能**: 人がブラウザで行う操作フローをAIが追跡しながら、CDPで通信を完全キャプチャし、`curl` / `requests` で再現可能な**API仕様書を自動生成**する。

## 🌐 ランディングページ

**→ [https://daisukehori.github.io/playwright-devtools-mcp/](https://daisukehori.github.io/playwright-devtools-mcp/)**

---

## 機能一覧 (57ツール × 10カテゴリ)

| カテゴリ | ツール数 | 主要機能 |
|---------|---------|---------|
| **Browser** | 9 | `browser_launch` `browser_navigate` `browser_click` `browser_type` `browser_evaluate` `browser_screenshot` `browser_wait` `browser_close` `browser_list_sessions` |
| **Console** | 3 | `console_get_logs` `console_clear_logs` `console_get_exceptions` — フィルタ・検索対応 |
| **Network** | 4 | `network_get_requests` `network_get_failed_requests` `network_get_summary` `network_clear` — CDP完全キャプチャ |
| **Performance** | 4 | `performance_get_metrics` `performance_get_navigation_timing` `performance_get_core_web_vitals` `performance_get_resource_timing` |
| **Storage** | 5 | `storage_get_local_storage` `storage_get_session_storage` `storage_get_cookies` `storage_get_indexeddb_info` `storage_clear_data` |
| **Debug** | 5 | `debug_get_dom_tree` `debug_get_element_properties` `debug_get_page_source` `debug_get_accessibility_tree` `debug_query_selector_all` |
| **Security** | 3 | `security_analyze_headers` `security_get_certificate` `security_check_mixed_content` |
| **Flow** | 5 | `flow_start_recording` `flow_stop_recording` `flow_add_step` `flow_get_steps` `flow_get_captured_api_calls` |
| **Generate** | 4 | `generate_curl_commands` `generate_python_requests` `generate_api_spec` `generate_har` |
| **Interactive** | 13 | `interact_click_at` `interact_drag` `interact_hover` `interact_scroll` `interact_keyboard` `interact_fill_form` `interact_select_option` `interact_upload_file` `interact_screenshot_annotate` `interact_wait_for_navigation` `interact_dialog_handle` `interact_new_tab` `interact_switch_tab` |
| **Capture** | 2 | `capture_get_all_requests` `capture_get_request_detail` |

---

## アーキテクチャ

```
Claude.AI / Claude Desktop / Claude Code / Cursor / VS Code
                    ↓ HTTPS (Streamable HTTP + Bearer Token)
           Cloudflare Tunnel (*.appserver.tokyo)
                    ↓
           Proxmox LXC Container
                    ↓
     playwright-devtools-mcp (Express + MCP SDK)
                    ↓
     Chromium (headless) + CDP Session
                    ↓
     Full request/response capture
                    ↓
     curl / Python requests / API Spec / HAR 生成
```

---

## クイックスタート

### ローカル開発

```bash
git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git
cd playwright-devtools-mcp
npm install
npx playwright install chromium --with-deps
npm run build
MCP_AUTH_TOKEN=my-secret npm start
```

### Claude Desktop (stdio)

```json
{
  "mcpServers": {
    "playwright-devtools": {
      "command": "node",
      "args": ["/path/to/playwright-devtools-mcp/dist/index.js"],
      "env": { "TRANSPORT": "stdio" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --transport http playwright-devtools https://your-domain/mcp
```

---

## Proxmox LXC デプロイ (ステップバイステップ)

### Step 1: LXCコンテナ作成

```bash
# Proxmox ホストで実行
pct create 310 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
  --hostname playwright-mcp \
  --memory 4096 \
  --cores 2 \
  --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=1

pct start 310
pct enter 310
```

### Step 2: Node.js & アプリケーションインストール

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git curl

# クローン & ビルド
cd /opt
git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git
cd playwright-devtools-mcp
npm install
npx playwright install chromium --with-deps
npm run build

# 動作確認
node dist/index.js &
curl http://localhost:3100/health
# → {"status":"ok","server":"playwright-devtools-mcp","version":"1.0.0",...}
kill %1
```

### Step 3: 認証トークン & systemdサービス

```bash
# 認証トークン生成
TOKEN=$(openssl rand -hex 32)
echo "Generated token: $TOKEN"

# 環境変数ファイル
cat > /opt/playwright-devtools-mcp/.env << EOF
MCP_AUTH_TOKEN=$TOKEN
PORT=3100
HOST=0.0.0.0
EOF

# systemd unit ファイル
cat > /etc/systemd/system/playwright-mcp.service << EOF
[Unit]
Description=Playwright DevTools MCP Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/playwright-devtools-mcp
EnvironmentFile=/opt/playwright-devtools-mcp/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

# 起動
systemctl daemon-reload
systemctl enable --now playwright-mcp
systemctl status playwright-mcp
journalctl -u playwright-mcp -f  # ログ確認
```

### Step 4: Cloudflare Tunnel設定

既存のCloudflare Tunnel設定ファイルにエントリを追加：

```yaml
# ~/.cloudflared/config.yml (または該当のconfig)
ingress:
  - hostname: playwright-mcp.appserver.tokyo
    service: http://<LXC_IP>:3100
  # ... 他のエントリ
  - service: http_status:404
```

```bash
# Cloudflare DNS (CNAME)
# playwright-mcp.appserver.tokyo → <tunnel-id>.cfargotunnel.com

# Tunnel再起動
systemctl restart cloudflared

# 外部からテスト
curl https://playwright-mcp.appserver.tokyo/health
```

### Step 5: Claude.AI コネクタ登録

1. [claude.ai](https://claude.ai) → Settings → Connectors
2. **Add Custom Connector** をクリック
3. URL: `https://playwright-mcp.appserver.tokyo/mcp`
4. **Advanced Settings** → Authorization Token: `Step 3で生成したトークン`
5. **Add** → 接続完了
6. チャットで 🔌 ボタン → **playwright-devtools** を有効化
7. テスト: 「ブラウザを起動して https://example.com を開いて」

---

## 使い方: リバースエンジニアリング

### AIとの対話例

```
あなた: 「このWebアプリのログインフローのAPIを解析したい。URLは https://app.example.com/login」

Claude: [browser_launch → flow_start_recording → browser_navigate]
        「ページを開きました。ログインフォームが表示されています。
         ユーザー名とパスワードを教えてください。」

あなた: 「user: admin@test.com  pass: P@ssw0rd」

Claude: [interact_fill_form × 2 → interact_click_at (submitボタン)]
        [interact_wait_for_navigation]
        「ログインに成功し、ダッシュボードに遷移しました。
         以下のAPIコールを検出しました:
         1. POST /api/auth/login → 200 (JWT返却)
         2. GET /api/user/profile → 200
         3. GET /api/dashboard/stats → 200」

あなた: 「curlで再現できるようにして」

Claude: [generate_curl_commands]
        「以下が再現用curlコマンドです:
         
         # Step 1: ログイン
         curl -X POST 'https://app.example.com/api/auth/login' \
           -H 'Content-Type: application/json' \
           -d '{"email":"admin@test.com","password":"P@ssw0rd"}'
         
         # Step 2: プロフィール取得
         curl 'https://app.example.com/api/user/profile' \
           -H 'Authorization: Bearer <jwt-token>'
         ...」

あなた: 「Python版も」

Claude: [generate_python_requests]
        「requestsライブラリ版のスクリプトです...」
```

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `MCP_AUTH_TOKEN` | *(なし)* | Bearer認証トークン。未設定時は認証なし (開発用) |
| `PORT` | `3100` | HTTPサーバーポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `TRANSPORT` | `http` | `http` (Streamable HTTP) or `stdio` |

---

## テスト

```bash
# 全テスト実行 (401件)
npm test

# 単体テストのみ (287件)
npm run test:unit

# 結合テストのみ (114件)
npm run test:integration

# ウォッチモード
npm run test:watch
```

テスト構成:

| スイート | テスト数 | カバー範囲 |
|---------|---------|-----------|
| schemas | 18 | makeSuccess / makeError レスポンス形式 |
| constants | 8 | 定数値の妥当性 |
| server & tools | 176 | ツール登録・MCPプロトコル・エラーハンドリング |
| edge-cases | 85 | 全57ツールのセッション不正エラー・起動オプション・レスポンス形式 |
| browser-basic | 63 | ブラウザ操作・コンソール・ネットワーク・ストレージ・DOM・パフォーマンス・セキュリティ |
| flow-interactive | 51 | フロー記録・API生成・座標操作・ドラッグ・スクロール・タブ・E2Eシナリオ |
| deep-scenarios | 58 | ネットワークボディキャプチャ・curl/Python/HAR詳細・マルチページフロー・セッション分離 |
| comprehensive | 97 | DOM要素プロパティ全網羅・CSSスタイル検証・セキュリティヘッダー全項目・コンソール詳細・JS評価20パターン |

---

## 対応クライアント

| クライアント | 接続方法 |
|------------|---------|
| **Claude.AI** (Web/Mobile) | Custom Connector (Streamable HTTP) |
| **Claude Desktop** | stdio or Connector |
| **Claude Code** | `claude mcp add --transport http` |
| **Cursor / VS Code** | MCP HTTP endpoint |
| **Anthropic API** | `mcp_servers` parameter |
| **MCP Inspector** | `npx @modelcontextprotocol/inspector` |

---

## ライセンス

MIT

---

## 関連プロジェクト

- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) — 公式ブラウザ自動化MCP
- [Playwright](https://playwright.dev/) — ブラウザ自動化フレームワーク
- [MCP Specification](https://modelcontextprotocol.io/) — Model Context Protocol仕様
