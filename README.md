# Portfolio Pulse

A **local-first, open-source Electron desktop app** for Indian retail investors that connects directly to **INDmoney MCP** and **Upstox MCP** via OAuth, tracks daily portfolio snapshots in SQLite, runs deterministic multi-broker reconciliation & SIP/cashflow audits with native OS notifications, and offers an optional **BYOK AI Insights** tab (Anthropic Claude, Google Gemini, OpenAI/compatible, or offline Ollama).

> **Disclaimer:** Portfolio Pulse is a local analytics, reconciliation, and rule-based audit tool. It is **not** a SEBI-registered Investment Adviser (IA). Deterministic alerts and optional BYOK AI outputs are for informational and educational purposes only.

---

## Key Features

- **100% Local-First Privacy:** Zero backend servers, zero telemetry. OAuth tokens and AI API keys are encrypted locally via Electron `safeStorage` (macOS Keychain / Windows DPAPI). Historical snapshots live in a local SQLite file.
- **Multi-Broker Reconciliation (INDmoney + Upstox):**
  - **INDmoney MCP (Required):** Net worth, asset allocation, mutual funds, active SIP mandates, savings account cash, and multi-broker stock holdings.
  - **Upstox MCP (Optional):** Live demat equity purchase cost basis, accurate unrealized P&L, idle trading margin, and automatic non-equity bond/NCD separation.
  - **Resilient Partial Sync:** If Upstox's OAuth session expires during a background daily refresh, INDmoney still syncs cleanly while carrying forward your last known Upstox cost basis and firing a 1-click OS notification to reconnect Upstox.
- **Daily Refresh & Native Desktop Notifications:** Menu-bar / system tray resident scheduler (default **21:30 local time**, after NSE close and AMFI NAV updates) with wake-from-sleep catch-up.
- **Deterministic Audit Engine (Free, Offline):**
  - Day-over-day net worth delta & top movers
  - Multi-broker quantity/value discrepancies + 1-click symbol alias mapper
  - Idle broker cash alerts
  - Savings Account cash sufficiency check ahead of upcoming SIP debits
  - Expected SIP baseline drift detection (missing/paused/changed SIPs)
  - Emergency cushion progress, drawdown watchlist, and concentration alerts
- **Hybrid Strategy Profile + BYOK AI Insights:**
  - Combine structured numeric thresholds with a freeform Markdown **My Strategy & Goals** document.
  - Generate structured **Portfolio Review Reports** (with saved archive) and run **interactive follow-up Q&A chat** using your own **Anthropic Claude**, **Google Gemini**, **OpenAI / OpenAI-compatible**, or **Local Ollama** model.
- **Demo Mode & Portability:** Evaluate the entire app risk-free with a synthetic Indian Demo Portfolio, and export snapshots anytime as a Markdown + JSON bundle.

---

## Development Setup

Requires Node.js 20+.

```bash
npm install
npm run dev
```

### Scripts

- `npm run dev` — Start Electron + Vite dev server with hot reload
- `npm run test` — Run unit test suite (`vitest`)
- `npm run typecheck` — Run TypeScript strict typecheck
- `npm run build` — Build production main, preload, and renderer bundles
- `npm run pack:mac` — Package unsigned macOS `.dmg` (arm64 + x64)
- `npm run pack:win` — Package unsigned Windows `.exe` installer

### Installing Unsigned Releases (macOS / Windows)

Because open-source GitHub Releases are initially unsigned:
- **macOS:** Right-click `Portfolio Pulse.app` → **Open** (or `xattr -cr "/Applications/Portfolio Pulse.app"`).
- **Windows:** Click **More info → Run anyway** on SmartScreen.

---

## License

MIT — see [LICENSE](./LICENSE).
