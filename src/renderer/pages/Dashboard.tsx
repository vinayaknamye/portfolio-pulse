import React from 'react';
import {
  Area,
  AreaChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Info,
  Repeat,
  Shield,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { AppStatePayload } from '@shared/types';
import {
  formatInrCompact,
  formatInrFull,
  formatSignedInrCompact,
  formatSignedPct,
  formatTimestamp,
  getAssetColor
} from '../lib/format';

interface DashboardProps {
  state: AppStatePayload;
  onNavigate: (tab: 'holdings' | 'audit' | 'insights' | 'strategy' | 'settings') => void;
  onDismissAlert: (id: string) => Promise<void>;
}

export const Dashboard: React.FC<DashboardProps> = ({ state, onNavigate, onDismissAlert }) => {
  const snap = state.latestSnapshot;
  if (!snap) return null;

  const history = state.history;
  const prevPoint = history.length >= 2 ? history[history.length - 2] : null;
  const dayDelta = prevPoint ? snap.totalNetworth - prevPoint.totalNetworth : 0;
  const dayDeltaPct = prevPoint && prevPoint.totalNetworth > 0 ? (dayDelta / prevPoint.totalNetworth) * 100 : 0;

  const activeAlerts = state.alerts.filter((a) => !a.dismissed);
  const emergencyPct =
    state.profile.emergencyTarget > 0
      ? Math.min(100, Math.round((snap.emergencyCushionTotal / state.profile.emergencyTarget) * 100))
      : 100;

  const chartData = history.map((h) => ({
    date: h.snapshotDate.slice(5),
    networth: Math.round(h.totalNetworth),
    invested: Math.round(h.totalInvestedAdjusted)
  }));

  const pieData = snap.allocations.map((a, idx) => ({
    name: a.assetType,
    value: a.currentValue,
    weight: a.weightPct,
    color: getAssetColor(a.assetType, idx)
  }));

  const isDark = state.profile.theme === 'dark';

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Total Net Worth</span>
            <Wallet className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrCompact(snap.totalNetworth)}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-xs tabular-nums">
            {prevPoint ? (
              <>
                {dayDelta >= 0 ? (
                  <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" />
                )}
                <span className={dayDelta >= 0 ? 'font-medium text-emerald-500' : 'font-medium text-rose-500'}>
                  {formatSignedInrCompact(dayDelta)} ({formatSignedPct(dayDeltaPct)})
                </span>
                <span className="text-slate-400">vs prior</span>
              </>
            ) : (
              <span className="text-slate-400">Synced {formatTimestamp(snap.fetchedAt)}</span>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Unrealized Gain (Adj.)</span>
            <TrendingUp className="h-4 w-4 text-blue-500" />
          </div>
          <div
            className={`mt-2 text-2xl font-bold tabular-nums ${
              snap.totalUnrealizedGain >= 0 ? 'text-emerald-500' : 'text-rose-500'
            }`}
          >
            {formatSignedInrCompact(snap.totalUnrealizedGain)}
          </div>
          <div className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatSignedPct(snap.totalUnrealizedGainPct)} on {formatInrCompact(snap.totalInvestedAdjusted)} invested
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Emergency Cushion</span>
            <Shield className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrCompact(snap.emergencyCushionTotal)}
          </div>
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${emergencyPct >= 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${emergencyPct}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              <span>{emergencyPct}% of target</span>
              <span>Target {formatInrCompact(state.profile.emergencyTarget)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Monthly SIP Engine</span>
            <Repeat className="h-4 w-4 text-purple-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatInrCompact(snap.estimatedMonthlySipTotal)}
          </div>
          <div className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {snap.activeSips.length} active · SA cash {formatInrCompact(snap.savingsAccountBalance)}
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* Net Worth Trend */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Net Worth History</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Daily local snapshots ({history.length} recorded day{history.length === 1 ? '' : 's'})
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500" /> Net Worth
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-400" /> Invested
              </span>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatInrCompact(Number(v))}
                  tick={{ fontSize: 11, fill: isDark ? '#94a3b8' : '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={72}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value: number) => formatInrFull(value)}
                  contentStyle={{
                    backgroundColor: isDark ? '#0f172a' : '#ffffff',
                    borderColor: isDark ? '#1e293b' : '#e2e8f0',
                    borderRadius: 12,
                    fontSize: 12
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="networth"
                  name="Net Worth"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#nwGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="invested"
                  name="Adjusted Invested"
                  stroke="#64748b"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Allocation Donut */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Asset Allocation</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Reconciled across linked brokers</p>
          <div className="mt-2 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} stroke="none" />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => formatInrCompact(value)}
                  contentStyle={{
                    backgroundColor: isDark ? '#0f172a' : '#ffffff',
                    borderColor: isDark ? '#1e293b' : '#e2e8f0',
                    borderRadius: 10,
                    fontSize: 12
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1.5">
            {snap.allocations.slice(0, 6).map((a, idx) => (
              <div key={a.assetType} className="flex items-center justify-between text-xs tabular-nums">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: getAssetColor(a.assetType, idx) }}
                  />
                  <span className="font-medium text-slate-700 dark:text-slate-300">{a.assetType}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 dark:text-slate-400">{formatInrCompact(a.currentValue)}</span>
                  <span className="w-11 text-right font-medium text-slate-800 dark:text-slate-200">
                    {a.weightPct.toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Priority Alerts + Quick Stats */}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Daily Audit Feed ({activeAlerts.length})
            </h2>
            <button
              onClick={() => onNavigate('audit')}
              className="text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              View all SIPs & Audit →
            </button>
          </div>
          {activeAlerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 p-4 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All multi-broker, cashflow, SIP, and risk checks are green!
            </div>
          ) : (
            <div className="space-y-2.5">
              {activeAlerts.slice(0, 5).map((alert) => {
                const style =
                  alert.severity === 'action'
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : alert.severity === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300';
                return (
                  <div
                    key={alert.id}
                    className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 text-xs ${style}`}
                  >
                    <div className="flex items-start gap-2.5">
                      {alert.severity === 'info' ? (
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <div>
                        <p className="font-semibold">{alert.title}</p>
                        <p className="mt-0.5 opacity-90">{alert.detail}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => void onDismissAlert(alert.id)}
                      className="shrink-0 rounded-md px-2 py-1 text-[11px] opacity-70 hover:bg-black/10 hover:opacity-100"
                    >
                      Dismiss
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reconciliation & Liquidity Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800/90 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Multi-Broker Health</h2>
          <div className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">Upstox Cost Basis</span>
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  snap.upstoxState === 'live'
                    ? 'bg-emerald-500/15 text-emerald-500'
                    : snap.upstoxState === 'stale_reauth_required'
                    ? 'bg-amber-500/15 text-amber-500'
                    : 'bg-slate-500/15 text-slate-400'
                }`}
              >
                {snap.upstoxState === 'live'
                  ? 'Live Synced'
                  : snap.upstoxState === 'stale_reauth_required'
                  ? 'Carried Forward'
                  : 'INDmoney Only'}
              </span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-500 dark:text-slate-400">Matched Equities</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {snap.reconciliation.matchedCount} matched · {snap.reconciliation.externalCount} external
              </span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-500 dark:text-slate-400">Aggregate Variance</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {formatInrFull(snap.reconciliation.aggregateDiff, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-500 dark:text-slate-400">Upstox Idle Margin</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {formatInrFull(snap.upstoxAvailableMargin, 2)}
              </span>
            </div>
            <div className="flex items-center justify-between tabular-nums">
              <span className="text-slate-500 dark:text-slate-400">Liquid STP Corpus</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {formatInrCompact(snap.liquidCorpusTotal)}
              </span>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => onNavigate('holdings')}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Holdings
            </button>
            <button
              onClick={() => onNavigate('insights')}
              className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500"
            >
              AI Review
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
