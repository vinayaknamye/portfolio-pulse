import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Image as ImageIcon,
  Info,
  Loader2,
  MessageSquare,
  Paperclip,
  Scale,
  Settings2,
  Sparkles,
  X
} from 'lucide-react';
import { AdvisorAttachment, AdvisorTopic, AIReportRecord, AppStatePayload } from '@shared/types';
import { AI_PROVIDER_PRESETS, NON_ADVISORY_DISCLAIMER } from '@shared/constants';
import { formatTimestamp } from '../lib/format';
import { MarkdownView } from '../components/MarkdownView';

export type InsightsSubTab = 'alerts' | 'reviews' | 'advisor';

interface InsightsProps {
  state: AppStatePayload;
  subTab: InsightsSubTab;
  onSubTabChange: (tab: InsightsSubTab) => void;
  onDismissAlert: (id: string) => Promise<void>;
  onOpenAiSettings: () => void;
  onOpenFloatingChat: () => void;
  onGenerateReport: () => Promise<void>;
  onValidateAdvisorInput: (payload: {
    topic: AdvisorTopic;
    advisorName?: string;
    pitchText: string;
    attachmentPaths?: string[];
  }) => Promise<AIReportRecord>;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const ADVISOR_TOPICS: Array<{ id: AdvisorTopic; label: string; placeholder: string }> = [
  {
    id: 'insurance',
    label: 'Insurance / ULIP / Endowment',
    placeholder:
      'e.g., My bank RM is pitching a ₹2L/year guaranteed income / ULIP plan for 10 years promising tax-free returns after 15 years. Should I take it or buy pure term + index fund?'
  },
  {
    id: 'mutual_funds',
    label: 'Mutual Fund / SIP / NFO',
    placeholder:
      'e.g., My distributor suggests stopping my Nifty 50 / Flexi Cap fund and moving ₹5L into a new Regular-plan sectoral NFO...'
  },
  {
    id: 'holdings',
    label: 'Direct Stock / Bond / SGB',
    placeholder:
      'e.g., An advisor recommends trimming HDFC Bank and buying a small-cap defence stock or a 10.5% corporate NCD...'
  },
  {
    id: 'tax_loan',
    label: 'Tax / Home Loan / Prepayment',
    placeholder:
      'e.g., Should I liquidate my SGBs or equity MFs to prepay an 8.5% home loan, or keep investing?'
  },
  {
    id: 'general',
    label: 'General Wealth Advice',
    placeholder: 'Paste any recommendation, allocation change, or sales pitch you received from an advisor or RM...'
  }
];

export const Insights: React.FC<InsightsProps> = ({
  state,
  subTab,
  onSubTabChange,
  onDismissAlert,
  onOpenAiSettings,
  onOpenFloatingChat,
  onGenerateReport,
  onValidateAdvisorInput
}) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(state.reports[0]?.id ?? null);
  const [copied, setCopied] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'action' | 'warning' | 'info'>('all');

  // Advisor Check state
  const [advisorTopic, setAdvisorTopic] = useState<AdvisorTopic>('insurance');
  const [advisorName, setAdvisorName] = useState('');
  const [pitchText, setPitchText] = useState('');
  const [attachments, setAttachments] = useState<AdvisorAttachment[]>([]);
  const [validatingAdvisor, setValidatingAdvisor] = useState(false);
  const [advisorError, setAdvisorError] = useState<string | null>(null);
  const [latestAdvisorReport, setLatestAdvisorReport] = useState<AIReportRecord | null>(null);

  useEffect(() => {
    if (state.reports.length > 0 && !state.reports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(state.reports[0].id);
    }
  }, [state.reports, selectedReportId]);

  const preset = AI_PROVIDER_PRESETS[state.profile.aiProvider];
  const isConfigured = !preset.requiresKey || state.hasAiApiKey[state.profile.aiProvider];
  const activeReport = state.reports.find((r) => r.id === selectedReportId) || state.reports[0] || null;

  const activeAlerts = state.alerts.filter((a) => !a.dismissed);
  const filteredAlerts = activeAlerts.filter((a) => (severityFilter === 'all' ? true : a.severity === severityFilter));

  const handleGenerate = async () => {
    if (!isConfigured) {
      onOpenAiSettings();
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      await onGenerateReport();
      onSubTabChange('reviews');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handlePickAttachments = async () => {
    setAdvisorError(null);
    const res = await window.portfolioPulse.pickAdvisorAttachments();
    if (res.canceled) return;
    if (res.error) {
      setAdvisorError(res.error);
      return;
    }
    setAttachments((prev) => {
      const existingPaths = new Set(prev.map((a) => a.filePath));
      const merged = [...prev, ...res.files.filter((f) => !existingPaths.has(f.filePath))];
      return merged.slice(0, 5);
    });
  };

  const handleValidateAdvisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfigured) {
      onOpenAiSettings();
      return;
    }
    if (!pitchText.trim() && attachments.length === 0) return;
    setAdvisorError(null);
    setValidatingAdvisor(true);
    try {
      const report = await onValidateAdvisorInput({
        topic: advisorTopic,
        advisorName: advisorName.trim() || undefined,
        pitchText: pitchText.trim(),
        attachmentPaths: attachments.map((a) => a.filePath)
      });
      setLatestAdvisorReport(report);
      setSelectedReportId(report.id);
    } catch (err) {
      setAdvisorError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidatingAdvisor(false);
    }
  };

  const handleCopyReport = async (markdown: string) => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const selectedTopicObj = ADVISOR_TOPICS.find((t) => t.id === advisorTopic) || ADVISOR_TOPICS[0];

  return (
    <div className="space-y-5">
      {/* Sub-Tab Bar + AI Status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-800 dark:bg-surface-900">
          <button
            onClick={() => onSubTabChange('alerts')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
              subTab === 'alerts'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <BellRing className="h-3.5 w-3.5" />
            Audit Alerts ({activeAlerts.length})
          </button>
          <button
            onClick={() => onSubTabChange('reviews')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
              subTab === 'reviews'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Past AI Reviews ({state.reports.length})
          </button>
          <button
            onClick={() => onSubTabChange('advisor')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-medium transition ${
              subTab === 'advisor'
                ? 'bg-emerald-600 text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Scale className="h-3.5 w-3.5" />
            Advisor Check
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-surface-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {preset.label} · {state.profile.aiModel}
          </button>
          <button
            type="button"
            onClick={onOpenFloatingChat}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-surface-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
            Ask Q&amp;A
          </button>
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !state.latestSnapshot}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Generate Review
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-500">
          {error}
        </div>
      )}

      {/* SUB-TAB 1: DETERMINISTIC AUDIT ALERTS */}
      {subTab === 'alerts' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                Deterministic Daily Audit Alerts ({filteredAlerts.length})
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                100% local rule-based checks across holdings, drawdowns, concentration, cashflow, and emergency cushion.
              </p>
            </div>
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
              <CheckCircle2 className="h-4 w-4 shrink-0" /> No active alerts in this category — everything looks healthy!
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
                      <div className="flex flex-wrap items-center gap-2">
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
      )}

      {/* SUB-TAB 2: PAST AI REVIEWS ARCHIVE */}
      {subTab === 'reviews' && (
        <div className="grid gap-5 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Saved Reviews ({state.reports.length})
            </h3>
            <div className="mt-3 space-y-1.5">
              {state.reports.length === 0 && (
                <p className="text-xs text-slate-400">
                  No past reviews yet. Click <strong>Generate Review</strong> above, or run an <strong>Advisor Check</strong>.
                </p>
              )}
              {state.reports.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedReportId(r.id)}
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-xs transition ${
                    activeReport?.id === r.id
                      ? 'bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/30 dark:text-emerald-300'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="font-semibold">{r.title}</div>
                  <div className="mt-0.5 text-[10px] opacity-75">
                    {r.provider} · {r.model}
                  </div>
                  <div className="text-[10px] opacity-60">{formatTimestamp(r.createdAt)}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-surface-900 lg:col-span-3">
            {activeReport ? (
              <>
                <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{activeReport.title}</h3>
                    <p className="text-[11px] text-slate-400">
                      Generated by {activeReport.provider} ({activeReport.model}) · {formatTimestamp(activeReport.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={onOpenFloatingChat}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
                      Follow-up
                    </button>
                    <button
                      onClick={() => void handleCopyReport(activeReport.markdown)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {copied ? 'Copied' : 'Copy Markdown'}
                    </button>
                  </div>
                </div>
                <div className="max-h-[640px] overflow-y-auto pr-2">
                  <MarkdownView content={activeReport.markdown} />
                </div>
              </>
            ) : (
              <div className="flex h-80 flex-col items-center justify-center text-center">
                <Sparkles className="h-8 w-8 text-emerald-500/70" />
                <h3 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">
                  No Saved Portfolio Reviews Yet
                </h3>
                <p className="mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  Generate a structured review to archive and track AI commentary over time. Configure your Claude, Gemini, OpenAI, or Ollama provider anytime under Settings.
                </p>
                <button
                  onClick={isConfigured ? () => void handleGenerate() : onOpenAiSettings}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  {isConfigured ? (
                    <>
                      <Sparkles className="h-3.5 w-3.5" /> Generate First Review
                    </>
                  ) : (
                    <>
                      <Settings2 className="h-3.5 w-3.5" /> Configure AI in Settings
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: ADVISOR SECOND OPINION / VALIDATOR */}
      {subTab === 'advisor' && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-surface-900">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                  <Scale className="h-4 w-4 text-emerald-500" />
                  Advisor &amp; RM Second Opinion (Validate With AI)
                </h2>
                <p className="mt-1 max-w-2xl text-xs text-slate-500 dark:text-slate-400">
                  Paste any pitch or recommendation from a financial advisor, bank RM, or insurance agent. Portfolio Pulse evaluates it against your live holdings, bonds/SGBs, tracked insurance policies ({state.insurancePolicies.length}), and personal Strategy Markdown — highlighting hidden commissions, overlap, lock-ins, and 5 smart questions to ask back.
                </p>
              </div>
              {!isConfigured && (
                <button
                  type="button"
                  onClick={onOpenAiSettings}
                  className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Configure AI Key First →
                </button>
              )}
            </div>

            <form onSubmit={(e) => void handleValidateAdvisor(e)} className="mt-5 space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Recommendation Category
                  </label>
                  <select
                    value={advisorTopic}
                    onChange={(e) => setAdvisorTopic(e.target.value as AdvisorTopic)}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {ADVISOR_TOPICS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Advisor / Bank / Institution (Optional)
                  </label>
                  <input
                    value={advisorName}
                    onChange={(e) => setAdvisorName(e.target.value)}
                    placeholder="e.g., HDFC Bank RM, ICICI Wealth, LIC Agent, Independent MFD"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Recommendation / Pitch Details
                  </label>
                  <button
                    type="button"
                    onClick={() => void handlePickAttachments()}
                    disabled={attachments.length >= 5}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Paperclip className="h-3.5 w-3.5 text-emerald-500" />
                    Attach Files (PDF, Image, CSV, TXT)
                  </button>
                </div>
                <textarea
                  value={pitchText}
                  onChange={(e) => setPitchText(e.target.value)}
                  rows={5}
                  placeholder={selectedTopicObj.placeholder}
                  className="mt-1.5 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-900 focus:border-emerald-500 focus:outline-none dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-100"
                />

                {/* Attached Supporting Files */}
                {attachments.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {attachments.map((att) => {
                      const isImg = att.mimeType.startsWith('image/');
                      return (
                        <div
                          key={att.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-800 dark:text-emerald-200"
                        >
                          {isImg ? (
                            <ImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                          )}
                          <span className="max-w-[200px] truncate font-medium">{att.fileName}</span>
                          <span className="text-[10px] opacity-75">{formatAttachmentSize(att.sizeBytes)}</span>
                          <button
                            type="button"
                            onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                            className="ml-0.5 rounded p-0.5 hover:bg-emerald-500/20"
                            title="Remove file"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Attach up to 5 brochures, benefit illustrations, PDF quotes, or RM screenshots (max 15 MB each). AI reads the file contents directly alongside your portfolio &amp; policies.
                </p>
              </div>

              {advisorError && (
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-500">
                  {advisorError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Every validation is automatically archived under <strong>Past AI Reviews</strong>.
                </span>
                <button
                  type="submit"
                  disabled={
                    validatingAdvisor ||
                    (!pitchText.trim() && attachments.length === 0) ||
                    !state.latestSnapshot
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {validatingAdvisor ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing Pitch &amp; Files Against Portfolio…
                    </>
                  ) : (
                    <>
                      <Scale className="h-3.5 w-3.5" /> Validate With AI
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {latestAdvisorReport && (
            <div className="rounded-2xl border border-emerald-500/30 bg-white p-6 dark:border-emerald-500/30 dark:bg-surface-900">
              <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{latestAdvisorReport.title}</h3>
                  <p className="text-[11px] text-slate-400">
                    Second opinion via {latestAdvisorReport.provider} ({latestAdvisorReport.model}) · Saved to Past AI Reviews
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyReport(latestAdvisorReport.markdown)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? 'Copied' : 'Copy Markdown'}
                </button>
              </div>
              <MarkdownView content={latestAdvisorReport.markdown} />
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500 dark:text-slate-400">{NON_ADVISORY_DISCLAIMER}</p>
    </div>
  );
};
