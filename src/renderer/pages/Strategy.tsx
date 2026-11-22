import React, { useEffect, useMemo, useState } from 'react';
import { BookTemplate, Eye, FileEdit, Pencil, Plus, Save, ShieldCheck, Trash2, X } from 'lucide-react';
import { AppStatePayload, InsuranceCategory, InsurancePolicy, UserProfile } from '@shared/types';
import { STRATEGY_TEMPLATES } from '@shared/constants';
import { formatInrCompact, formatInrFull } from '../lib/format';
import { MarkdownView } from '../components/MarkdownView';

interface StrategyProps {
  state: AppStatePayload;
  onSaveProfile: (partial: Partial<UserProfile>) => Promise<void>;
  onSaveInsurancePolicy: (policy: InsurancePolicy) => Promise<void>;
  onDeleteInsurancePolicy: (id: number) => Promise<void>;
}

const INSURANCE_CATEGORIES: InsuranceCategory[] = [
  'Term Life',
  'Health',
  'Endowment / Guaranteed',
  'ULIP',
  'Vehicle / Other'
];

const EMPTY_POLICY: InsurancePolicy = {
  category: 'Term Life',
  insurer: '',
  planName: '',
  sumAssured: 0,
  annualPremium: 0,
  renewalDate: '',
  paymentTerm: '',
  notes: ''
};

export const Strategy: React.FC<StrategyProps> = ({
  state,
  onSaveProfile,
  onSaveInsurancePolicy,
  onDeleteInsurancePolicy
}) => {
  const [form, setForm] = useState<UserProfile>(state.profile);
  // Default to Preview mode so Strategy reads cleanly on first open; click document or Edit button to edit
  const [previewMode, setPreviewMode] = useState(true);
  const [saved, setSaved] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Insurance Policy Tracker state
  const [showPolicyForm, setShowPolicyForm] = useState(false);
  const [policyDraft, setPolicyDraft] = useState<InsurancePolicy>({ ...EMPTY_POLICY });
  const [policyError, setPolicyError] = useState<string | null>(null);

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
    setPreviewMode(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleApplyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const tpl = STRATEGY_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;
    setForm((prev) => ({ ...prev, strategyMarkdown: tpl.markdown }));
    setPreviewMode(false);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyDraft.insurer.trim() || !policyDraft.planName.trim()) {
      setPolicyError('Please enter both Insurer and Plan Name.');
      return;
    }
    setPolicyError(null);
    await onSaveInsurancePolicy({
      ...policyDraft,
      sumAssured: Number(policyDraft.sumAssured) || 0,
      annualPremium: Number(policyDraft.annualPremium) || 0
    });
    setPolicyDraft({ ...EMPTY_POLICY });
    setShowPolicyForm(false);
  };

  const startEditPolicy = (policy: InsurancePolicy) => {
    setPolicyDraft({ ...policy });
    setPolicyError(null);
    setShowPolicyForm(true);
  };

  const insuranceTotals = useMemo(() => {
    let termCover = 0;
    let healthCover = 0;
    let totalAnnualPremium = 0;
    for (const p of state.insurancePolicies) {
      totalAnnualPremium += p.annualPremium;
      if (p.category === 'Term Life') termCover += p.sumAssured;
      if (p.category === 'Health') healthCover += p.sumAssured;
    }
    return { termCover, healthCover, totalAnnualPremium };
  }, [state.insurancePolicies]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Strategy, Audit Rules &amp; Insurance Cover
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Numeric thresholds drive deterministic alerts; your Strategy Markdown &amp; Insurance Policies feed directly into AI Reviews and Advisor Check.
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
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Investor Profile &amp; Audit Rules</h3>

          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Display Name</span>
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              placeholder="e.g., Anjalee"
              className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
            <span className="mt-0.5 block text-[11px] text-slate-400">
              Shown in your Dashboard header, AI prompts, and Markdown exports.
            </span>
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

        {/* Freeform Markdown Strategy Viewer / Editor with Templates */}
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900 lg:col-span-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                My Strategy &amp; Goals
              </h3>
              <p className="text-[11px] text-slate-400">
                {previewMode ? 'Click anywhere inside the document or press Edit to customize.' : 'Editing Markdown — click Save Strategy when done.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative inline-flex items-center">
                <BookTemplate className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-emerald-500" />
                <select
                  value={selectedTemplateId}
                  onChange={(e) => handleApplyTemplate(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 py-1 pl-7 pr-2.5 text-xs text-slate-700 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option value="">Load Strategy Template…</option>
                  {STRATEGY_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setPreviewMode((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {previewMode ? (
                  <>
                    <FileEdit className="h-3.5 w-3.5 text-emerald-500" /> Edit
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Preview
                  </>
                )}
              </button>
            </div>
          </div>

          {previewMode ? (
            <div
              onClick={() => setPreviewMode(false)}
              title="Click to edit your Strategy & Goals"
              className="min-h-[380px] flex-1 cursor-text overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-500/50 dark:border-slate-800 dark:bg-slate-950/50"
            >
              <MarkdownView content={form.strategyMarkdown} />
            </div>
          ) : (
            <textarea
              value={form.strategyMarkdown}
              onChange={(e) => setForm({ ...form, strategyMarkdown: e.target.value })}
              rows={17}
              autoFocus
              placeholder="Write your financial milestones, tax regime, loans, insurance, SIP plans, and asset allocation rules in Markdown..."
              className="min-h-[380px] flex-1 resize-none rounded-xl border border-emerald-500/50 bg-slate-50 p-3.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-emerald-500/40 dark:bg-slate-950/60 dark:text-slate-100"
            />
          )}
        </div>
      </div>

      {/* Insurance & Protection Policies Tracker */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Insurance &amp; Protection Policies ({state.insurancePolicies.length})
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Track Term Life, Health, Endowment, ULIP, and other policies locally. Shared automatically with AI Reviews &amp; Advisor Check to evaluate cover gaps or policy pitches.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setPolicyDraft({ ...EMPTY_POLICY });
              setPolicyError(null);
              setShowPolicyForm((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            {showPolicyForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showPolicyForm ? 'Close Form' : 'Add Policy'}
          </button>
        </div>

        {/* Coverage Summary Pills */}
        {state.insurancePolicies.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-500">Term Life Cover</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {insuranceTotals.termCover > 0 ? formatInrCompact(insuranceTotals.termCover) : 'Not recorded'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-500">Health Cover</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {insuranceTotals.healthCover > 0 ? formatInrCompact(insuranceTotals.healthCover) : 'Not recorded'}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50">
              <div className="text-[11px] text-slate-500">Total Annual Premiums</div>
              <div className="mt-0.5 text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {formatInrFull(insuranceTotals.totalAnnualPremium)}/yr
              </div>
            </div>
          </div>
        )}

        {/* Add / Edit Policy Form */}
        {showPolicyForm && (
          <form
            onSubmit={(e) => void handleSavePolicy(e)}
            className="mt-4 space-y-3 rounded-xl border border-emerald-500/30 bg-slate-50/80 p-4 dark:bg-slate-950/50"
          >
            <div className="text-xs font-semibold text-slate-900 dark:text-white">
              {policyDraft.id ? 'Edit Insurance Policy' : 'Add Insurance Policy'}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Category</span>
                <select
                  value={policyDraft.category}
                  onChange={(e) =>
                    setPolicyDraft({ ...policyDraft, category: e.target.value as InsuranceCategory })
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {INSURANCE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Insurer</span>
                <input
                  value={policyDraft.insurer}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, insurer: e.target.value })}
                  placeholder="e.g., HDFC Life, LIC, HDFC Ergo, Niva Bupa"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Plan Name</span>
                <input
                  value={policyDraft.planName}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, planName: e.target.value })}
                  placeholder="e.g., Click 2 Protect / Optima Secure"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Sum Assured / Cover (₹)</span>
                <input
                  type="number"
                  value={policyDraft.sumAssured || ''}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, sumAssured: Number(e.target.value) })}
                  placeholder="e.g., 10000000"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Annual Premium (₹)</span>
                <input
                  type="number"
                  value={policyDraft.annualPremium || ''}
                  onChange={(e) => setPolicyDraft({ ...policyDraft, annualPremium: Number(e.target.value) })}
                  placeholder="e.g., 24000"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-medium text-slate-500">Payment Term &amp; Renewal</span>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  <input
                    value={policyDraft.paymentTerm}
                    onChange={(e) => setPolicyDraft({ ...policyDraft, paymentTerm: e.target.value })}
                    placeholder="e.g., 10 yrs"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <input
                    value={policyDraft.renewalDate}
                    onChange={(e) => setPolicyDraft({ ...policyDraft, renewalDate: e.target.value })}
                    placeholder="e.g., 15-Mar"
                    className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-slate-500">Notes (Lock-in, riders, maturity year, nominee)</span>
              <input
                value={policyDraft.notes}
                onChange={(e) => setPolicyDraft({ ...policyDraft, notes: e.target.value })}
                placeholder="Optional notes shared with AI for policy review or Advisor Check"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </label>

            {policyError && <p className="text-xs text-rose-500">{policyError}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowPolicyForm(false);
                  setPolicyDraft({ ...EMPTY_POLICY });
                }}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                <Save className="h-3.5 w-3.5" /> {policyDraft.id ? 'Update Policy' : 'Save Policy'}
              </button>
            </div>
          </form>
        )}

        {/* Saved Policies List */}
        {state.insurancePolicies.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No insurance policies added yet. Click <strong>Add Policy</strong> to record Term Life, Health, ULIP, or Endowment policies so AI can check your overall protection cover.
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 pr-3 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Insurer &amp; Plan</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sum Assured</th>
                  <th className="px-3 py-2.5 text-right font-medium">Annual Premium</th>
                  <th className="px-3 py-2.5 font-medium">Term / Renewal</th>
                  <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums dark:divide-slate-800/70">
                {state.insurancePolicies.map((p) => {
                  const catBadge =
                    p.category === 'Term Life'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : p.category === 'Health'
                      ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400'
                      : p.category === 'ULIP' || p.category === 'Endowment / Guaranteed'
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-slate-500/15 text-slate-600 dark:text-slate-300';
                  return (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                      <td className="py-3 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${catBadge}`}>
                          {p.category}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {p.insurer} — {p.planName}
                        </div>
                        {p.notes && <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{p.notes}</div>}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-900 dark:text-white">
                        {p.sumAssured > 0 ? formatInrCompact(p.sumAssured) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-700 dark:text-slate-300">
                        {formatInrFull(p.annualPremium)}
                      </td>
                      <td className="px-3 py-3 text-slate-500 dark:text-slate-400">
                        {[p.paymentTerm, p.renewalDate && `Renews ${p.renewalDate}`].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => startEditPolicy(p)}
                            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                            title="Edit policy"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          {p.id && (
                            <button
                              type="button"
                              onClick={() => void onDeleteInsurancePolicy(p.id!)}
                              className="rounded p-1 text-slate-400 hover:bg-rose-500/10 hover:text-rose-500"
                              title="Delete policy"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
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
  );
};
