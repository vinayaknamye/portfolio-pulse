# Portfolio Pulse

A **local-first, open-source Electron desktop app** for Indian retail investors that connects directly to **INDmoney MCP** and **Upstox MCP** via OAuth, tracks daily portfolio snapshots in local SQLite, runs deterministic multi-broker reconciliation & SIP/cashflow audits with native OS notifications, and offers optional **BYOK AI Portfolio Reviews & Floating Q&A Chat** (Anthropic Claude, Google Gemini, OpenAI/compatible, offline Ollama, or Local AI CLI terminal sessions).

> **Disclaimer:** Portfolio Pulse is a local analytics, reconciliation, and rule-based audit tool. It is **not** a SEBI-registered Investment Adviser (IA). Deterministic alerts and optional BYOK AI outputs are for informational and educational purposes only.

---

## Key Features

- **100% Local-First Privacy:** Zero backend servers, zero telemetry. Broker OAuth tokens and optional AI API keys are encrypted locally via Electron `safeStorage` (macOS Keychain / Windows DPAPI). Historical snapshots live in a local SQLite database on your machine.
- **Flexible Multi-Broker Support (INDmoney, Upstox, or Both):**
  - **INDmoney MCP (Multi-Asset Aggregator):** Real Estate, Mutual Funds, Fixed Deposits (FDs), PPF/EPF, Gold, Bonds/SGBs, Savings Accounts, active MF & Stock SIPs, and aggregated holdings across external brokers (Paytm Money, Zerodha, Groww, etc.).
  - **Upstox MCP (Demat Stocks, MFs, SIPs & Margin):** Live demat equity average buy prices, accurate unrealized P&L, Upstox MF holdings & active MF SIPs, idle trading margin, and automatic ISIN-based non-equity bond/NCD separation.
  - **Works Standalone or Combined:** Connect INDmoney only, Upstox only, or both together. *(Tip: For the most complete net-worth view across all asset classes and external brokers, link/record all assets inside INDmoney first.)*
  - **Resilient Partial Sync:** If Upstox's OAuth session expires during a background daily refresh, INDmoney still syncs cleanly while carrying forward your last known Upstox cost basis and firing a 1-click OS notification to reconnect.
- **Dedicated Direct Equities, Bonds & SGBs, Mutual Funds, and Emergency & FDs Views:**
  - Automatically separates Sovereign Gold Bonds (SGBs), Corporate NCDs, G-Secs, and Bonds into a dedicated **Bonds & SGBs** tab with cross-broker NCD deduplication, inline Avg Cost editing, and CSV support.
  - Dedicated **Emergency & FDs** view tracks all emergency-linked assets (**Savings Accounts**, **Callable Fixed Deposits**, and **Arbitrage Mutual Funds**) against your Emergency Cushion target — while keeping locked 5-year Tax-Saver FDs and Liquid/STP deployment pools clearly separated.
  - Zero-config NSE/BSE matching (ISIN → user alias → abbreviation, subset-token & acronym matching → unambiguous LTP + quantity fallback) + 1-click symbol alias mapper.
  - **Manual Avg Cost Editing & Smart Multi-Broker CSV Import:** Click any **Avg Cost** cell to edit inline, or import holdings CSVs from **Paytm Money Web (`Holdings → Download CSV`), Zerodha Console/Kite, Groww, Upstox, Angel One, ICICI Direct**, or any custom CSV — with automatic broker detection, split-broker partial-quantity notices, unmatched row diagnostics, and persistence across future daily syncs.
- **Separate SIPs & Insights/Alerts Architecture:**
  - Dedicated **SIPs** view merges and deduplicates active SIPs across INDmoney and Upstox (with a clean lump-sum empty state if you don't run SIPs).
  - **Insights & Alerts** combines filterable daily deterministic Audit Alerts, archived **Past AI Reviews**, and an **Advisor Check (Second Opinion)** tool where you can paste pitches **and attach supporting PDFs, brochures, quotes, or screenshots** for AI validation against your live portfolio & policies.
- **Daily Refresh & Native Desktop Notifications:**
  - Menu-bar / system tray resident scheduler (default **21:30 local time**, after NSE close and AMFI NAV publishing) with wake-from-sleep catch-up.
- **Strategy Templates, Insurance Document Vault & BYOK AI:**
  - Preview-by-default Markdown **Strategy & Goals** with built-in Indian investor **Strategy Templates** plus a local **Insurance Policies & Document Vault** (Term Life, Health, Endowment, ULIP, Vehicle/Other) — upload policy PDFs/images to **auto-parse details** (via AI or offline Indian insurance heuristics), **preview PDFs/images right inside the app**, and archive yearly **renewal receipts** with 1-click renewal date/premium updates.
  - Configure **Anthropic Claude**, **Google Gemini**, **OpenAI / OpenAI-compatible**, **Local Ollama**, or **Local AI CLI (Terminal Session)** (`agy`, `gemini`, `codex`, `claude`) under **Settings → AI Insights Configuration** with step-by-step setup guides, auto-detected local CLIs, and automatic **live model discovery**.
  - Open the **floating Ask AI Q&A chat** from any screen in the app.
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

Requires Node.js 26 LTS (see [.nvmrc](./.nvmrc)).

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
