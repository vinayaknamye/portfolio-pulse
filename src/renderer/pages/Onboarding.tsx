import React, { useState } from 'react';
import {
  CheckCircle2,
  Info,
  Link2,
  Loader2,
  Play,
  ShieldCheck,
  Sparkles,
  Wallet
} from 'lucide-react';
import { AppStatePayload, BrokerId } from '@shared/types';
import { NON_ADVISORY_DISCLAIMER } from '@shared/constants';

interface OnboardingProps {
  state: AppStatePayload;
  onSyncNow: () => Promise<void>;
  onEnableDemo: () => Promise<void>;
  onConnectBroker: (broker: BrokerId) => Promise<void>;
  connectingBroker: BrokerId | null;
  syncing: boolean;
}

export const Onboarding: React.FC<OnboardingProps> = ({
  state,
  onSyncNow,
  onEnableDemo,
  onConnectBroker,
  connectingBroker,
  syncing
}) => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const indConnected = state.brokers.indmoney.state === 'connected';
  const upConnected = state.brokers.upstox.state === 'connected';

  const handleConnect = async (broker: BrokerId) => {
    setStatusMessage(`Opening ${broker === 'indmoney' ? 'INDmoney' : 'Upstox'} OAuth sign-in in your browser...`);
    try {
      await onConnectBroker(broker);
      setStatusMessage(null);
    } catch {
      setStatusMessage(null);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col justify-center px-6 py-8 overflow-y-auto">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30">
          <Wallet className="h-6 w-6" />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
          Welcome to Portfolio Pulse
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-600 dark:text-slate-400">
          Link your broker MCP accounts locally for daily multi-broker reconciliation, SIP &amp; cashflow audits, and optional BYOK AI reviews. Everything stays 100% on your device.
        </p>
      </div>

      {/* Best-Practice Setup Tip */}
      <div className="mb-5 rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-xs text-emerald-900 dark:text-emerald-200">
        <div className="flex items-start gap-2.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div>
            <p className="font-semibold">Tip for Complete Net-Worth Tracking</p>
            <p className="mt-1 leading-relaxed opacity-90">
              For the most complete view across all asset classes — Real Estate, Mutual Funds, PPF/EPF, Gold, Bonds/SGBs, Savings Accounts, and external brokers (Zerodha, Paytm Money, Groww, etc.) — link or record all your holdings inside <strong>INDmoney</strong> first. Then connect <strong>INDmoney</strong> (plus <strong>Upstox</strong> if you hold equities or SIPs there) below. You can also import Avg Cost CSVs from other brokers anytime on the Holdings screen.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* INDmoney Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-surface-900">
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Multi-Asset Aggregator
              </span>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">INDmoney MCP</h2>
            </div>
            {indConnected && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Provides total net worth, asset allocation, mutual funds, active SIP mandates, savings account balance, and multi-broker equity holdings.
          </p>
          {state.brokers.indmoney.lastError && (
            <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
              {state.brokers.indmoney.lastError}
            </p>
          )}
          <button
            onClick={() => handleConnect('indmoney')}
            disabled={connectingBroker !== null}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {connectingBroker === 'indmoney' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for browser sign-in...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4" /> {indConnected ? 'Reconnect INDmoney' : 'Connect INDmoney'}
              </>
            )}
          </button>
        </div>

        {/* Upstox Card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-surface-900">
          <div className="flex items-start justify-between">
            <div>
              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                Demat Stocks, MFs, SIPs &amp; Margin
              </span>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">Upstox MCP</h2>
            </div>
            {upConnected && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            Adds live demat purchase prices, accurate equity P&L, idle trading cash alerts, and cross-broker quantity verification. Skip if you don't use Upstox.
          </p>
          {state.brokers.upstox.lastError && (
            <p className="mt-3 rounded-lg bg-rose-500/10 px-3 py-2 text-xs text-rose-500">
              {state.brokers.upstox.lastError}
            </p>
          )}
          <button
            onClick={() => handleConnect('upstox')}
            disabled={connectingBroker !== null}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-900 transition hover:bg-slate-200 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {connectingBroker === 'upstox' ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for browser sign-in...
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4" /> {upConnected ? 'Reconnect Upstox' : 'Connect Upstox (Optional)'}
              </>
            )}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-center text-xs text-emerald-700 dark:text-emerald-300">
          {statusMessage}
        </div>
      )}

      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {(indConnected || upConnected) && (
          <button
            onClick={() => void onSyncNow()}
            disabled={syncing}
            className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Initial Portfolio Sync
          </button>
        )}
        <button
          onClick={() => void onEnableDemo()}
          className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-surface-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Sparkles className="h-4 w-4 text-amber-500" />
          Try Demo Portfolio First
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-100/70 p-4 text-xs text-slate-600 dark:border-slate-800 dark:bg-surface-900/60 dark:text-slate-400">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <div>
            <p className="font-medium text-slate-800 dark:text-slate-200">100% Local-First Privacy</p>
            <p className="mt-1 leading-relaxed">{NON_ADVISORY_DISCLAIMER}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
