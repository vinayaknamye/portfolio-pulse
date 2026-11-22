import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Landmark,
  Link2,
  Lock,
  Pencil,
  Search,
  Shield,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import {
  AppStatePayload,
  CsvImportResult,
  ReconciledBond,
  ReconciledEquity,
  ReconciledFixedDeposit,
  ReconciledSavingsAccount,
  SymbolAlias
} from '@shared/types';
import { formatInrCompact, formatInrFull, formatSignedPct } from '../lib/format';

export type HoldingsSubTab = 'equities' | 'bonds' | 'mf' | 'emergency' | 'reconcile';

interface HoldingsProps {
  state: AppStatePayload;
  subTab?: HoldingsSubTab;
  onSubTabChange?: (tab: HoldingsSubTab) => void;
  lastCsvImport: CsvImportResult | null;
  onDismissCsvImport: () => void;
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

type EquityFilter = 'all' | 'core' | 'mid' | 'small' | 'missing_cost' | 'in_loss' | 'external';

function isInternalCode(symbol: string): boolean {
  return !symbol || /^INDS\d+$/i.test(symbol) || /^DEMO_[A-Z0-9]+$/i.test(symbol) || /^[A-Z]{2}[A-Z0-9]{10}$/i.test(symbol);
}

export const Holdings: React.FC<HoldingsProps> = ({
  state,
  subTab: controlledSubTab,
  onSubTabChange,
  lastCsvImport,
  onDismissCsvImport,
  onSaveAlias,
  onDeleteAlias,
  onSaveCostOverride,
  onDeleteCostOverride,
  onImportCostCsv
}) => {
  const snap = state.latestSnapshot;
  const [internalSubTab, setInternalSubTab] = useState<HoldingsSubTab>('equities');
  const subTab = controlledSubTab ?? internalSubTab;
  const setSubTab = (next: HoldingsSubTab) => {
    setInternalSubTab(next);
    onSubTabChange?.(next);
  };
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<EquityFilter>('all');
  const [aliasIndName, setAliasIndName] = useState('');
  const [aliasUpSym, setAliasUpSym] = useState('');

  // Inline avg-cost edit state (shared cleanly across equities & bonds)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPriceInput, setEditPriceInput] = useState('');

  const directEquities = useMemo(() => {
    if (!snap) return [];
    return snap.equities.filter((e) => !e.isNonEquity);
  }, [snap]);

  // Graceful fallback for cached v0.1.0 snapshots before user re-syncs
  const bondsList: ReconciledBond[] = useMemo(() => {
    if (!snap) return [];
    if (snap.bonds && snap.bonds.length > 0) return snap.bonds;
    return snap.equities
      .filter((e) => e.isNonEquity)
      .map((e) => ({
        id: e.id,
        name: e.name,
        symbol: e.symbol,
        isin: e.isin,
        bondType: /\bSGB\b/i.test(e.name) ? 'SGB' : 'NCD',
        broker: e.broker,
        quantity: e.quantity,
        averagePrice: e.averagePrice,
        lastPrice: e.lastPrice,
        investedValue: e.investedValue,
        currentValue: e.currentValue,
        pnl: e.pnl,
        pnlPct: e.pnlPct,
        costBasisSource:
          e.costBasisSource === 'upstox_carried_forward' ? 'market_value_proxy' : e.costBasisSource
      }));
  }, [snap]);

  const filterCounts = useMemo(() => {
    let missingCost = 0;
    let inLoss = 0;
    let external = 0;
    for (const e of directEquities) {
      if (e.costBasisSource === 'market_value_proxy') missingCost += 1;
      else if (e.pnl < 0) inLoss += 1;
      if (e.isExternalBroker) external += 1;
    }
    return { missingCost, inLoss, external };
  }, [directEquities]);

  const filteredEquities = useMemo(() => {
    return directEquities.filter((e) => {
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
      if (filter === 'core') return e.currentValue >= 100000;
      if (filter === 'mid') return e.currentValue >= 25000 && e.currentValue < 100000;
      if (filter === 'small') return e.currentValue < 25000;
      if (filter === 'missing_cost') return e.costBasisSource === 'market_value_proxy';
      if (filter === 'in_loss') return e.costBasisSource !== 'market_value_proxy' && e.pnl < 0;
      if (filter === 'external') return e.isExternalBroker;
      return true;
    });
  }, [directEquities, search, filter]);

  const bondsTotalValue = useMemo(() => bondsList.reduce((s, b) => s + b.currentValue, 0), [bondsList]);
  const bondsTotalInvested = useMemo(() => bondsList.reduce((s, b) => s + b.investedValue, 0), [bondsList]);

  // Fixed Deposits & Emergency-Linked Assets (with graceful fallback for cached pre-v0.3.1 snapshots)
  const isLegacySnapshotWithoutFds = Boolean(snap && snap.fixedDeposits === undefined);
  const fixedDepositsList: ReconciledFixedDeposit[] = useMemo(() => {
    if (!snap) return [];
    if (snap.fixedDeposits) return snap.fixedDeposits;
    const fdAllocs = snap.allocations.filter(
      (a) => /^(FD|FDS|FIXED_DEPOSIT|FIXED_DEPOSITS|BANK_FD)$/i.test(a.assetType) && a.currentValue > 0
    );
    if (fdAllocs.length === 0) return [];
    const cur = fdAllocs.reduce((s, a) => s + a.currentValue, 0);
    const invRaw = fdAllocs.reduce((s, a) => s + a.investedValue, 0);
    const inv = invRaw > 0 ? invRaw : cur;
    return [
      {
        id: 'fd:cached:aggregate',
        name: 'Fixed Deposits (INDmoney Linked)',
        bank: 'INDmoney Linked Bank',
        investedValue: inv,
        currentValue: cur,
        interestEarned: cur - inv,
        returnPct: inv > 0 ? ((cur - inv) / inv) * 100 : 0,
        isTaxSaver: false,
        countsTowardEmergency: true,
        source: 'indmoney_aggregate'
      }
    ];
  }, [snap]);

  const savingsAccountsList: ReconciledSavingsAccount[] = useMemo(() => {
    if (!snap) return [];
    if (snap.savingsAccounts && snap.savingsAccounts.length > 0) return snap.savingsAccounts;
    if (snap.savingsAccountBalance > 0) {
      return [
        {
          id: 'sa:cached:aggregate',
          name: 'Savings Accounts (INDmoney Linked)',
          bank: 'Linked Bank Account',
          balance: snap.savingsAccountBalance,
          source: 'indmoney_aggregate'
        }
      ];
    }
    return [];
  }, [snap]);

  const arbitrageMfs = useMemo(() => (snap ? snap.mutualFunds.filter((m) => m.isArbitrage) : []), [snap]);
  const liquidMfs = useMemo(() => (snap ? snap.mutualFunds.filter((m) => m.isLiquid) : []), [snap]);
  const arbitrageTotal = useMemo(
    () => snap?.arbitrageTotal ?? arbitrageMfs.reduce((s, m) => s + m.currentValue, 0),
    [snap, arbitrageMfs]
  );
  const emergencyFdTotal = useMemo(
    () =>
      snap?.emergencyFdTotal ??
      fixedDepositsList.filter((f) => f.countsTowardEmergency).reduce((s, f) => s + f.currentValue, 0),
    [snap, fixedDepositsList]
  );
  const lockedFdTotal = useMemo(
    () => fixedDepositsList.filter((f) => !f.countsTowardEmergency).reduce((s, f) => s + f.currentValue, 0),
    [fixedDepositsList]
  );
  const effectiveEmergencyCushion = useMemo(() => {
    if (!snap) return 0;
    if (snap.emergencyFdTotal === undefined && emergencyFdTotal > 0) {
      return snap.emergencyCushionTotal + emergencyFdTotal;
    }
    return snap.emergencyCushionTotal;
  }, [snap, emergencyFdTotal]);

  const emergencyAssetCount =
    fixedDepositsList.length + savingsAccountsList.length + arbitrageMfs.length + liquidMfs.length;
  const emergencyPct =
    state.profile.emergencyTarget > 0
      ? Math.min(100, Math.round((effectiveEmergencyCushion / state.profile.emergencyTarget) * 100))
      : 100;
  const emergencyGap = Math.max(0, state.profile.emergencyTarget - effectiveEmergencyCushion);
  const emergencySurplus = Math.max(0, effectiveEmergencyCushion - state.profile.emergencyTarget);

  if (!snap) return null;

  const upstoxLinked = snap.upstoxState !== 'not_linked';

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aliasIndName.trim() || !aliasUpSym.trim()) return;
    await onSaveAlias({ indmoneyName: aliasIndName.trim(), upstoxSymbol: aliasUpSym.trim().toUpperCase() });
    setAliasIndName('');
    setAliasUpSym('');
  };

  const startEditAvg = (id: string, avg: number | null) => {
    setEditingId(id);
    setEditPriceInput(avg !== null ? String(avg) : '');
  };

  const commitEditAvg = async (item: Pick<ReconciledEquity, 'id' | 'name' | 'symbol' | 'isin' | 'broker'>) => {
    const num = Number(editPriceInput);
    if (!Number.isFinite(num) || num <= 0) {
      setEditingId(null);
      return;
    }
    await onSaveCostOverride({
      holdingKey: `id:${item.id.toLowerCase()}`,
      displayName: item.name,
      symbol: item.symbol,
      isin: item.isin || undefined,
      broker: item.broker,
      averagePrice: num
    });
    setEditingId(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-surface-900">
          {(
            [
              ['equities', `Direct Equities (${directEquities.length})`],
              ['bonds', `Bonds & SGBs (${bondsList.length})`],
              ['mf', `Mutual Funds (${snap.mutualFunds.length})`],
              ['emergency', `Emergency & FDs (${emergencyAssetCount})`],
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

        {(subTab === 'equities' || subTab === 'bonds') && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onImportCostCsv()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-surface-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="Import holdings CSV from Paytm Money Web (Holdings → Download CSV), Zerodha Console, Groww, Upstox, Angel One, or any custom CSV"
            >
              <Upload className="h-3.5 w-3.5 text-emerald-500" />
              Import Avg Cost CSV
            </button>

            {subTab === 'equities' && (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search stock or broker..."
                    className="rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-surface-900 dark:text-white"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Filter:</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as EquityFilter)}
                    aria-label="Filter direct equities by position size, cost basis status, or broker"
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-emerald-500 focus:outline-none dark:border-slate-800 dark:bg-surface-900 dark:text-slate-200"
                  >
                    <option value="all">All Direct Equities ({directEquities.length})</option>
                    <option value="core">Core Positions (&ge; ₹1L)</option>
                    <option value="mid">Mid Positions (₹25K–₹1L)</option>
                    <option value="small">Small Positions (&lt; ₹25K)</option>
                    <option value="missing_cost">Missing Avg Cost ({filterCounts.missingCost})</option>
                    <option value="in_loss">In Loss &lt; 0% ({filterCounts.inLoss})</option>
                    <option value="external">External Brokers ({filterCounts.external})</option>
                  </select>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* CSV Import Summary & Unmatched Diagnostics Banner */}
      {lastCsvImport && !lastCsvImport.canceled && !lastCsvImport.error && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-900 dark:text-emerald-100">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <span>
                  Imported {lastCsvImport.parsedCount} rows from <code>{lastCsvImport.fileName}</code>
                  {lastCsvImport.detectedBroker ? ` (${lastCsvImport.detectedBroker})` : ''} — matched{' '}
                  {lastCsvImport.matchedInSnapshot} live holdings (equities + bonds/SGBs).
                </span>
              </div>
              {lastCsvImport.unmatchedNames && lastCsvImport.unmatchedNames.length > 0 && (
                <div className="mt-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-200">
                  <span className="font-semibold">
                    {lastCsvImport.unmatchedNames.length} CSV row{lastCsvImport.unmatchedNames.length === 1 ? '' : 's'} didn&apos;t match a synced holding:
                  </span>{' '}
                  {lastCsvImport.unmatchedNames.slice(0, 8).join(', ')}
                  {lastCsvImport.unmatchedNames.length > 8 ? ` (+${lastCsvImport.unmatchedNames.length - 8} more)` : ''}.
                  {' '}You can click any holding&apos;s Avg Cost inline to set it manually.
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onDismissCsvImport}
              className="rounded-lg p-1 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              title="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Direct Equities Table */}
      {subTab === 'equities' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
            <span>
              Tip: Click any <strong>Avg Cost</strong> value (or <code>—</code>) to edit manually, or import a broker CSV (e.g., Paytm Money Web <em>Holdings → Download CSV</em>, Zerodha Console, Groww, Upstox).
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
                        {!isInternalCode(e.symbol) && (
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">{e.symbol}</span>
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
                        {e.costBasisSource === 'csv_import' && !e.partialCostBasisNote && (
                          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-500">
                            CSV
                          </span>
                        )}
                        {e.partialCostBasisNote && (
                          <span
                            title={e.partialCostBasisNote}
                            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            PARTIAL CSV
                          </span>
                        )}
                      </div>
                      {e.partialCostBasisNote && (
                        <div className="mt-0.5 text-[10px] text-amber-600/90 dark:text-amber-400/90">
                          {e.partialCostBasisNote}
                        </div>
                      )}
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
                          onClick={() => startEditAvg(e.id, e.averagePrice)}
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
                {filteredEquities.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-xs text-slate-400">
                      No direct equities match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bonds & SGBs Dedicated Tab */}
      {subTab === 'bonds' && (
        <div className="space-y-4">
          {bondsList.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
                <div className="text-xs text-slate-500">Total Bonds &amp; SGB Value</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(bondsTotalValue)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
                <div className="text-xs text-slate-500">Invested Cost Basis</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(bondsTotalInvested)}
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
                <div className="text-xs text-slate-500">Unrealized Gain</div>
                <div
                  className={`mt-1 text-lg font-bold tabular-nums ${
                    bondsTotalValue - bondsTotalInvested >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {formatInrCompact(bondsTotalValue - bondsTotalInvested)} (
                  {formatSignedPct(
                    bondsTotalInvested > 0 ? ((bondsTotalValue - bondsTotalInvested) / bondsTotalInvested) * 100 : 0,
                    1
                  )}
                  )
                </div>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
            <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-2 text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400">
              Tracks Sovereign Gold Bonds (SGBs), Corporate NCDs, G-Secs, and Bonds across linked brokers. Click any <strong>Avg Cost</strong> to edit, or import a broker CSV containing SGBs.
            </div>
            {bondsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <Landmark className="h-8 w-8 text-amber-500/70" />
                <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                  No Bonds, SGBs, or NCDs Detected Yet
                </h3>
                <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  Sovereign Gold Bonds, corporate NCDs, and G-Secs held in your linked INDmoney or Upstox accounts are automatically separated here on your next sync.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Instrument</th>
                      <th className="px-3 py-3 font-medium">Type</th>
                      <th className="px-3 py-3 font-medium">Broker</th>
                      <th className="px-3 py-3 text-right font-medium">Qty / Grams</th>
                      <th className="px-3 py-3 text-right font-medium">Avg Cost</th>
                      <th className="px-3 py-3 text-right font-medium">LTP</th>
                      <th className="px-3 py-3 text-right font-medium">Current Value</th>
                      <th className="px-4 py-3 text-right font-medium">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                    {bondsList.map((b) => {
                      const typeBadge =
                        b.bondType === 'SGB'
                          ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : b.bondType === 'NCD'
                          ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                          : b.bondType === 'G-Sec'
                          ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                          : 'bg-slate-500/15 text-slate-600 dark:text-slate-300';
                      return (
                        <tr key={b.id} className="group hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{b.name}</div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-500">
                              {!isInternalCode(b.symbol) && <span className="font-mono">{b.symbol}</span>}
                              {b.costBasisSource === 'csv_import' && (
                                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 font-medium text-blue-500">CSV</span>
                              )}
                              {b.costBasisSource === 'manual_override' && (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-500">
                                  MANUAL
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeBadge}`}>
                              {b.bondType}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{b.broker}</td>
                          <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-300">{b.quantity}</td>
                          <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400">
                            {editingId === b.id ? (
                              <div className="inline-flex items-center justify-end gap-1">
                                <input
                                  type="number"
                                  step="0.01"
                                  autoFocus
                                  value={editPriceInput}
                                  onChange={(ev) => setEditPriceInput(ev.target.value)}
                                  onKeyDown={(ev) => {
                                    if (ev.key === 'Enter') void commitEditAvg(b);
                                    if (ev.key === 'Escape') setEditingId(null);
                                  }}
                                  placeholder="Avg ₹"
                                  className="w-20 rounded-md border border-emerald-500 bg-white px-1.5 py-0.5 text-right text-xs text-slate-900 focus:outline-none dark:bg-slate-800 dark:text-white"
                                />
                                <button
                                  onClick={() => void commitEditAvg(b)}
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
                                onClick={() => startEditAvg(b.id, b.averagePrice)}
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-slate-200/70 dark:hover:bg-slate-700/70"
                                title="Edit average buy price"
                              >
                                <span>{b.averagePrice !== null ? formatInrFull(b.averagePrice, 2) : '—'}</span>
                                <Pencil className="h-2.5 w-2.5 opacity-0 transition group-hover:opacity-70" />
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right text-slate-800 dark:text-slate-200">
                            {formatInrFull(b.lastPrice, 2)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                            {formatInrCompact(b.currentValue)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {b.costBasisSource === 'market_value_proxy' ? (
                              <span className="text-slate-400">N/A</span>
                            ) : (
                              <span className={b.pnl >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                                {formatInrCompact(b.pnl)} ({formatSignedPct(b.pnlPct, 1)})
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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

      {/* Emergency-Linked Assets & Fixed Deposits Tab */}
      {subTab === 'emergency' && (
        <div className="space-y-5">
          {/* Emergency Cushion Readiness Banner */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Emergency Cushion &amp; Liquidity Stack
                  </h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      emergencyPct >= 100
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {emergencyPct >= 100
                      ? `Target Met (+${formatInrCompact(emergencySurplus)} buffer)`
                      : `${emergencyPct}% Funded · ${formatInrCompact(emergencyGap)} short`}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Core Emergency Cushion combines <strong>Savings Account cash</strong>, <strong>Callable Fixed Deposits</strong>, and{' '}
                  <strong>Arbitrage Mutual Funds</strong>. Locked 5-year Tax-Saver FDs and Liquid/STP deployment pools are tracked separately below.
                </p>
              </div>
              <div className="text-right tabular-nums">
                <div className="text-xs text-slate-500 dark:text-slate-400">Core Emergency Cushion</div>
                <div className="text-2xl font-bold text-slate-900 dark:text-white">
                  {formatInrCompact(effectiveEmergencyCushion)}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Target {formatInrCompact(state.profile.emergencyTarget)}
                </div>
              </div>
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${emergencyPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${emergencyPct}%` }}
              />
            </div>

            {isLegacySnapshotWithoutFds && (
              <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                Click <strong>Sync Now</strong> to fetch itemized Fixed Deposit details (bank, interest rate, maturity date) directly from INDmoney.
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Savings Account Cash</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(snap.savingsAccountBalance)}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                  Instant liquidity · In cushion
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Callable Fixed Deposits</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(emergencyFdTotal)}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                  {lockedFdTotal > 0
                    ? `In cushion (+${formatInrCompact(lockedFdTotal)} locked tax-saver)`
                    : 'Quick breakable · In cushion'}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Arbitrage Mutual Funds</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(arbitrageTotal)}
                </div>
                <div className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                  T+2 tax-efficient · In cushion
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Liquid / Overnight MFs</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(snap.liquidCorpusTotal)}
                </div>
                <div className="mt-0.5 text-[10px] text-cyan-600 dark:text-cyan-400">
                  STP / Near-Cash Pool (separate)
                </div>
              </div>
            </div>
          </div>

          {/* Fixed Deposits Table */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Fixed Deposits ({fixedDepositsList.length})
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Synced from INDmoney · Callable FDs automatically count toward your Emergency Cushion
              </div>
            </div>

            {fixedDepositsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <Landmark className="h-7 w-7 text-teal-500/70" />
                <h4 className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-white">
                  No Fixed Deposits Synced Yet
                </h4>
                <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  Fixed Deposits tracked in your linked INDmoney account appear here automatically on sync and are included in your Emergency Cushion (excluding locked 5-year Tax-Saver FDs).
                </p>
              </div>
            ) : (
              <>
                {fixedDepositsList.some((f) => f.source === 'indmoney_aggregate') && (
                  <div className="border-b border-slate-200 bg-teal-500/5 px-4 py-2 text-[11px] text-teal-700 dark:border-slate-800 dark:text-teal-300">
                    Showing INDmoney&apos;s aggregate Fixed Deposit balance. Individual FD rows (interest rate &amp; maturity date) appear automatically whenever INDmoney MCP exposes itemized FD holdings.
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Fixed Deposit</th>
                        <th className="px-3 py-3 font-medium">Bank / Issuer</th>
                        <th className="px-3 py-3 text-right font-medium">Principal</th>
                        <th className="px-3 py-3 text-right font-medium">Current Value</th>
                        <th className="px-3 py-3 text-right font-medium">Interest Earned</th>
                        <th className="px-3 py-3 text-right font-medium">Rate / Maturity</th>
                        <th className="px-4 py-3 text-right font-medium">Emergency Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                      {fixedDepositsList.map((fd) => (
                        <tr key={fd.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900 dark:text-white">{fd.name}</div>
                            {fd.tenure && (
                              <div className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                Tenure: {fd.tenure}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{fd.bank}</td>
                          <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400">
                            {formatInrCompact(fd.investedValue)}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                            {formatInrCompact(fd.currentValue)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span
                              className={
                                fd.interestEarned >= 0
                                  ? 'font-medium text-emerald-500'
                                  : 'font-medium text-rose-500'
                              }
                            >
                              {formatInrCompact(fd.interestEarned)} ({formatSignedPct(fd.returnPct, 1)})
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-300">
                            {fd.interestRate || fd.maturityDate ? (
                              <div>
                                {fd.interestRate && <span className="font-medium">{fd.interestRate}% p.a.</span>}
                                {fd.maturityDate && (
                                  <div className="text-[10px] text-slate-400">Mat: {fd.maturityDate}</div>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {fd.countsTowardEmergency ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" />
                                Emergency Eligible
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                <Lock className="h-3 w-3" />
                                Tax-Saver / Locked
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* Savings Accounts, Arbitrage & Liquid Funds Breakdown */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800/90 dark:bg-surface-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                Bank Cash, Arbitrage &amp; Liquid Mutual Funds ({savingsAccountsList.length + arbitrageMfs.length + liquidMfs.length})
              </div>
              {snap.liquidCorpusTotal > 0 && (
                <div className="text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                  Total Liquidity incl. Liquid MFs:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {formatInrCompact(effectiveEmergencyCushion + snap.liquidCorpusTotal)}
                  </strong>
                </div>
              )}
            </div>

            {savingsAccountsList.length === 0 && arbitrageMfs.length === 0 && liquidMfs.length === 0 ? (
              <div className="px-6 py-8 text-center text-xs text-slate-400">
                No Savings Account cash, Arbitrage funds, or Liquid/Overnight mutual funds detected in this snapshot.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-medium">Asset / Fund</th>
                      <th className="px-3 py-3 font-medium">Category</th>
                      <th className="px-3 py-3 font-medium">Source</th>
                      <th className="px-3 py-3 text-right font-medium">Current Value</th>
                      <th className="px-3 py-3 text-right font-medium">P&amp;L</th>
                      <th className="px-4 py-3 text-right font-medium">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                    {savingsAccountsList.map((sa) => (
                      <tr key={sa.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{sa.name}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-slate-500/15 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-300">
                            Savings Account
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{sa.bank}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                          {formatInrCompact(sa.balance)}
                        </td>
                        <td className="px-3 py-3 text-right text-slate-400">—</td>
                        <td className="px-4 py-3 text-right">
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Counts in Cushion
                          </span>
                        </td>
                      </tr>
                    ))}
                    {arbitrageMfs.map((m) => (
                      <tr key={`arb-${m.broker}-${m.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{m.name}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Arbitrage MF
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{m.broker || 'INDmoney'}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                          {formatInrCompact(m.currentValue)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={m.pnl >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                            {formatInrCompact(m.pnl)} ({formatSignedPct(m.pnlPct, 1)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Counts in Cushion
                          </span>
                        </td>
                      </tr>
                    ))}
                    {liquidMfs.map((m) => (
                      <tr key={`liq-${m.broker}-${m.name}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">{m.name}</td>
                        <td className="px-3 py-3">
                          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-medium text-cyan-600 dark:text-cyan-400">
                            Liquid / Overnight MF
                          </span>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{m.broker || 'INDmoney'}</td>
                        <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                          {formatInrCompact(m.currentValue)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={m.pnl >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                            {formatInrCompact(m.pnl)} ({formatSignedPct(m.pnlPct, 1)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-600 dark:text-cyan-400">
                            STP / Near-Cash Pool
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Reconciliation, Alias Resolver & Saved Cost Overrides */}
      {subTab === 'reconcile' && (
        <div className="space-y-4">
          <div className={`grid gap-4 ${upstoxLinked ? 'sm:grid-cols-4' : 'sm:grid-cols-2'}`}>
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">INDmoney Stocks Total</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrCompact(snap.reconciliation.indmoneyStockTotal)}
              </div>
            </div>
            {upstoxLinked && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
                <div className="text-xs text-slate-500">Upstox Equities Total</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatInrCompact(snap.reconciliation.upstoxEquityTotal)}
                </div>
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
              <div className="text-xs text-slate-500">External Brokers Total</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrCompact(snap.reconciliation.externalStockTotal)}
              </div>
            </div>
            {upstoxLinked && (
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
            )}
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
                  Persisted across future daily syncs for external brokers (Paytm Money, Zerodha, Groww, Pinnacle, etc.) where MCP doesn&apos;t return buy price.
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
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-white">{ov.displayName}</span>
                      {ov.broker && (
                        <span className="rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {ov.broker}
                        </span>
                      )}
                      {ov.csvQty && (
                        <span className="text-[10px] text-slate-400">Qty {ov.csvQty}</span>
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

          {/* Custom Symbol Alias Mapper (only relevant when Upstox is linked or aliases exist) */}
          {(upstoxLinked || state.aliases.length > 0) && (
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
          )}
        </div>
      )}
    </div>
  );
};
