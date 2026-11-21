# Portfolio Pulse

A **local-first, open-source Electron desktop app** for Indian retail investors that connects directly to **INDmoney MCP** and **Upstox MCP** via OAuth, tracks daily portfolio snapshots in local SQLite, runs deterministic multi-broker reconciliation & SIP/cashflow audits with native OS notifications, and offers optional **BYOK AI Portfolio Reviews & Floating Q&A Chat** (Anthropic Claude, Google Gemini, OpenAI/compatible, or offline Ollama).

> **Disclaimer:** Portfolio Pulse is a local analytics, reconciliation, and rule-based audit tool. It is **not** a SEBI-registered Investment Adviser (IA). Deterministic alerts and optional BYOK AI outputs are for informational and educational purposes only.

---

## Key Features

- **100% Local-First Privacy:** Zero backend servers, zero telemetry. Broker OAuth tokens and optional AI API keys are encrypted locally via Electron `safeStorage` (macOS Keychain / Windows DPAPI). Historical snapshots live in a local SQLite database on your machine.
- **Flexible Multi-Broker Support (INDmoney, Upstox, or Both):**
  - **INDmoney MCP (Multi-Asset Aggregator):** Real Estate, Mutual Funds, PPF/EPF, Gold, Bonds/SGBs, Savings Accounts, active MF & Stock SIPs, and aggregated holdings across external brokers (Paytm Money, Zerodha, Groww, etc.).
  - **Upstox MCP (Demat Stocks, MFs, SIPs & Margin):** Live demat equity average buy prices, accurate unrealized P&L, Upstox MF holdings & active MF SIPs, idle trading margin, and automatic ISIN-based non-equity bond/NCD separation.
  - **Works Standalone or Combined:** Connect INDmoney only, Upstox only, or both together. *(Tip: For the most complete net-worth view across all asset classes and external brokers, link/record all assets inside INDmoney first.)*
  - **Resilient Partial Sync:** If Upstox's OAuth session expires during a background daily refresh, INDmoney still syncs cleanly while carrying forward your last known Upstox cost basis and firing a 1-click OS notification to reconnect.
- **Smart Holdings Reconciliation & Avg Cost Overrides:**
  - Zero-config NSE/BSE matching (ISIN → user alias → abbreviation & acronym matching → unambiguous qty/price fallback) + 1-click symbol alias mapper.
  - Preserves native INDmoney cost basis when available.
  - **Manual Avg Cost Editing & Multi-Broker CSV Import:** Click any **Avg Cost** cell in Holdings to edit inline, or click **Import Avg Cost CSV** to bulk-import average buy prices from **Paytm Money, Zerodha Console/Kite, Groww, Upstox, Angel One, ICICI Direct**, or any custom CSV — persisted across all future daily syncs.
- **Unified Multi-Broker SIP & Cashflow Audit (Free, Offline):**
  - Merges and deduplicates active SIPs across INDmoney (MF + Stock SIPs) and Upstox (active MF SIPs, filtering out cancelled/completed mandates).
  - Daily checks for day-over-day net worth delta, idle broker cash, Savings Account runway ahead of upcoming SIP debits, SIP baseline drift, emergency cushion progress, deep drawdowns, and single-stock concentration.
- **Daily Refresh & Native Desktop Notifications:**
  - Menu-bar / system tray resident scheduler (default **21:30 local time**, after NSE close and AMFI NAV publishing) with wake-from-sleep catch-up.
- **Hybrid Strategy + BYOK AI Insights & Global Floating Chat:**
  - Combine structured numeric audit thresholds with a freeform Markdown **My Strategy & Goals** editor.
  - Configure **Anthropic Claude**, **Google Gemini**, **OpenAI / OpenAI-compatible**, or **Local Ollama** under **Settings → AI Insights Configuration** with automatic **live model discovery** from each provider's API.
  - View archived structured reports in **AI Insights**, and open the **floating Ask AI Q&A chat** from any screen in the app.
- **Demo Mode & Data Portability:**
  - Evaluate the entire app risk-free via **Try Demo Portfolio First** (synthetic 14-day Indian portfolio), and export snapshots anytime as a Markdown + JSON bundle.

---

## Installing Releases (macOS & Windows)

Download the latest installer from the **Releases** tab:
- **macOS (Apple Silicon M1/M2/M3/M4):** `portfolio-pulse-*-arm64.dmg`
- **macOS (Intel):** `portfolio-pulse-*-x64.dmg`
- **Windows (64-bit):** `portfolio-pulse-*-setup.exe`

### Opening Unsigned Preview Builds
Because early preview releases are not yet Apple-notarized / Authenticode-signed, browsers tag downloaded files with OS quarantine flags:
- **macOS:** Open the `.dmg`, drag **Portfolio Pulse** to **Applications**, then run this once in Terminal before launching:
  ```bash
  xattr -cr "/Applications/Portfolio Pulse.app"
  ```
  *(Clears the browser `com.apple.quarantine` flag that otherwise causes macOS Gatekeeper to say the app is "damaged".)*
- **Windows:** On SmartScreen, click **More info → Run anyway**.

---

## Development Setup

Requires Node.js 20+.

```bash
npm install
npm run dev
```

### Scripts

- `npm run dev` — Start Electron + Vite dev server with hot reload
- `npm run test` — Run unit & SQLite integration tests (`vitest`)
- `npm run typecheck` — Run strict TypeScript typecheck
- `npm run build` — Build production main, preload, and renderer bundles
- `npm run pack:mac` — Package macOS `.dmg` installers (`arm64` + `x64`) locally into `dist/`
- `npm run pack:win` — Package Windows `.exe` installer locally into `dist/`

### Publishing Tagged Releases (GitHub Actions)

The workflow in [.github/workflows/release.yml](./.github/workflows/release.yml) runs typecheck & unit tests on Linux first, then builds macOS (`arm64` + `x64`) and Windows (`x64`) installers and attaches them to a GitHub Release whenever a `v*` tag is pushed:

```bash
git tag v0.1.0
git push origin v0.1.0
```

You can also trigger single-platform (`mac` or `win`) or full (`all`) builds manually from the **Actions** tab.

---

## License

MIT — see [LICENSE](./LICENSE).
