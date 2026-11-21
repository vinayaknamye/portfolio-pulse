import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Settings2,
  Sparkles
} from 'lucide-react';
import { AppStatePayload } from '@shared/types';
import { AI_PROVIDER_PRESETS, NON_ADVISORY_DISCLAIMER } from '@shared/constants';
import { formatTimestamp } from '../lib/format';
import { MarkdownView } from '../components/MarkdownView';

interface InsightsProps {
  state: AppStatePayload;
  onOpenAiSettings: () => void;
  onOpenFloatingChat: () => void;
  onGenerateReport: () => Promise<void>;
}

export const Insights: React.FC<InsightsProps> = ({
  state,
  onOpenAiSettings,
  onOpenFloatingChat,
  onGenerateReport
}) => {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<number | null>(state.reports[0]?.id ?? null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.reports.length > 0 && !state.reports.some((r) => r.id === selectedReportId)) {
      setSelectedReportId(state.reports[0].id);
    }
  }, [state.reports, selectedReportId]);

  const preset = AI_PROVIDER_PRESETS[state.profile.aiProvider];
  const isConfigured = !preset.requiresKey || state.hasAiApiKey[state.profile.aiProvider];
  const activeReport = state.reports.find((r) => r.id === selectedReportId) || state.reports[0] || null;

  const handleGenerate = async () => {
    if (!isConfigured) {
      onOpenAiSettings();
      return;
    }
    setError(null);
    setGenerating(true);
    try {
      await onGenerateReport();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyReport = async () => {
    if (!activeReport) return;
    await navigator.clipboard.writeText(activeReport.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      {/* Minimal Archive Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 dark:border-slate-800 dark:bg-surface-900">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Past Portfolio Reviews</h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {preset.label} · {state.profile.aiModel}
            </span>
            {isConfigured ? (
              <span className="inline-flex items-center gap-1 text-emerald-500">
                <CheckCircle2 className="h-3 w-3" /> Ready
              </span>
            ) : (
              <button onClick={onOpenAiSettings} className="text-amber-500 hover:underline">
                Configure API key in Settings →
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Settings2 className="h-3.5 w-3.5" />
            AI Settings
          </button>

          <button
            type="button"
            onClick={onOpenFloatingChat}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <MessageSquare className="h-3.5 w-3.5 text-emerald-500" />
            Ask Q&amp;A
          </button>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || !state.latestSnapshot}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
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

      {/* Past Reviews Archive & Reader */}
      <div className="grid gap-5 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-surface-900">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Saved Reviews ({state.reports.length})
          </h3>
          <div className="mt-3 space-y-1.5">
            {state.reports.length === 0 && (
              <p className="text-xs text-slate-400">
                No past reviews yet. Click <strong>Generate Review</strong> above, or click <strong>Ask AI</strong> in the bottom-right corner from any tab.
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
                    onClick={() => void handleCopyReport()}
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

      <p className="text-[11px] text-slate-500 dark:text-slate-400">{NON_ADVISORY_DISCLAIMER}</p>
    </div>
  );
};
