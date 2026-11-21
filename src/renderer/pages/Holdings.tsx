import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Link2, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { AppStatePayload, ReconciledEquity, SymbolAlias } from '@shared/types';
import { formatInrCompact, formatInrFull, formatSignedPct } from '../lib/format';

interface HoldingsProps {
  state: AppStatePayload;
  onSaveAlias: (alias: SymbolAlias) => Promise<void>;
  onDeleteAlias: (indmoneyName: string) => Promise<void>;
  onSaveCostOverride: (payload: {
    holdingKey: string;
    displayName: string;
    symbol?: string;
    isin?: string;
    broker?: string;
    averagePrice: number;
  }) => Promise<void>;
  onDeleteCostOverride: (holdingKey: string) => Promise<void>;
  onImportCostCsv: () => Promise<void>;
}

export const Holdings: React.FC<HoldingsProps> = ({
  state,
  onSaveAlias,
  onDeleteAlias,
  onSaveCostOverride,
  onDeleteCostOverride,
  onImportCostCsv
}) => {
  const snap = state.latestSnapshot;
  const [subTab, setSubTab] = useState<'equities' | 'mf' | 'reconcile'>('equities');
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState<'all' | 'anchors' | 'growth' | 'small' | 'external' | 'bonds'>('all');
  const [aliasIndName, setAliasIndName] = useState('');
  const [aliasUpSym, setAliasUpSym] = useState('');

  // Inline avg-cost edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPriceInput, setEditPriceInput] = useState('');

  const filteredEquities = useMemo(() => {
    if (!snap) return [];
    return snap.equities.filter((e) => {
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !e.name.toLowerCase().includes(q) &&
          !e.symbol.toLowerCase().includes(q) &&
          !e.broker.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      if (tier === 'bonds') return e.isNonEquity;
      if (e.isNonEquity && tier !== 'all') return false;
      if (tier === 'external') return e.isExternalBroker;
      if (tier === 'anchors') return !e.isExternalBroker && e.currentValue >= 100000;
      if (tier === 'growth') return !e.isExternalBroker && e.currentValue >= 25000 && e.currentValue < 100000;
      if (tier === 'small') return !e.isExternalBroker && e.currentValue < 25000;
      return true;
    });
  }, [snap, search, tier]);

  if (!snap) return null;

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aliasIndName.trim() || !aliasUpSym.trim()) return;
    await onSaveAlias({ indmoneyName: aliasIndName.trim(), upstoxSymbol: aliasUpSym.trim().toUpperCase() });
    setAliasIndName('');
    setAliasUpSym('');
  };

  const startEditAvg = (eq: ReconciledEquity) => {
    setEditingId(eq.id);
    setEditPriceInput(eq.averagePrice !== null ? String(eq.averagePrice) : '');
  };

  const commitEditAvg = async (eq: ReconciledEquity) => {
    const num = Number(editPriceInput);
    if (!Number.isFinite(num) || num <= 0) {
      setEditingId(null);
      return;
    }
    await onSaveCostOverride({
      holdingKey: `id:${eq.id.toLowerCase()}`,
      displayName: eq.name,
      symbol: eq.symbol,
      isin: eq.isin || undefined,
      broker: eq.broker,
      averagePrice: num
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-surface-900">
          {(
            [
              ['equities', `Direct Holdings (${snap.equities.length})`],
              ['mf', `Mutual Funds (${snap.mutualFunds.length})`],
              [
                'reconcile',
                `Reconciliation${
                  snap.reconciliation.unmatchedIndmoney.length + snap.reconciliation.discrepancies.length > 0
                    ? ` (${snap.reconciliation.unmatchedIndmoney.length + snap.reconciliation.discrepancies.length})`
                    : ''
                }`
              ]
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSubTab(id)}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
                subTab === id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {subTab === 'equities' && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onImportCostCsv()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-surface-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="Import holdings CSV from Paytm Money, Zerodha, Groww, Upstox, Angel One, or custom CSV to fill missing Avg Costs"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-500" />
              Import Avg Cost CSV
            </button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search symbol or name..."
                className="rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-surface-900 dark:text-white"
              />
            </div>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value as typeof tier)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-surface-900 dark:text-slate-200"
            >
              <option value="all">All Holdings</option>
              <option value="anchors">Anchors (&ge; ₹1L)</option>
              <option value="growth">Growth (₹25K–₹1L)</option>
              <option value="small">Small (&lt; ₹25K)</option>
              <option value="external">External Brokers</option>
              <option value="bonds">Bonds / NCDs</option>
            </select>
          </div>
        )}
      </div>

      {/* Direct Equities Table */}
      {subTab === 'equities' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            <span>
              Tip: Click any <strong>Avg Cost</strong> value (or <code>—</code>) to enter it manually, or click{' '}
              <strong>Import Avg Cost CSV</strong> to bulk-import from Paytm Money, Zerodha, Groww, or any broker CSV.
            </span>
            {state.costOverrides.length > 0 && (
              <span className="shrink-0 font-medium text-emerald-600 dark:text-emerald-400">
                {state.costOverrides.length} saved override{state.costOverrides.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Instrument</th>
                  <th className="px-3 py-3 font-medium">Broker</th>
                  <th className="px-3 py-3 text-right font-medium">Qty</th>
                  <th className="px-3 py-3 text-right font-medium">Avg Cost</th>
                  <th className="px-3 py-3 text-right font-medium">LTP</th>
                  <th className="px-3 py-3 text-right font-medium">Value</th>
                  <th className="px-3 py-3 text-right font-medium">P&amp;L</th>
                  <th className="px-4 py-3 text-right font-medium">1D %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                {filteredEquities.map((e) => (
                  <tr key={e.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900 dark:text-white">{e.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {e.symbol && !/^INDS\d+$/i.test(e.symbol) && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{e.symbol}</span>
                        )}
                        {e.isNonEquity && (
                          <span className="rounded bg-pink-500/15 px-1.5 py-0.5 text-[10px] font-medium text-pink-500">
                            DEBT/NCD
                          </span>
                        )}
                        {e.costBasisSource === 'upstox_carried_forward' && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
                            CACHED BASIS
                          </span>
                        )}
                        {e.costBasisSource === 'manual_override' && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                            MANUAL
                          </span>
                        )}
                        {e.costBasisSource === 'csv_import' && (
                          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                            CSV
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          e.isExternalBroker
                            ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {e.broker}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-300">{e.quantity}</td>
                    <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400">
                      {editingId === e.id ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="0.01"
                            autoFocus
                            value={editPriceInput}
                            onChange={(ev) => setEditPriceInput(ev.target.value)}
                            onKeyDown={(ev) => {
                              if (ev.key === 'Enter') void commitEditAvg(e);
                              if (ev.key === 'Escape') setEditingId(null);
                            }}
                            placeholder="Avg ₹"
                            className="w-20 rounded-md border border-emerald-500 bg-white px-1.5 py-0.5 text-right text-xs text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-white"
                          />
                          <button
                            onClick={() => void commitEditAvg(e)}
                            className="rounded p-0.5 text-emerald-500 hover:bg-emerald-500/10"
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="rounded p-0.5 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditAvg(e)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-700/70"
                          title="Edit average buy price"
                        >
                          <span>{e.averagePrice !== null ? formatInrFull(e.averagePrice, 2) : '—'}</span>
                          <Pencil className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-70" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                      {formatInrFull(e.lastPrice, 2)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                      {formatInrCompact(e.currentValue)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {e.costBasisSource === 'market_value_proxy' ? (
                        <span className="text-slate-400">N/A</span>
                      ) : (
                        <span className={e.pnl >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                          {formatSignedPct(e.pnlPct, 1)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={e.dayChangePct >= 0 ? 'text-emerald-500' : 'text-rose-500'}>
                        {formatSignedPct(e.dayChangePct, 2)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mutual Funds Table */}
      {subTab === 'mf' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Fund Name</th>
                  <th className="px-3 py-3 font-medium">Broker</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 text-right font-medium">Units</th>
                  <th className="px-3 py-3 text-right font-medium">NAV</th>
                  <th className="px-3 py-3 text-right font-medium">Invested</th>
                  <th className="px-3 py-3 text-right font-medium">Current</th>
                  <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                {snap.mutualFunds.map((m) => (
                  <tr key={`${m.broker}-${m.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{m.name}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          (m.broker || 'INDmoney') === 'Upstox'
                            ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {m.broker || 'INDmoney'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          m.isLiquid
                            ? 'bg-cyan-500/15 text-cyan-500'
                            : m.isArbitrage
                            ? 'bg-amber-500/15 text-amber-500'
                            : 'bg-emerald-500/15 text-emerald-500'
                        }`}
                      >
                        {m.isLiquid ? 'Liquid / STP' : m.isArbitrage ? 'Emergency / Arb' : 'Equity'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400">{m.units.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-300">
                      {formatInrFull(m.nav, 2)}
                    </td>
                    <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400">
                      {formatInrCompact(m.investedValue)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                      {formatInrCompact(m.currentValue)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={m.pnl >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                        {formatInrCompact(m.pnl)} ({formatSignedPct(m.pnlPct, 1)})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Reconciliation, Alias Resolver & Saved Cost Overrides */}
      {subTab === 'reconcile' && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">INDmoney Stocks Total</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrCompact(snap.reconciliation.indmoneyStockTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">Upstox Equities Total</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrCompact(snap.reconciliation.upstoxEquityTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">External Brokers Total</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrCompact(snap.reconciliation.externalStockTotal)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">Aggregate Variance</div>
              <div
                className={`mt-1 text-lg font-bold tabular-nums ${
                  Math.abs(snap.reconciliation.aggregateDiff) < 10 ? 'text-emerald-500' : 'text-amber-500'
                }`}
              >
                {formatInrFull(snap.reconciliation.aggregateDiff, 2)}
              </div>
            </div>
          </div>

          {snap.reconciliation.discrepancies.length === 0 &&
          snap.reconciliation.unmatchedIndmoney.length === 0 &&
          snap.reconciliation.unmatchedUpstox.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All direct holdings are cleanly reconciled!
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {snap.reconciliation.unmatchedIndmoney.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <h3 className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Unmatched INDmoney Holdings ({snap.reconciliation.unmatchedIndmoney.length})
                  </h3>
                  <div className="mt-2 space-y-1.5 text-xs">
                    {snap.reconciliation.unmatchedIndmoney.map((u) => (
                      <button
                        key={u.name}
                        onClick={() => setAliasIndName(u.name)}
                        className="flex w-full items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-left hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-800"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">{u.name}</span>
                        <span className="tabular-nums text-slate-500">
                          {u.quantity} @ ₹{u.unitPrice}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {snap.reconciliation.unmatchedUpstox.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                  <h3 className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                    Unmatched Upstox Equities ({snap.reconciliation.unmatchedUpstox.length})
                  </h3>
                  <div className="mt-2 space-y-1.5 text-xs">
                    {snap.reconciliation.unmatchedUpstox.map((u) => (
                      <button
                        key={u.symbol}
                        onClick={() => setAliasUpSym(u.symbol || '')}
                        className="flex w-full items-center justify-between rounded-lg bg-white/70 px-3 py-2 text-left hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-800"
                      >
                        <span className="font-medium text-slate-900 dark:text-white">
                          {u.symbol} ({u.name})
                        </span>
                        <span className="tabular-nums text-slate-500">
                          {u.quantity} @ ₹{u.unitPrice}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Saved Manual & CSV Cost Basis Overrides */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Manual &amp; CSV Avg Cost Overrides ({state.costOverrides.length})
                </h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Persisted across future daily syncs for external brokers (Paytm Money, Zerodha, Groww, etc.) where MCP doesn&apos;t return buy price.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onImportCostCsv()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <Upload className="h-3.5 w-3.5" /> Import Broker CSV
              </button>
            </div>

            {state.costOverrides.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {state.costOverrides.map((ov) => (
                  <div
                    key={ov.holdingKey}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{ov.displayName}</span>
                      {ov.symbol && (
                        <code className="font-mono text-[11px] text-slate-500">{ov.symbol}</code>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                          ov.source === 'csv_import'
                            ? 'bg-blue-500/15 text-blue-500'
                            : 'bg-emerald-500/15 text-emerald-500'
                        }`}
                      >
                        {ov.source === 'csv_import' ? 'CSV' : 'MANUAL'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {formatInrFull(ov.averagePrice, 2)}
                      </span>
                      <button
                        onClick={() => void onDeleteCostOverride(ov.holdingKey)}
                        className="text-slate-400 hover:text-rose-500"
                        title="Remove override (re-sync to restore broker value)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom Symbol Alias Mapper */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Symbol Alias Overrides</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              If INDmoney and Upstox name a security differently, link them once here and future syncs will match automatically.
            </p>
            <form onSubmit={handleLinkSubmit} className="mt-4 flex flex-wrap gap-2">
              <input
                value={aliasIndName}
                onChange={(e) => setAliasIndName(e.target.value)}
                placeholder="INDmoney exact holding name (e.g. Jio Platforms Ltd)"
                className="min-w-[240px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <input
                value={aliasUpSym}
                onChange={(e) => setAliasUpSym(e.target.value)}
                placeholder="Upstox symbol (e.g. JPL)"
                className="w-44 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs uppercase text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
              >
                <Link2 className="h-3.5 w-3.5" /> Save Alias
              </button>
            </form>

            {state.aliases.length > 0 && (
              <div className="mt-4 space-y-1.5">
                {state.aliases.map((a) => (
                  <div
                    key={a.indmoneyName}
                    className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"
                  >
                    <span>
                      <strong className="text-slate-800 dark:text-slate-200">{a.indmoneyName}</strong> →{' '}
                      <code className="font-mono text-emerald-600 dark:text-emerald-400">{a.upstoxSymbol}</code>
                    </span>
                    <button
                      onClick={() => void onDeleteAlias(a.indmoneyName)}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
