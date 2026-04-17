# playwright-devtools-mcp

[![Tests](https://img.shields.io/badge/tests-576%20passed-brightgreen)](https://github.com/DaisukeHori/playwright-devtools-mcp)
[![Tools](https://img.shields.io/badge/MCP%20tools-57-blue)](https://github.com/DaisukeHori/playwright-devtools-mcp)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-purple)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Playwright + Chrome DevTools Protocol MCP Server**

ブラウザ操作のリバースエンジニアリング & 完全なDevToolsデバッグ機能を Claude.AI / Claude Desktop / Claude Code から利用可能にするMCPサーバー。

> **核心機能**: 人がブラウザで行う操作フローをAIが追跡しながら、CDPで通信を完全キャプチャし、`curl` / `requests` で再現可能な**API仕様書を自動生成**する。

**→ [ランディングページ](https://daisukehori.github.io/playwright-devtools-mcp/)**

---

## 目次

- [機能一覧](#機能一覧-57ツール--10カテゴリ)
- [アーキテクチャ](#アーキテクチャ)
- [クイックスタート](#クイックスタート)
- [全ツール詳細](#全ツール詳細)
- [使い方: リバースエンジニアリング](#使い方-リバースエンジニアリング)
- [Proxmox LXC デプロイ](#proxmox-lxc-デプロイ-ステップバイステップ)
- [CI/CD (GitHub Webhook)](#cicd-github-webhook-自動デプロイ)
- [環境変数](#環境変数)
- [テスト](#テスト)
- [トラブルシューティング](#トラブルシューティング)
- [対応クライアント](#対応クライアント)
- [Contributing](#contributing)

---

## 機能一覧 (57ツール × 10カテゴリ)

| カテゴリ | ツール数 | 概要 |
|---------|---------|------|
| **Browser** | 9 | Chromium操作: 起動・ナビゲーション・クリック・入力・JS実行・スクリーンショット |
| **Console** | 3 | console.log/warn/error リアルタイム収集・フィルタ・例外抽出 |
| **Network** | 4 | CDP完全キャプチャ (ボディ含む)・失敗リクエスト・サマリー |
| **Performance** | 4 | CDPメトリクス・Navigation Timing・Core Web Vitals・Resource Timing |
| **Storage** | 5 | localStorage・sessionStorage・Cookie・IndexedDB・選択クリア |
| **Debug** | 5 | DOM Tree・要素プロパティ (computed styles)・ページソース・アクセシビリティ |
| **Security** | 3 | セキュリティヘッダー分析・SSL情報・Mixed Content検出 |
| **Flow** | 5 | フロー記録・APIコールキャプチャ・アノテーション |
| **Generate** | 4 | curl生成・Python requests生成・API仕様書・HAR出力 |
| **Interactive** | 13 | 座標クリック・ドラッグ・スクロール・キーボード・フォーム・タブ・グリッドスクリーンショット |
| **Capture** | 2 | 全リクエスト取得・リクエスト詳細 |

---

## アーキテクチャ

```
Claude.AI / Claude Desktop / Claude Code / Cursor / Anthropic API
                    ↓ HTTPS (Streamable HTTP + Bearer Token)
           Cloudflare Tunnel (*.appserver.tokyo)
                    ↓
           Proxmox LXC Container (port 3100)
                    ↓
     playwright-devtools-mcp (Express + MCP SDK)
       ├─ POST /mcp          ← MCP tools (57個)
       ├─ POST /webhook/deploy ← GitHub Webhook CI/CD
       ├─ GET  /health        ← ステータス
       ├─ GET  /webhook/status ← デプロイ状態
       └─ GET  /webhook/log   ← デプロイログ
                    ↓
     Chromium (headless) + CDP Session
       ├─ Network.getResponseBody  → リクエスト/レスポンス完全キャプチャ
       ├─ Runtime/Performance/Log  → メトリクス・コンソール
       └─ DOM/CSS/Security         → 要素検査・セキュリティ
                    ↓
     curl / Python requests / API Spec / HAR 自動生成
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
# → http://localhost:3100/mcp
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

## 全ツール詳細

### Browser (9)

| ツール | 引数 | 説明 |
|-------|------|------|
| `browser_launch` | viewport_width, viewport_height, user_agent, locale, timezone, extra_headers | Chromium起動、CDP全ドメイン有効化、session_id返却 |
| `browser_navigate` | session_id, url, wait_until, timeout | URL遷移。wait_until: load/domcontentloaded/networkidle/commit |
| `browser_screenshot` | session_id, full_page, selector, format, quality | PNG/JPEG スクリーンショット。要素指定可 |
| `browser_click` | session_id, selector, button, click_count, timeout | CSS セレクタでクリック。右クリック・ダブルクリック対応 |
| `browser_type` | session_id, selector, text, clear_first, delay | テキスト入力。clear_first でクリア後入力 |
| `browser_evaluate` | session_id, expression | JavaScript実行。戻り値をJSON返却。async対応 |
| `browser_wait` | session_id, selector, state, timeout | 要素出現/消滅/表示/非表示を待機 |
| `browser_close` | session_id | セッション終了、全リソース解放 |
| `browser_list_sessions` | *(なし)* | 全アクティブセッション一覧 |

### Console (3)

| ツール | 引数 | 説明 |
|-------|------|------|
| `console_get_logs` | session_id, types, limit, since, search | ログ取得。types: error/warning/log/info/debug。テキスト検索対応 |
| `console_clear_logs` | session_id | ログバッファクリア |
| `console_get_exceptions` | session_id, limit | error/pageerror のみ抽出 |

### Network (4)

| ツール | 引数 | 説明 |
|-------|------|------|
| `network_get_requests` | session_id, url_filter, method_filter, resource_type, api_only, limit | CDP完全キャプチャからフィルタ取得。api_only=true でXHR/Fetchのみ |
| `network_get_failed_requests` | session_id, limit | 4xx/5xx + 接続エラー |
| `network_get_summary` | session_id | リソースタイプ別・ステータスコード別集計 |
| `network_clear` | session_id | キャプチャバッファクリア |

### Performance (4)

| ツール | 引数 | 説明 |
|-------|------|------|
| `performance_get_metrics` | session_id | CDP Performance.getMetrics: JSHeapSize, Documents, Nodes等 |
| `performance_get_navigation_timing` | session_id | DNS, TCP, TTFB, DOM処理, ページロード時間 |
| `performance_get_core_web_vitals` | session_id, wait_ms | LCP, CLS, FCP, TTFB + good/needs-improvement/poor 判定 |
| `performance_get_resource_timing` | session_id, resource_type, sort_by, limit | 個別リソースのロード時間。sort: duration/transferSize/startTime |

### Storage (5)

| ツール | 引数 | 説明 |
|-------|------|------|
| `storage_get_local_storage` | session_id, key_filter | 全キー・値・サイズ。key_filterで絞り込み |
| `storage_get_session_storage` | session_id, key_filter | sessionStorage同様 |
| `storage_get_cookies` | session_id, domain_filter | httpOnly, secure, sameSite, expires属性含む |
| `storage_get_indexeddb_info` | session_id | DB一覧、オブジェクトストア名、レコード数 |
| `storage_clear_data` | session_id, types[] | localStorage/sessionStorage/cookies 選択クリア |

### Debug (5)

| ツール | 引数 | 説明 |
|-------|------|------|
| `debug_get_dom_tree` | session_id, selector, max_depth, include_text | 構造化DOMツリー。深さ制限・テキスト含有可 |
| `debug_get_element_properties` | session_id, selector, include_computed_styles, style_properties | 属性・boundingBox・computedStyles・アクセシビリティ |
| `debug_get_page_source` | session_id, selector, max_length | HTML + 統計(ノード数, スクリプト数, フォーム数等) |
| `debug_get_accessibility_tree` | session_id | Playwright ariaSnapshot (スクリーンリーダー相当) |
| `debug_query_selector_all` | session_id, selector, limit | マッチ要素一覧 (tag, id, classes, text, visible, href) |

### Security (3)

| ツール | 引数 | 説明 |
|-------|------|------|
| `security_analyze_headers` | session_id | HSTS/CSP/XFO/XCTO/Referrer-Policy/Permissions-Policy 分析+スコア |
| `security_get_certificate` | session_id | SSL/TLS情報、HTTPSかどうか |
| `security_check_mixed_content` | session_id | HTTPSページ上のHTTPリソース検出 |

### Flow (5)

| ツール | 引数 | 説明 |
|-------|------|------|
| `flow_start_recording` | session_id, flow_name, capture_static | フロー記録開始。以降の操作とAPIコールを自動記録 |
| `flow_stop_recording` | session_id | 記録停止。サマリー返却 |
| `flow_add_step` | session_id, description | 手動アノテーション追加 (例: "ログインボタンをクリック") |
| `flow_get_steps` | session_id, action_filter, include_request_details | 記録済みステップ取得。action_filter: api_call/navigate/click等 |
| `flow_get_captured_api_calls` | session_id, url_filter, method_filter, include_bodies, max_body_length | XHR/Fetch のリクエスト・レスポンス完全取得 |

### Generate (4)

| ツール | 引数 | 説明 |
|-------|------|------|
| `generate_curl_commands` | session_id, url_filter, include_common_headers, shell | **curlコマンド生成**。POST data, Cookie, Auth ヘッダー含む |
| `generate_python_requests` | session_id, url_filter, use_session | **Python requests スクリプト生成**。Session対応、BASE_URL抽出 |
| `generate_api_spec` | session_id, format, url_filter, group_by | **API仕様書生成** (Markdown/JSON)。エンドポイントをパスパターンでグループ化 |
| `generate_har` | session_id, api_only | **HAR 1.2 出力**。Chrome DevTools/Postman/Charles でインポート可能 |

### Capture (2)

| ツール | 引数 | 説明 |
|-------|------|------|
| `capture_get_all_requests` | session_id, url_filter, resource_types, status_min, status_max, limit | 全キャプチャ済みリクエスト (API以外含む) |
| `capture_get_request_detail` | session_id, seq, max_body_length | seq番号指定でリクエスト詳細 (全ヘッダー・ボディ) |

### Interactive (13)

| ツール | 引数 | 説明 |
|-------|------|------|
| `interact_click_at` | session_id, x, y, button, click_count, modifiers, delay | **座標クリック**。CSS セレクタ不要。canvas/SVG/iframe対応 |
| `interact_drag` | session_id, from_x, from_y, to_x, to_y, steps | **ドラッグ&ドロップ**。steps でスムーズ度調整 |
| `interact_hover` | session_id, x, y, selector | マウスホバー (座標 or セレクタ) |
| `interact_scroll` | session_id, direction, amount, selector, scroll_to_selector | スクロール (上下左右 + 要素まで) |
| `interact_keyboard` | session_id, key, text | キー入力。ショートカット対応 (Control+a, Enter等) |
| `interact_fill_form` | session_id, selector, value | フォームフィールド直接設定 (fill) |
| `interact_select_option` | session_id, selector, value/label/index | \<select\> ドロップダウン選択 |
| `interact_upload_file` | session_id, selector, files[] | ファイルアップロード (base64) |
| `interact_screenshot_annotate` | session_id, grid_size, full_page, highlight_selector | **グリッド付きスクリーンショット**。座標特定用 |
| `interact_wait_for_navigation` | session_id, url_pattern, timeout | ナビゲーション完了待機 |
| `interact_dialog_handle` | session_id, action, prompt_text | alert/confirm/prompt 自動応答設定 |
| `interact_new_tab` | session_id, url | 新規タブ開設 |
| `interact_switch_tab` | session_id, tab_index | タブ切り替え |

---

## 使い方: リバースエンジニアリング

### 例1: ログインフローのAPI解析

```
あなた: 「https://app.example.com のログインフローのAPIを解析したい」

Claude: browser_launch → flow_start_recording → browser_navigate
        → interact_screenshot_annotate (グリッド付き画面確認)
        「ログインページが表示されました。フォームが見えます。
         認証情報を教えてください。」

あなた: 「user: admin@test.com  pass: P@ssw0rd」

Claude: interact_fill_form(#email) → interact_fill_form(#password)
        → interact_click_at(submitボタン座標)
        → interact_wait_for_navigation
        → flow_get_captured_api_calls
        「3つのAPIコールを検出:
         1. POST /api/auth/login → 200 (JWT返却)
         2. GET /api/user/profile → 200
         3. GET /api/dashboard/stats → 200」

あなた: 「curlで再現して」

Claude: generate_curl_commands →
        「# Step 1: ログイン
         curl -X POST 'https://app.example.com/api/auth/login' \
           -H 'Content-Type: application/json' \
           -d '{"email":"admin@test.com","password":"P@ssw0rd"}'
         ...」
```

### 例2: パフォーマンスデバッグ

```
あなた: 「このページが遅い。原因を調べて」

Claude: browser_launch → browser_navigate(url)
        → performance_get_core_web_vitals
        「LCP: 4.2s (poor), CLS: 0.02 (good), FCP: 1.8s (needs-improvement)」
        → performance_get_resource_timing(sort_by: duration)
        「最も遅いリソース:
         1. /api/heavy-query → 3800ms
         2. /static/bundle.js → 1200ms
         3. /images/hero.jpg → 800ms」
        → network_get_summary
        「合計リクエスト: 47, 失敗: 2 (404)
         提案: /api/heavy-query のレスポンスタイムが LCP に直結しています。」
```

### 例3: セキュリティ監査

```
あなた: 「本番サイトのセキュリティヘッダーをチェックして」

Claude: browser_launch → browser_navigate(url)
        → security_analyze_headers
        「スコア: 4/6 通過
         ✅ Strict-Transport-Security (max-age=31536000)
         ✅ Content-Security-Policy
         ✅ X-Frame-Options (DENY)
         ✅ X-Content-Type-Options (nosniff)
         ❌ Referrer-Policy: 未設定 → strict-origin-when-cross-origin を推奨
         ❌ Permissions-Policy: 未設定 → カメラ・マイク等の制御を推奨」
```

---

## Proxmox LXC デプロイ (ステップバイステップ)

### Step 1: LXCコンテナ作成

```bash
pct create 310 local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst \
  --hostname playwright-mcp --memory 4096 --cores 2 --rootfs local-lvm:20 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp --features nesting=1
pct start 310 && pct enter 310
```

### Step 2: インストール

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs git curl

# アプリケーション
cd /opt
git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git
cd playwright-devtools-mcp
npm install
npx playwright install chromium --with-deps
npm run build
```

### Step 3: 環境変数 & systemd

```bash
# トークン生成
MCP_TOKEN=$(openssl rand -hex 32)
WEBHOOK_TOKEN=$(openssl rand -hex 32)

cat > /opt/playwright-devtools-mcp/.env << EOF
MCP_AUTH_TOKEN=$MCP_TOKEN
WEBHOOK_SECRET=$WEBHOOK_TOKEN
PORT=3100
HOST=0.0.0.0
DEPLOY_BRANCH=main
EOF

echo "MCP_AUTH_TOKEN=$MCP_TOKEN"
echo "WEBHOOK_SECRET=$WEBHOOK_TOKEN"

# systemd
cat > /etc/systemd/system/playwright-mcp.service << EOF
[Unit]
Description=Playwright DevTools MCP Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/playwright-devtools-mcp
EnvironmentFile=/opt/playwright-devtools-mcp/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now playwright-mcp
```

### Step 4: Cloudflare Tunnel

```yaml
# tunnel config に追加
ingress:
  - hostname: playwright-mcp.appserver.tokyo
    service: http://<LXC_IP>:3100
```

### Step 5: Claude.AI コネクタ

1. claude.ai → Settings → Connectors → **Add Custom Connector**
2. URL: `https://playwright-mcp.appserver.tokyo/mcp`
3. Advanced → Authorization Token: Step 3 の `MCP_AUTH_TOKEN`

### Step 6: GitHub Webhook (CI/CD)

1. GitHub → Settings → Webhooks → **Add webhook**
2. URL: `https://playwright-mcp.appserver.tokyo/webhook/deploy`
3. Secret: Step 3 の `WEBHOOK_SECRET`
4. Events: **Just the push event**

---

## CI/CD (GitHub Webhook 自動デプロイ)

```
git push (main) → GitHub Webhook (HMAC-SHA256) → Cloudflare Tunnel
  → /webhook/deploy → scripts/deploy.sh (detached)
  → git pull → npm ci → build → systemctl restart → health check
```

| エンドポイント | メソッド | 認証 | 説明 |
|-------------|---------|------|------|
| `/webhook/deploy` | POST | HMAC-SHA256 | デプロイトリガー |
| `/webhook/status` | GET | なし | デプロイ状態 |
| `/webhook/log` | GET | なし | deploy.log 末尾200行 |

---

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `MCP_AUTH_TOKEN` | *(なし)* | Bearer認証トークン |
| `WEBHOOK_SECRET` | *(なし)* | GitHub Webhook Secret |
| `DEPLOY_BRANCH` | `main` | デプロイ対象ブランチ |
| `PORT` | `3100` | HTTPポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `TRANSPORT` | `http` | `http` or `stdio` |

---

## テスト

```bash
npm test                    # 全テスト
npm run test:unit           # 単体テスト
npm run test:integration    # 結合テスト
```

| スイート | テスト数 | 内容 |
|---------|---------|------|
| schemas | 18 | レスポンス形式 |
| constants | 8 | 定数値 |
| server | 176 | ツール登録・MCPプロトコル |
| edge-cases | 85 | 全57ツール エラーハンドリング |
| webhook | 20 | HMAC署名・イベント/ブランチフィルタ |
| browser-basic | 63 | ブラウザ・コンソール・ネットワーク・ストレージ・DOM・パフォーマンス |
| flow-interactive | 51 | フロー記録・API生成・インタラクティブ操作・E2E |
| deep-scenarios | 58 | CDPボディキャプチャ・curl/Python詳細 |
| comprehensive | 97 | DOM全要素・CSS・セキュリティ・JS評価20パターン |

---

## トラブルシューティング

### Claude.AIで "Couldn't reach MCP server"

1. `curl https://your-domain/health` でサーバー到達確認
2. Cloudflare Tunnel が稼働しているか確認: `systemctl status cloudflared`
3. Anthropic IP をファイアウォールで許可しているか確認

### ブラウザ起動エラー

```bash
# Chromium依存関係の再インストール
npx playwright install chromium --with-deps

# LXCでnesting=1が有効か確認 (Proxmox)
pct set <VMID> --features nesting=1
```

### Webhookデプロイが動かない

```bash
# 署名テスト
PAYLOAD='{"ref":"refs/heads/main","head_commit":{"id":"test"}}'
SIG="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | awk '{print $2}')"
curl -X POST https://your-domain/webhook/deploy \
  -H "Content-Type: application/json" \
  -H "X-Hub-Signature-256: $SIG" \
  -H "X-GitHub-Event: push" \
  -d "$PAYLOAD"

# デプロイログ確認
curl https://your-domain/webhook/log
```

### メモリ不足

Chromiumはメモリを消費します。LXCに最低4GB RAM推奨。複数セッション同時利用時は `browser_close` で不要セッションを解放してください。

---

## 対応クライアント

| クライアント | 接続方法 |
|------------|---------|
| **Claude.AI** | Custom Connector (Streamable HTTP) |
| **Claude Desktop** | stdio or Connector |
| **Claude Code** | `claude mcp add --transport http` |
| **Claude Mobile** | Connector経由 |
| **Cursor / VS Code** | MCP HTTP endpoint |
| **Anthropic API** | `mcp_servers` parameter |

---

## Contributing

1. Fork → `git checkout -b feature/xxx`
2. コード変更 → `npm run build` → `npm test`
3. Pull Request

ツール追加は `src/tools/` にファイルを作成し、`src/index.ts` の `createServer()` に登録するだけです。

---

## ライセンス

[MIT](LICENSE)

## 関連プロジェクト

- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp)
- [Playwright](https://playwright.dev/)
- [MCP Specification](https://modelcontextprotocol.io/)

---

## 関連 MCP サーバー

堀が公開している MCP サーバー群。すべて Claude.ai / Cursor / ChatGPT 等の MCP クライアントから利用可能。

| サーバー | ツール数 | 説明 |
|:--|:--:|:--|
| **[b2cloud-api](https://github.com/DaisukeHori/b2cloud-api)** | 14 | ヤマト B2クラウド送り状発行 API/MCP |
| **[cloudflare-mcp](https://github.com/DaisukeHori/cloudflare-mcp)** | 69 | Cloudflare 統合（Tunnel/DNS/Workers/Pages/R2/KV/SSL/Access） |
| **[hubspot-ma-mcp](https://github.com/DaisukeHori/hubspot-ma-mcp)** | 128 | HubSpot MA（CRM/Marketing/Knowledge Store） |
| **[msgraph-mcp-server](https://github.com/DaisukeHori/msgraph-mcp-server)** | 48 | Microsoft Graph API（Exchange/Teams/OneDrive/SharePoint） |
| **playwright-devtools-mcp** ← 今ここ | 57 | Playwright + Chrome DevTools（ブラウザ自動化） |
| **[proxmox-mcp-server](https://github.com/DaisukeHori/proxmox-mcp-server)** | 35 | Proxmox VE 仮想化基盤操作 |
| **[printer-mcp-server](https://github.com/DaisukeHori/printer-mcp-server)** | — | CUPS ネットワークプリンタ制御（Kyocera TASKalfa） |
| **[yamato-printer-mcp-server](https://github.com/DaisukeHori/yamato-printer-mcp-server)** | — | ヤマト送り状サーマルプリンタ（ラズパイ + WS-420B） |
| **[ssh-mcp-server](https://github.com/DaisukeHori/ssh-mcp-server)** | 10 | SSH クライアント（セッション管理/非同期コマンド） |
| **[mac-remote-mcp](https://github.com/DaisukeHori/mac-remote-mcp)** | 34 | macOS リモート制御（Shell/GUI/ファイル/アプリ） |
| **[gemini-image-mcp](https://github.com/DaisukeHori/gemini-image-mcp)** | 4 | Gemini/Imagen 画像生成 |
| **[runpod-mcp](https://github.com/DaisukeHori/runpod-mcp)** | 36 | RunPod GPU FaaS（Pods/Endpoints/Jobs） |
| **[firecrawl-mcp](https://github.com/DaisukeHori/firecrawl-mcp)** | — | Firecrawl セルフホスト Web スクレイピング |
| **[ad-ops-mcp](https://github.com/DaisukeHori/ad-ops-mcp)** | 62 | 広告運用自動化（Google Ads/Meta/GBP/X） |
