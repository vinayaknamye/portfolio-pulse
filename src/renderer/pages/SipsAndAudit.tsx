import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { AppStatePayload, SipBaselineItem } from '@shared/types';
import { formatInrCompact, formatInrFull, formatSignedPct } from '../lib/format';

interface SipsAndAuditProps {
  state: AppStatePayload;
  onSaveBaselines: (items: SipBaselineItem[]) => Promise<void>;
  onResetBaselines: () => Promise<void>;
  onDismissAlert: (id: string) => Promise<void>;
}

export const SipsAndAudit: React.FC<SipsAndAuditProps> = ({
  state,
  onSaveBaselines,
  onResetBaselines,
  onDismissAlert
}) => {
  const snap = state.latestSnapshot;
  const [baselines, setBaselines] = useState<SipBaselineItem[]>(state.sipBaselines);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'action' | 'warning' | 'info'>('all');
  const [savedNotice, setSavedNotice] = useState(false);

  React.useEffect(() => {
    setBaselines(state.sipBaselines);
  }, [state.sipBaselines]);

  if (!snap) return null;

  const filteredAlerts = state.alerts.filter((a) => {
    if (a.dismissed) return false;
    if (severityFilter === 'all') return true;
    return a.severity === severityFilter;
  });

  const handleSaveBaselines = async () => {
    await onSaveBaselines(baselines.filter((b) => b.fundName.trim().length > 0));
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2000);
  };

  const addBaselineRow = () => {
    setBaselines((prev) => [
      ...prev,
      { fundName: '', expectedAmount: 10000, expectedFrequency: 'MONTHLY', active: true }
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Cashflow & SIP Summary Strip */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
          <div className="text-xs text-slate-500">Weekly SIP Outflow</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrFull(snap.weeklySipOutflow)}/wk
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
          <div className="text-xs text-slate-500">Monthly SIP Outflow</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrFull(snap.monthlySipOutflow)}/mo
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
          <div className="text-xs text-slate-500">Est. Total Monthly SIP</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-emerald-500">
            {formatInrCompact(snap.estimatedMonthlySipTotal)}/mo
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
          <div className="text-xs text-slate-500">Savings Account Cash</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrFull(snap.savingsAccountBalance)}
          </div>
        </div>
      </div>

      {/* Active SIP Mandates */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Live Registered SIP Mandates Across Brokers ({snap.activeSips.length})
        </h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="py-2.5 pr-4 font-medium">Instrument</th>
                <th className="px-3 py-2.5 font-medium">Broker</th>
                <th className="px-3 py-2.5 font-medium">Frequency</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 text-right font-medium">Invested</th>
                <th className="px-3 py-2.5 text-right font-medium">Current</th>
                <th className="py-2.5 pl-3 text-right font-medium">Gain %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
              {snap.activeSips.map((s) => (
                <tr key={`${s.broker}-${s.fundName}-${s.folioId}-${s.frequency}`}>
                  <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-white">
                    <div className="flex items-center gap-1.5">
                      <span>{s.fundName}</span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                        {s.instrumentType || 'MF'}
                      </span>
                    </div>
                    <div className="text-[11px] font-normal text-slate-400">
                      {s.category} · {s.nextInstallmentDate ? `Next ${s.nextInstallmentDate}` : `Starts ${s.startDate || 'N/A'}`}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        (s.broker || 'INDmoney') === 'Upstox'
                          ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                          : 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {s.broker || 'INDmoney'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {s.frequency}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold text-slate-900 dark:text-white">
                    {formatInrFull(s.amount)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400">
                    {s.investedValue > 0 ? formatInrCompact(s.investedValue) : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right text-slate-800 dark:text-slate-200">
                    {s.currentValue > 0 ? formatInrCompact(s.currentValue) : '—'}
                  </td>
                  <td className="py-2.5 pl-3 text-right">
                    {s.investedValue > 0 ? (
                      <span className={s.gainPct >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                        {formatSignedPct(s.gainPct, 1)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {snap.activeSips.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-400">
                    No active SIP mandates found across linked brokers.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editable SIP Baseline Checker */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Expected SIP Baseline (Drift Detection)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Daily audits compare live mandates against this baseline and flag paused, missing, or altered SIPs.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onResetBaselines()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Mirror Live SIPs
            </button>
            <button
              onClick={addBaselineRow}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" /> Add Rule
            </button>
            <button
              onClick={() => void handleSaveBaselines()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              <Save className="h-3.5 w-3.5" /> {savedNotice ? 'Saved!' : 'Save Baseline'}
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {baselines.map((row, idx) => (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              <input
                type="checkbox"
                checked={row.active}
                onChange={(e) => {
                  const next = [...baselines];
                  next[idx] = { ...row, active: e.target.checked };
                  setBaselines(next);
                }}
                className="h-4 w-4 accent-emerald-500"
              />
              <input
                value={row.fundName}
                onChange={(e) => {
                  const next = [...baselines];
                  next[idx] = { ...row, fundName: e.target.value };
                  setBaselines(next);
                }}
                placeholder="Exact fund name"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <input
                type="number"
                value={row.expectedAmount}
                onChange={(e) => {
                  const next = [...baselines];
                  next[idx] = { ...row, expectedAmount: Number(e.target.value) };
                  setBaselines(next);
                }}
                className="w-28 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
              <select
                value={row.expectedFrequency}
                onChange={(e) => {
                  const next = [...baselines];
                  next[idx] = {
                    ...row,
                    expectedFrequency: e.target.value as SipBaselineItem['expectedFrequency']
                  };
                  setBaselines(next);
                }}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="WEEKLY">WEEKLY</option>
                <option value="MONTHLY">MONTHLY</option>
                <option value="DAILY">DAILY</option>
              </select>
              <button
                onClick={() => setBaselines((prev) => prev.filter((_, i) => i !== idx))}
                className="p-1.5 text-slate-400 hover:text-rose-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Complete Audit Alerts Feed */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Deterministic Audit Alerts ({filteredAlerts.length})
          </h2>
          <div className="flex gap-1.5">
            {(['all', 'action', 'warning', 'info'] as const).map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`rounded-lg px-2.5 py-1 text-xs capitalize ${
                  severityFilter === sev
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" /> No active alerts in this category.
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredAlerts.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 text-xs dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="flex items-start gap-2.5">
                  {a.severity === 'info' ? (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  ) : (
                    <AlertTriangle
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        a.severity === 'action' ? 'text-rose-500' : 'text-amber-500'
                      }`}
                    />
                  )}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">{a.title}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                        {a.category}
                      </span>
                    </div>
                    <p className="mt-1 text-slate-600 dark:text-slate-400">{a.detail}</p>
                  </div>
                </div>
                <button
                  onClick={() => void onDismissAlert(a.id)}
                  className="shrink-0 rounded-md px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
                >
                  Dismiss
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
