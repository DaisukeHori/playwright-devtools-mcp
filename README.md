# playwright-devtools-mcp

**Playwright + Chrome DevTools Protocol MCP サーバー**  
ブラウザ操作のリバースエンジニアリング ＆ 完全なDevToolsデバッグ機能をClaude.AI/Claude Desktop/Claude Codeから利用可能にする。

## 概要

人がブラウザで行う操作フローをAIが追跡しながら、CDP (Chrome DevTools Protocol) で通信を完全キャプチャし、`curl` / `requests` で再現可能な **API仕様書を自動生成** するリバースエンジニアリングMCPサーバーです。

**57ツール**を搭載し、以下の機能を提供します：

| カテゴリ | ツール数 | 機能 |
|---------|---------|------|
| **Browser** | 9 | 起動, ナビゲーション, クリック, 入力, スクリーンショット, JS実行, Wait |
| **Console** | 3 | コンソールログ取得, フィルタ, 例外収集 |
| **Network** | 4 | CDP完全キャプチャ, 失敗リクエスト, サマリー |
| **Performance** | 4 | CDPメトリクス, Navigation Timing, Core Web Vitals, Resource Timing |
| **Storage** | 5 | localStorage, sessionStorage, Cookies, IndexedDB, クリア |
| **Debug** | 5 | DOM Tree, 要素プロパティ, ページソース, アクセシビリティ, querySelector |
| **Security** | 3 | セキュリティヘッダー分析, SSL証明書, Mixed Content検出 |
| **Flow** | 5 | フロー記録, ステップ管理, APIコールキャプチャ |
| **Generate** | 4 | curl生成, Python requests生成, API仕様書生成, HAR出力 |
| **Interactive** | 12 | 座標クリック, ドラッグ, ホバー, スクロール, キーボード, フォーム, ドロップダウン, ファイルアップロード, タブ管理, グリッド付きスクリーンショット |

## アーキテクチャ

```
Claude.AI / Claude Desktop / Claude Code
            ↓ HTTPS (Streamable HTTP)
   Cloudflare Tunnel (*.appserver.tokyo)
            ↓
   Proxmox LXC Container
            ↓
   playwright-devtools-mcp (Express + MCP SDK)
            ↓
   Chromium (headless) + CDP Session
            ↓
   Full request/response capture → API spec generation
```

## クイックスタート

### 1. インストール

```bash
git clone https://github.com/DaisukeHori/playwright-devtools-mcp.git
cd playwright-devtools-mcp
npm install
npx playwright install chromium --with-deps
npm run build
```

### 2. 起動

```bash
# HTTP transport (Claude.AI connector用)
MCP_AUTH_TOKEN=your-secret-token PORT=3100 npm start

# stdio transport (Claude Desktop / Claude Code用)
TRANSPORT=stdio npm start
```

### 3. Claude.AIコネクタ登録

1. Settings → Connectors → Add Custom Connector
2. URL: `https://your-domain.appserver.tokyo/mcp`
3. Advanced settings → Authorization Token: `your-secret-token`

### 4. Claude Desktopの場合

```json
{
  "mcpServers": {
    "playwright-devtools": {
      "command": "node",
      "args": ["/path/to/playwright-devtools-mcp/dist/index.js"],
      "env": {
        "TRANSPORT": "stdio"
      }
    }
  }
}
```

## 使い方: リバースエンジニアリング

### AIとの対話例

```
あなた: 「このWebアプリのログインフローのAPIを解析したい」

Claude: browser_launch → flow_start_recording → browser_navigate(login_url)
        → interact_screenshot_annotate (画面確認)
        → 「ログイン画面が表示されました。ユーザー名とパスワードを教えてください」

あなた: 「ユーザー名はtest@example.com、パスワードはpassword123」

Claude: interact_fill_form(username) → interact_fill_form(password)
        → interact_click_at(submit_button)
        → interact_wait_for_navigation
        → flow_get_captured_api_calls (APIコール確認)
        → 「ログインAPIを検出しました: POST /api/auth/login → 200」

あなた: 「curl で再現できるようにして」

Claude: generate_curl_commands → generate_api_spec
        →「以下がログインフローの再現curlコマンドです...」
```

## 環境変数

| 変数 | デフォルト | 説明 |
|------|-----------|------|
| `MCP_AUTH_TOKEN` | (なし) | Bearer認証トークン。未設定=認証なし |
| `PORT` | `3100` | HTTPサーバーポート |
| `HOST` | `0.0.0.0` | バインドアドレス |
| `TRANSPORT` | `http` | `http` or `stdio` |

## Proxmox LXCへのデプロイ

### Docker使用

```bash
docker build -t playwright-devtools-mcp .
docker run -d \
  --name playwright-mcp \
  -p 3100:3100 \
  -e MCP_AUTH_TOKEN=your-secret-token \
  --restart unless-stopped \
  playwright-devtools-mcp
```

### systemdサービス

```ini
# /etc/systemd/system/playwright-devtools-mcp.service
[Unit]
Description=Playwright DevTools MCP Server
After=network.target

[Service]
Type=simple
User=mcp
WorkingDirectory=/opt/playwright-devtools-mcp
ExecStart=/usr/bin/node dist/index.js
Environment=MCP_AUTH_TOKEN=your-secret-token
Environment=PORT=3100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## ライセンス

MIT
