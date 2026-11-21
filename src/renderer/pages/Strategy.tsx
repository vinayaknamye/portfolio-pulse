import React, { useEffect, useState } from 'react';
import { Eye, FileEdit, Save } from 'lucide-react';
import { AppStatePayload, UserProfile } from '@shared/types';
import { MarkdownView } from '../components/MarkdownView';

interface StrategyProps {
  state: AppStatePayload;
  onSaveProfile: (partial: Partial<UserProfile>) => Promise<void>;
}

export const Strategy: React.FC<StrategyProps> = ({ state, onSaveProfile }) => {
  const [form, setForm] = useState<UserProfile>(state.profile);
  const [previewMode, setPreviewMode] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(state.profile);
  }, [state.profile]);

  const handleSave = async () => {
    await onSaveProfile({
      displayName: form.displayName,
      monthlyIncome: Number(form.monthlyIncome) || 0,
      emergencyTarget: Number(form.emergencyTarget) || 0,
      idleMarginThreshold: Number(form.idleMarginThreshold) || 5000,
      drawdownThresholdPct: Number(form.drawdownThresholdPct) || -15,
      concentrationThresholdPct: Number(form.concentrationThresholdPct) || 15,
      strategyMarkdown: form.strategyMarkdown
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Hybrid Strategy &amp; Audit Thresholds
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Numeric thresholds drive deterministic daily alerts; your Markdown Strategy &amp; Goals document is fed directly to AI Insights.
          </p>
        </div>
        <button
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
        >
          <Save className="h-3.5 w-3.5" /> {saved ? 'Saved!' : 'Save Strategy'}
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Structured Thresholds */}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900 lg:col-span-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Audit Rules &amp; Targets</h3>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Display Name</span>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Monthly Take-Home Income (₹)</span>
            <input
              type="number"
              value={form.monthlyIncome}
              onChange={(e) => setForm({ ...form, monthlyIncome: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Emergency Cushion Target (₹)</span>
            <input
              type="number"
              value={form.emergencyTarget}
              onChange={(e) => setForm({ ...form, emergencyTarget: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Compared against Arbitrage MFs + Savings Account balance.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Idle Broker Cash Alert (₹)</span>
            <input
              type="number"
              value={form.idleMarginThreshold}
              onChange={(e) => setForm({ ...form, idleMarginThreshold: Number(e.target.value) })}
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Drawdown Alert (%)</span>
              <input
                type="number"
                value={form.drawdownThresholdPct}
                onChange={(e) => setForm({ ...form, drawdownThresholdPct: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Concentration Cap (%)</span>
              <input
                type="number"
                value={form.concentrationThresholdPct}
                onChange={(e) => setForm({ ...form, concentrationThresholdPct: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs tabular-nums text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>
          </div>
        </div>

        {/* Freeform Markdown Strategy Editor */}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              My Strategy &amp; Goals (Markdown)
            </h3>
            <button
              onClick={() => setPreviewMode((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {previewMode ? (
                <>
                  <FileEdit className="h-3.5 w-3.5" /> Edit
                </>
              ) : (
                <>
                  <Eye className="h-3.5 w-3.5" /> Preview
                </>
              )}
            </button>
          </div>
          {previewMode ? (
            <div className="min-h-[380px] flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
              <MarkdownView content={form.strategyMarkdown} />
            </div>
          ) : (
            <textarea
              value={form.strategyMarkdown}
              onChange={(e) => setForm({ ...form, strategyMarkdown: e.target.value })}
              rows={17}
              placeholder="Write your financial milestones, tax regime, loans, insurance, SIP plans, and asset allocation rules in Markdown..."
              className="min-h-[380px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
            />
          )}
        </div>
      </div>
    </div>
  );
};
