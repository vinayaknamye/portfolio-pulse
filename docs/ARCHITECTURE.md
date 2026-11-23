# Portfolio Pulse — Architecture & Engineering Reference

Deep technical reference for contributors and AI sessions. Start with [`AGENTS.md`](../AGENTS.md) for quick rules, commands, and critical pitfalls.

---

## 1. Runtime & Process Architecture

Portfolio Pulse is an Electron desktop app built with `electron-vite` (Vite 6 + React 19 + Tailwind CSS 3 + TypeScript 5.7):

```
┌────────────────────────────────────────────────────────────────────┐
│  Renderer Process (src/renderer/)                                  │
│  React 19 + Tailwind + Recharts                                    │
│  Communicates ONLY via contextBridge: window.portfolioPulse        │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Preload Bridge (src/preload/index.ts)
┌───────────────────────────────▼────────────────────────────────────┐
│  Main Process (src/main/)                                          │
│  ├─ IPC Handlers (src/main/ipc/handlers.ts)                        │
│  ├─ MCP Adapters (INDmoney & Upstox OAuth + Streamable HTTP MCP)   │
│  ├─ Engine (Reconciler, SyncOrchestrator, Auditor, CSV, Vault, PDF)│
│  ├─ BYOK AI (Claude, Gemini, OpenAI/Compatible, Ollama)            │
│  ├─ Persistence (sql.js WASM SQLite + Electron safeStorage)        │
│  └─ Tray & Daily Scheduler (21:30 local time + sleep catch-up)     │
└────────────────────────────────────────────────────────────────────┘
```

- **Security boundary:** `contextIsolation: true`, `nodeIntegration: false`. Every renderer-to-main call passes through typed IPC methods in `src/preload/index.ts` and `src/main/ipc/handlers.ts`.
- **State broadcast:** Main process pushes updated `AppStatePayload` snapshots to the renderer on mutations via `app:stateUpdated`.

---

## 2. Persistence Layer (`src/main/db/`)

### Local SQLite (`database.ts` + `repository.ts`)
- Uses `sql.js` (pure WASM SQLite, zero native `node-gyp` rebuild headaches across macOS arm64/x64 & Windows x64).
- Persists atomically (`*.tmp` -> `fs.renameSync`) to `<userData>/portfolio-pulse.sqlite`.
- Every mode-scoped table carries `is_demo INTEGER NOT NULL DEFAULT 0` so Demo Mode and Live Mode never mix.

| Table | Purpose |
|---|---|
| `app_meta` | Key-value JSON store (`user_profile`, `demo_mode`, etc.) |
| `broker_status` | Per-broker (`indmoney`, `upstox`) connection state, `last_sync_at`, `last_error` |
| `snapshots` | Daily historical `PortfolioSnapshot` JSON payloads (`payload_json`) indexed by `(is_demo, snapshot_date, fetched_at)` |
| `alerts` | Deterministic `AuditAlert` records linked to snapshots with dismissal state |
| `sip_baselines` | User-confirmed expected SIP mandates for drift/missing detection |
| `symbol_aliases` | Manual `indmoney_name -> upstox_symbol` links (used for both equities and bonds/NCDs) |
| `cost_basis_overrides` | Persisted manual & CSV average buy prices (`holding_key`, `symbol`, `isin`, `broker`, `average_price`, `csv_qty`, `csv_current_price`, `source`) |
| `insurance_policies` | Tracked insurance policies (`Term Life`, `Health`, `Endowment / Guaranteed`, `ULIP`, `Vehicle / Other`) |
| `insurance_documents` | Metadata linking policies to local files copied into `<userData>/vault/` (`policy` or `renewal` docs) |
| `ai_reports` | Archived AI Portfolio Reviews and Advisor Check second opinions |
| `ai_chat_messages` | Floating Q&A chat history |

### Encrypted Secrets (`secureStore.ts`)
- Uses Electron `safeStorage.encryptString` / `decryptString` backed by OS Keychain (macOS) or DPAPI (Windows).
- Stores broker OAuth tokens/client metadata and optional BYOK AI API keys in `<userData>/secure-store.json`.

### Local Document Vault (`src/main/engine/documentVault.ts`)
- Uploaded insurance policy PDFs and yearly renewal receipts are copied into `<userData>/vault/policy-<id>/...` so deleting the original Downloads file never breaks in-app previews.
- In-app preview (`DocumentViewerModal.tsx`) loads binary payloads over IPC (`insurance:readDocument`) and renders PDFs/images locally.

---

## 3. MCP Broker Integration (`src/main/mcp/`)

| Broker | Endpoint | Local OAuth Port | Tools Used |
|---|---|---|---|
| **INDmoney** | `https://mcp.indmoney.com/mcp` | `32135` | `networth_snapshot`, `networth_holdings` (`IND_STOCK`, `MF`, `BOND`, dynamic `FD` & `SA`), `mf_sips`, `indian_stocks_sips` |
| **Upstox** | `https://mcp.upstox.com/mcp` | `24807` | `get-holdings` / `get_holdings`, `get-funds-margin` / `get_funds_margin` / `get_user_fund_margin`, `get-mf-holdings`, `get-mf-sips`, `get-positions`, `get-order-book` |

### Key Resilience Mechanics
- **OAuth PKCE (`oauthProvider.ts`):** Uses `@modelcontextprotocol/sdk` `StreamableHTTPClientTransport` with a loopback HTTP callback server. Auto-invalidates stale tokens on `401` / `invalid_token` / expired responses during interactive auth.
- **MCP Error Detection:** `extractMcpToolError()` checks `result.isError` so Upstox expired sessions raise `ReauthRequiredError` instead of silently returning `holdings: []`.
- **Dynamic INDmoney Asset Type Discovery (`indmoneyAdapter.ts`):** Reads `networth_holdings`'s `inputSchema.properties.asset_type` enum to pick the exact FD/SA keys, with fallback to the `asset_type` returned by `networth_snapshot.investments`.
- **Partial Sync (`syncOrchestrator.ts`):** If INDmoney succeeds while Upstox needs re-auth (or returns suspiciously empty holdings when INDmoney still lists Upstox equities), the snapshot saves with `upstoxState: 'stale_reauth_required'`, carries forward real cost basis from up to 15 prior live snapshots (`repository.ts#getLastLiveUpstoxCostBasis`), and surfaces a 1-click reconnect banner/notification.

---

## 4. Portfolio Reconciliation & Audit Engines (`src/main/engine/`)

### Multi-Broker Reconciliation (`reconciler.ts`)
1. **Equity Matching Cascade (INDmoney <-> Upstox):**
   - Exact ISIN match -> User-defined `symbol_aliases` -> Exact normalized company name/symbol -> Abbreviation, subset-token & acronym matching (e.g., `Bharat Dynamics Ltd` <-> `BDL`, `Mahindra & Mahindra` <-> `M&M`, `Cholamandalam Investment & Finance` <-> `CHOLAFIN`) -> Unambiguous `(LTP, quantity)` fallback.
2. **Non-Equity Separation (`snapshot.bonds`):**
   - `isUpstoxNonEquityInstrument()` detects SGBs, Corporate NCDs, and G-Secs via ISIN prefixes (`IN00...`, debt series `INE...07/08...`), symbol patterns (`1075SCL34`, `SGB...`), and keywords.
   - Merges INDmoney `BOND` holdings, INDmoney stock-bucket SGBs/NCDs, and Upstox non-equity holdings into `snapshot.bonds`, deduplicating cross-broker NCDs automatically (`(bondType, qty, LTP)`) or via manual aliases.
3. **Cost-Basis Override Engine (`applyCostOverridesToSnapshot` + `csvCostParser.ts`):**
   - Supports **Paytm Money Web CSV**, **Zerodha Console/Kite**, **Groww**, **Upstox**, **Angel One**, **ICICI Direct**, and custom CSVs.
   - Two-pass matcher handles broker scoping, apostrophe/punctuation normalization, split-broker partial quantities (with inline `PARTIAL CSV` notes), renamed scrip `(LTP, qty)` matching, and SGB tranche LTP matching.
4. **Fixed Deposits & Emergency Cushion:**
   - Reconciles itemized FDs from `networth_holdings`, falling back to `networth_snapshot.investments` (`FD` / `FIXED_DEPOSIT` / `BANK_FD`) as an aggregate entry if itemized holdings aren't exposed.
   - Detects locked 5-year Tax-Saver / 80C / Non-Callable FDs (`isTaxSaver: true`, `countsTowardEmergency: false`).
   - Computes:
     - `emergencyCushionTotal = savingsAccountBalance + emergencyFdTotal + arbitrageTotal`
     - `liquidCorpusTotal = sum(mutualFunds where isLiquid)` (kept separate as STP / Near-Cash Pool).
5. **Multi-Broker SIP Deduplication:**
   - Merges INDmoney MF SIPs, INDmoney Stock SIPs, and active Upstox MF SIPs (filtering out `CANCELLED` / `COMPLETED` / `PAUSED` mandates) deduplicated by `(instrumentType, ISIN/name, amount, frequency)`.

### Deterministic Portfolio Auditor (`auditor.ts`)
Runs locally on every sync with zero LLM cost and generates categorized alerts (`auth`, `performance`, `margin`, `reconciliation`, `sip`, `cashflow`, `emergency`, `drawdown`, `concentration`):
- Upstox expiry notice, day-over-day Net Worth delta, idle broker margin check, multi-broker stock discrepancies/unmatched holdings, SIP baseline drift/missing mandates, Savings Account runway vs. upcoming SIP debit, Emergency Cushion gap vs. `profile.emergencyTarget`, equity drawdown watchlist (`<= drawdownThresholdPct`), single-stock concentration (`>= concentrationThresholdPct`), and Liquid MF STP deployment detection.

---

## 5. Insurance PDF Vault & Parsing (`documentVault.ts`, `policyParser.ts`)

- **Dual-Layer Parsing:**
  1. If a BYOK AI provider is configured, extracts structured JSON (`category`, `insurer`, `planName`, `sumAssured`, `annualPremium`, `renewalDate`, `paymentTerm`, `notes`) using `buildInsuranceExtractionPrompt()`.
  2. Falls back transparently (or when offline/no AI key) to deterministic Indian insurance regex/layout heuristics in `policyParser.ts` with a user-visible `notice` if AI failed.
- **Focused Page Extraction (`buildFocusedPdfText`):** Extracts per-page text with `unpdf`, scores pages for high-signal insurance keywords (Policy Schedule, Benefit Summary, Premium Receipt, CIS, Sum Insured, Renewal Date), and builds a focused 24K-char digest so 35–100p PDFs parse accurately without overflowing context limits.
- **Renewal Workflow:** Uploading a yearly renewal doc parses updated `renewalDate` and `annualPremium` and offers a 1-click update prompt on the policy card.

---

## 6. BYOK AI System (`src/main/ai/`)

- **Supported Providers (`providers.ts`):**
  - `claude` (Anthropic Messages API, native PDF + image blocks)
  - `gemini` (Google Generative Language API, native `inlineData` PDF + image)
  - `openai` (OpenAI / OpenRouter / Groq / LM Studio chat completions, image `image_url` + extracted PDF/text context)
  - `ollama` (Local `http://127.0.0.1:11434`, offline)
- **Live Model Discovery:** `listModels()` queries each provider's live model endpoint and falls back to curated presets in `AI_PROVIDER_PRESETS`.
- **Prompt Context (`promptBuilder.ts`):** `buildPortfolioContextBlock()` serializes net worth, allocations, Fixed Deposits & Emergency Cushion breakdown, top 25 direct equities, Bonds & SGBs, Mutual Funds, active SIPs, tracked Insurance Policies, deterministic alerts, and the user's `strategyMarkdown`.
- **Surfaces:**
  1. **Portfolio Health & Strategy Review** (`Insights → AI Reviews`)
  2. **Advisor Check — Second Opinion** (`Insights → Advisor Check`, supports attaching PDFs/images/CSVs/text pitches)
  3. **Floating Ask AI Chat** (`FloatingChat.tsx`, accessible from every tab)

---

## 7. Renderer Navigation & Pages (`src/renderer/`)

- **Dashboard (`Dashboard.tsx`):** KPI row (Net Worth + delta, Adjusted Unrealized Gain, clickable Emergency Cushion with `SA · FDs · Arb` breakdown, Monthly SIP Engine), Net Worth History area chart, Asset Allocation donut, Daily Audit Feed, and broker-agnostic Portfolio & Cost Health card.
- **Holdings (`Holdings.tsx`):** Sub-tabs:
  1. `Direct Equities` (search, size/cost/loss/external filters, inline Avg Cost editing, CSV import banner)
  2. `Bonds & SGBs` (SGBs, NCDs, G-Secs, Bonds with inline Avg Cost editing)
  3. `Mutual Funds` (broker badges + Equity / Emergency Arb / Liquid STP role badges)
  4. `Emergency & FDs` (Emergency Cushion target progress bar, 4 liquidity summary cards, Fixed Deposits table with Emergency Eligible vs. Tax-Saver/Locked badges, Bank Cash + Arbitrage + Liquid MF stack)
  5. `Reconciliation` (variance metrics, 1-click symbol alias linker, saved manual & CSV overrides)
- **SIPs (`SipsAndAudit.tsx`):** Active multi-broker SIPs, weekly/monthly outflow, Savings Account cash runway, and editable SIP Baseline expectations.
- **Insights & Alerts (`Insights.tsx`):** Sub-tabs: `Audit Alerts`, `Past AI Reviews`, and `Advisor Check` (with file attachments).
- **Strategy & Cover (`Strategy.tsx`):** Investor profile & numeric audit thresholds, preview-by-default Strategy Markdown editor with 4 Indian investor templates, and Insurance Policies & Document Vault with in-app `DocumentViewerModal`.
- **Settings (`Settings.tsx`):** Broker OAuth connections, Demo Mode toggle, Daily Sync schedule & OS notifications, BYOK AI provider setup + API key guides + live model refresh, Markdown+JSON bundle export, and Wipe Local Data.

---

## 8. IPC Surface (`src/preload/index.ts` <-> `src/main/ipc/handlers.ts`)

- **App & Profile:** `app:getState`, `app:setDemoMode`, `profile:save`, `app:wipeAllData`, `app:openExternal`
- **Brokers & Sync:** `broker:connect`, `broker:disconnect`, `sync:run`, `alert:dismiss`, `notification:test`
- **SIPs, Aliases & Cost Overrides:** `sip:saveBaselines`, `sip:resetBaselinesFromLive`, `alias:save`, `alias:delete`, `costOverride:save`, `costOverride:delete`, `costOverride:importCsv`
- **Insurance Vault:** `insurance:save`, `insurance:delete`, `insurance:pickAndParseDoc`, `insurance:uploadDocument`, `insurance:readDocument`, `insurance:openDocumentExternal`, `insurance:deleteDocument`
- **AI & Export:** `advisor:pickAttachments`, `ai:saveApiKey`, `ai:clearApiKey`, `ai:listModels`, `ai:generateReport`, `ai:validateAdvisorInput`, `ai:sendChat`, `ai:clearChat`, `export:bundle`

---

## 9. Release History

- **`v0.1.0`:** Initial local-first Electron MVP — INDmoney + Upstox MCP OAuth, SQLite daily snapshots, multi-broker reconciliation, CSV avg-cost import, deterministic audit & tray scheduler, BYOK AI Reviews & Floating Q&A Chat, Demo Mode, and GitHub Actions macOS/Windows release workflow.
- **`v0.2.0` (PR #1):** Broker-agnostic Dashboard health card, dedicated Bonds & SGBs tab, Paytm Money Web CSV + LTP/Qty matching, human-readable scrip names in alerts, separated SIPs vs. Insights & Alerts, Strategy preview-by-default + 4 templates, Insurance Policies tracker, Advisor Check AI validator, and API key setup guides.
- **`v0.3.0` (PR #2):** Advisor Check multimodal file attachments (PDF/images/CSV/text), local Insurance Document Vault with dual-layer AI + `unpdf` auto-parsing, in-app `DocumentViewerModal`, yearly renewal docs with 1-click renewal updates, and Node 26 LTS upgrade (`.nvmrc`).
- **`v0.3.1` (PR #3):** INDmoney Fixed Deposit & Savings Account fetching with `Holdings → Emergency & FDs` tab and callable-FD inclusion in Emergency Cushion (excluding locked 80C Tax-Saver FDs); cross-broker NCD deduplication & SGB tranche LTP CSV matching; Upstox avg-price & MCP error resilience across unsigned updates; focused multi-page PDF page selection & upgraded Indian insurance heuristics.
