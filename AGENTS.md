# AGENTS.md — Portfolio Pulse AI & Contributor Guide

This file provides essential engineering context, architecture invariants, commands, and hard-won pitfalls for AI coding agents and contributors working in **Portfolio Pulse**.

For deep module-by-module internals, SQLite schema, IPC surface, reconciliation pipeline, and release history, see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 1. Project Overview

**Portfolio Pulse** is a **100% local-first, open-source Electron + React + TypeScript desktop app** for Indian retail investors.
- **Data Sources:** Direct OAuth connections to **INDmoney MCP** (`https://mcp.indmoney.com/mcp`) and **Upstox MCP** (`https://mcp.upstox.com/mcp`) — works with INDmoney only, Upstox only, or both combined.
- **Storage:** Local SQLite via `sql.js` (WASM) in Electron `userData`, encrypted OAuth tokens & optional AI API keys via Electron `safeStorage` (macOS Keychain / Windows DPAPI), and local Insurance Document Vault under `<userData>/vault/`.
- **Core Features:** Multi-broker equity/bond/MF/SIP/FD reconciliation, manual & multi-broker CSV average-cost overrides, deterministic daily portfolio audit & OS notifications, Emergency Cushion & FD tracking, Strategy & Goals Markdown + Insurance Document Vault (dual-layer AI + offline PDF/image parsing & in-app preview), and optional BYOK AI Reviews, Floating Q&A Chat, and Advisor Check with multimodal file attachments (Claude, Gemini, OpenAI-compatible, or offline Ollama).

---

## 2. Non-Negotiable Rules & Invariants

1. **Zero Personal Data in Repo:** This is a public open-source repository. **Never** commit real investor names, real brokerage CSVs, policy numbers, insurance PDFs, OAuth tokens, API keys, local user paths, or real portfolio JSON. All unit tests (`tests/`) and Demo Mode (`src/main/demo/demoDataset.ts`) must remain 100% synthetic/anonymized.
2. **Strict Backwards Compatibility:**
   - All SQLite schema changes in `src/main/db/database.ts` must be **additive** (`CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` + `ALTER TABLE ADD COLUMN`).
   - All new fields on `PortfolioSnapshot` (`src/shared/types.ts`) must be **optional** (`?`), and renderer pages (`Dashboard.tsx`, `Holdings.tsx`, etc.) must gracefully render cached snapshots from older app versions before the user's next `Sync Now`.
3. **100% Local-First & Non-Advisory:**
   - Never add telemetry, remote analytics, or cloud sync backends.
   - Always preserve the non-advisory disclaimer (`NON_ADVISORY_DISCLAIMER` in `src/shared/constants.ts`) in AI prompts, exports, and UI—never present outputs as SEBI/IRDAI-regulated advice.
4. **Node Version:** Pin & test against **Node 26 LTS** (see `.nvmrc`, `"engines": { "node": ">=22.0.0" }`, and `.github/workflows/release.yml`).
5. **Path Aliases:** Use `@shared/*`, `@main/*`, and `@renderer/*` (configured in `tsconfig.json`, `electron.vite.config.ts`, and `vitest.config.ts`).

---

## 3. Commands & Local Development

```bash
npm install          # Install dependencies (Node 26 LTS recommended)
npm run dev          # Launch Electron + Vite dev app with hot reload
npm run typecheck    # Strict TypeScript check (tsc --noEmit)
npm run test         # Run Vitest unit & SQLite integration tests
npm run build        # Build production main, preload, and renderer bundles into out/
npm run pack:mac     # Build unsigned macOS .dmg installers (arm64 + x64) into dist/
npm run pack:win     # Build unsigned Windows .exe installer (x64) into dist/
```

- **Dev vs. Packaged Data Isolation:** `npm run dev` writes `userData` to `portfolio-pulse` (`package.json` `name`), whereas packaged installers use `Portfolio Pulse` (`electron-builder.yml` `productName`). Testing in dev mode does not disturb an installed production app's SQLite DB or Keychain entries.
- **Always run** `npm run typecheck && npm run test && npm run build` before committing changes.

---

## 4. Repository Map

| Path | Purpose |
|---|---|
| `src/shared/types.ts` | Canonical TypeScript models across main, preload, and renderer |
| `src/shared/constants.ts` | MCP endpoints, OAuth callback ports, default profile, AI presets, strategy templates |
| `src/main/index.ts` | Electron bootstrap, tray icon, BrowserWindow lifecycle, scheduler init |
| `src/main/db/` | `database.ts` (`sql.js` WASM + migrations), `repository.ts` (all queries), `secureStore.ts` (`safeStorage`) |
| `src/main/mcp/` | `oauthProvider.ts` (PKCE OAuth + MCP error helpers), `indmoneyAdapter.ts`, `upstoxAdapter.ts` |
| `src/main/engine/` | `reconciler.ts`, `syncOrchestrator.ts`, `auditor.ts`, `csvCostParser.ts`, `documentVault.ts`, `policyParser.ts`, `exporter.ts`, `scheduler.ts` |
| `src/main/ai/` | `providers.ts` (Claude/Gemini/OpenAI/Ollama + multimodal + model discovery), `promptBuilder.ts` |
| `src/main/ipc/handlers.ts` | All Electron IPC handlers wired to `src/preload/index.ts` |
| `src/main/demo/demoDataset.ts` | Synthetic 14-day Demo Mode portfolio seeder |
| `src/renderer/App.tsx` | App shell, sidebar navigation, sync & broker banners, toast notifications |
| `src/renderer/pages/` | `Onboarding`, `Dashboard`, `Holdings`, `SipsAndAudit`, `Insights`, `Strategy`, `Settings` |
| `src/renderer/components/` | `FloatingChat`, `MarkdownView`, `DocumentViewerModal` |
| `tests/` | Vitest suite (`reconciler`, `auditor`, `csvCostParser`, `policyParser`, `aiProviders`, `repository`) |
| `.github/workflows/release.yml` | CI verify (Linux) -> build macOS & Windows -> publish GitHub Release on `v*` tags |

---

## 5. Critical Domain Pitfalls & Invariants (Read Before Editing!)

### A. Upstox OAuth & Average-Cost Protection
- Unsigned macOS `.app` updates can invalidate `safeStorage`/session state or return expired Upstox tokens.
- **Never** treat an MCP tool error (`isError: true`) as an empty portfolio! `oauthProvider.ts` exposes `extractMcpToolError()`, and `upstoxAdapter.ts` must throw `ReauthRequiredError` on tool errors rather than returning `holdings: []`.
- `syncOrchestrator.ts` guards against empty Upstox responses wiping prior average buy prices whenever INDmoney still shows Upstox equities, and `repository.ts#getLastLiveUpstoxCostBasis()` scans up to **15 recent live snapshots** to recover real `upstox_live` cost basis.
- Explicit interactive `broker:connect` clears stale stored tokens first so OAuth starts cleanly.

### B. Multi-Broker Reconciliation, Bonds/SGBs & CSV Matching (`reconciler.ts`, `csvCostParser.ts`)
- INDmoney often reports market value as `invested_amount` for external-broker equities (`Paytm Money`, `Zerodha`, `Groww`, etc.). Cost basis priority is: **Upstox live > Manual override > CSV import > INDmoney native > Upstox carried forward > Market value proxy**.
- Upstox mixes corporate NCDs, SGBs, and G-Secs inside demat holdings — `isUpstoxNonEquityInstrument()` routes them into `snapshot.bonds`.
- Cross-broker NCD deduplication merges INDmoney + Upstox NCDs automatically (matching ISIN, manual `aliasMap`, or `(bondType, quantity, LTP)` proximity) so an NCD never appears twice in **Bonds & SGBs**.
- SGB CSV rows often use different naming conventions (`2.5% SGB 27-Jun-2031` vs. `Sovereign Gold Bond Scheme 2023-24 - Series I`) — matched via SGB tranche LTP proximity.

### C. INDmoney Fixed Deposits & Emergency Cushion Formula
- `indmoneyAdapter.ts` inspects `networth_holdings`'s `inputSchema` dynamically for FD and SA `asset_type` enums and falls back to the exact key in `networth_snapshot.investments` if needed. If itemized FD holdings are empty while `networth_snapshot` contains an FD allocation, `reconciler.ts` synthesizes an aggregate FD entry (`source: 'indmoney_aggregate'`).
- **Emergency Cushion formula:** `emergencyCushionTotal = savingsAccountBalance + emergencyFdTotal + arbitrageTotal`.
- Standard/callable FDs count (`countsTowardEmergency: true`); **5-year Tax-Saver / 80C / non-callable / locked FDs** are flagged (`isTaxSaver: true`, `countsTowardEmergency: false`) and excluded from emergency liquidity.
- **Liquid / Overnight MFs** (`liquidCorpusTotal`) are displayed alongside in **Holdings → Emergency & FDs** as an **STP / Near-Cash Pool**, separate from the core Emergency Cushion so equity deployment capital isn't double-counted.

### D. Insurance Document Vault & Large Indian Policy PDFs (`documentVault.ts`, `policyParser.ts`)
- Real Indian insurance policy PDFs are commonly 35–100+ pages (1–2 MB), which overflow LLM token/page limits if sent raw.
- `buildFocusedPdfText()` extracts text via `unpdf` and scores pages to select high-signal sections (Cover, Policy Schedule, Premium Receipt, CIS) within a 24K-char budget.
- `shouldAttachBinaryToLLM` attaches raw PDF bytes **only** for scanned PDFs (no extractable text) or compact PDFs (`<= 8 pages` and `<= 1.5 MB`); large text-selectable PDFs pass focused extracted text instead.
- Offline heuristics in `policyParser.ts` specifically handle Indian insurer quirks: British spelling (`Annualised`), HDFC Life's `Rupee_Foradian` backtick `` ` `` rupee glyph, stacked schedule tables, `Unlimited Base Sum Insured`, and multi-year health policy premium annualization.

### E. Packaging (`sql.js` WASM & Unsigned Builds)
- `electron-builder.yml` unpacks `node_modules/sql.js/dist/sql-wasm.wasm` via `asarUnpack`; `database.ts#resolveWasmPath()` checks `app.asar.unpacked` first. Keep this intact when touching build config.

---

## 6. Release & Git Workflow

1. Create a feature/fix branch from `main` (e.g., `feat/...` or `fix/...`).
2. Bump version in **both** `package.json` and `package-lock.json` (root + `packages[""]`).
3. Verify locally with `npm run typecheck && npm run test && npm run build` (and `npm run dev` for UI/live MCP validation).
4. Push branch, open PR against `main`, and merge.
5. On updated `main`, create and push an annotated tag (`git tag -a vX.Y.Z -m "Release vX.Y.Z" && git push origin vX.Y.Z`) to trigger `.github/workflows/release.yml` (Linux verify -> macOS arm64+x64 `.dmg` + Windows x64 `.exe` -> GitHub Release).
