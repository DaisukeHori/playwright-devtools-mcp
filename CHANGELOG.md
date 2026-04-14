# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2025-04-14

### Added
- **57 MCP tools** across 10 categories
- **CDP full-fidelity network capture** via `Network.getResponseBody`
- **Flow recording** for reverse engineering workflows
- **API spec generation**: curl, Python requests, Markdown API spec, HAR 1.2
- **Interactive tools**: coordinate click, drag, hover, scroll, keyboard, form fill, select, file upload, tab management
- **Grid overlay screenshot** (`interact_screenshot_annotate`) for visual debugging
- **Console log collection** with type/text filtering
- **Performance monitoring**: CDP metrics, Navigation Timing, Core Web Vitals, Resource Timing
- **Storage inspection**: localStorage, sessionStorage, cookies, IndexedDB
- **DOM/accessibility inspection**: DOM tree, element properties, computed styles, page source, accessibility snapshot
- **Security analysis**: HTTP security headers, SSL certificate info, mixed content detection
- **Streamable HTTP transport** for Claude.AI connector compatibility
- **Bearer token authentication** for MCP endpoint
- **GitHub Webhook CI/CD**: HMAC-SHA256 signed auto-deploy via `/webhook/deploy`
- **Deploy script** with lockfile, detached execution, health check
- **576 tests** (307 unit + 269 integration), all passing
- **Landing page** at GitHub Pages
- **Dockerfile** for container deployment
- **systemd service** configuration
