import React, { useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  X
} from 'lucide-react';
import { AI_PROVIDER_PRESETS } from '@shared/constants';
import { AppStatePayload } from '@shared/types';
import { MarkdownView } from './MarkdownView';

interface FloatingChatProps {
  state: AppStatePayload;
  activeTab: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSendChat: (message: string) => Promise<void>;
  onClearChat: () => Promise<void>;
  onOpenAiConfig: () => void;
}

const PROMPTS_BY_TAB: Record<string, string[]> = {
  dashboard: [
    'Summarize my portfolio health and top 3 priorities today.',
    'Is my asset allocation balanced against my Strategy & Goals?'
  ],
  holdings: [
    'Which direct equity holdings have the highest risk or drawdown right now?',
    'Review my equity concentration and sector exposure.'
  ],
  audit: [
    'Is my Savings Account + Emergency cushion safe for upcoming SIP debits?',
    'Suggest a balanced SIP step-down plan if a major EMI starts soon.'
  ],
  strategy: [
    'Check how well my current portfolio and insurance policies align with my Strategy & Goals.',
    'What gaps do you see in my emergency buffer, term/health cover, or milestone plan?'
  ],
  insights: [
    'Give me 3 concrete action items from my latest audit alerts and holdings.',
    'Which holdings are candidates for tax-loss harvesting or trimming?'
  ],
  settings: [
    'Summarize my overall net worth, liquidity, and active SIP velocity.'
  ]
};

export const FloatingChat: React.FC<FloatingChatProps> = ({
  state,
  activeTab,
  open,
  onOpenChange,
  onSendChat,
  onClearChat,
  onOpenAiConfig
}) => {
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const preset = AI_PROVIDER_PRESETS[state.profile.aiProvider];
  const needsKey = preset.requiresKey && !state.hasAiApiKey[state.profile.aiProvider];
  const starterPrompts = PROMPTS_BY_TAB[activeTab] || PROMPTS_BY_TAB.dashboard;

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, state.chatMessages.length, sending]);

  const handleSend = async (overrideText?: string) => {
    const prompt = (overrideText ?? input).trim();
    if (!prompt || sending) return;
    setError(null);
    setSending(true);
    setInput('');
    try {
      await onSendChat(prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-xs font-semibold text-white shadow-xl shadow-emerald-900/30 ring-1 ring-emerald-400/30 transition hover:scale-[1.02] hover:bg-emerald-500"
        title="Ask Portfolio Pulse AI about your portfolio"
      >
        <Sparkles className="h-4 w-4" />
        <span>Ask AI</span>
        {state.chatMessages.length > 0 && (
          <span className="rounded-full bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-bold">
            {state.chatMessages.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-black/30 dark:border-slate-700/80 dark:bg-surface-900 ${
        expanded ? 'h-[78vh] w-[640px] max-w-[92vw]' : 'h-[540px] w-[420px] max-w-[92vw]'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/90 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-900 dark:text-white">Portfolio AI Q&amp;A</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {preset.label} · {state.profile.aiModel}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={onOpenAiConfig}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Configure AI Provider & Key"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          {state.chatMessages.length > 0 && (
            <button
              onClick={() => void onClearChat()}
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-rose-500 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Clear Chat History"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title={expanded ? 'Compact View' : 'Expand Panel'}
          >
            {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Missing Key Notice */}
      {needsKey && (
        <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-300">
          <span>Add a {preset.label} API key to start chatting.</span>
          <button
            onClick={onOpenAiConfig}
            className="shrink-0 rounded-md bg-amber-500 px-2.5 py-1 text-[10px] font-semibold text-slate-950 hover:bg-amber-400"
          >
            Configure AI
          </button>
        </div>
      )}

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {state.chatMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <MessageSquare className="h-7 w-7 text-emerald-500/70" />
            <p className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
              Ask about your live portfolio from any screen
            </p>
            <p className="mt-1 max-w-xs text-[11px] text-slate-500 dark:text-slate-400">
              Grounded in your reconciled holdings, SIPs, audit alerts, and Strategy Markdown.
            </p>
            <div className="mt-4 w-full space-y-2">
              {starterPrompts.map((q) => (
                <button
                  key={q}
                  onClick={() => void handleSend(q)}
                  disabled={sending || needsKey}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left text-[11px] text-slate-700 transition hover:border-emerald-500/50 hover:bg-emerald-500/5 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          state.chatMessages.map((m, idx) => (
            <div key={m.id ?? idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs ${
                  m.role === 'user'
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-100'
                }`}
              >
                {m.role === 'user' ? (
                  <p className="leading-relaxed">{m.content}</p>
                ) : (
                  <MarkdownView content={m.content} />
                )}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" /> Thinking with {state.profile.aiModel}…
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-500">
            {error}
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleSend();
        }}
        className="flex items-center gap-2 border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-surface-900"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={needsKey}
          placeholder={needsKey ? 'Configure AI key first…' : 'Ask about holdings, SIPs, taxes, risk…'}
          className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 focus:border-emerald-500 focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
        />
        <button
          type="submit"
          disabled={sending || needsKey || !input.trim()}
          className="inline-flex items-center justify-center rounded-xl bg-emerald-600 p-2 text-white hover:bg-emerald-500 disabled:opacity-50"
          title="Send"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
};
