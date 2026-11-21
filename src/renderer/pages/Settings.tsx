import React, { useEffect, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
  Unlink
} from 'lucide-react';
import { AIProviderId, AIScheduleMode, AppStatePayload, BrokerId, UserProfile } from '@shared/types';
import { AI_PROVIDER_PRESETS } from '@shared/constants';
import { formatTimestamp } from '../lib/format';

interface SettingsProps {
  state: AppStatePayload;
  aiConfigOpen: boolean;
  onAiConfigOpenChange: (open: boolean) => void;
  onSaveProfile: (partial: Partial<UserProfile>) => Promise<void>;
  onSaveApiKey: (provider: AIProviderId, apiKey: string) => Promise<void>;
  onClearApiKey: (provider: AIProviderId) => Promise<void>;
  onConnectBroker: (broker: BrokerId) => Promise<void>;
  onDisconnectBroker: (broker: BrokerId) => Promise<void>;
  onToggleDemo: (enabled: boolean) => Promise<void>;
  onExportBundle: () => Promise<void>;
  onTestNotification: () => Promise<void>;
  onWipeAllData: () => Promise<void>;
  connectingBroker: BrokerId | null;
}

export const Settings: React.FC<SettingsProps> = ({
  state,
  aiConfigOpen,
  onAiConfigOpenChange,
  onSaveProfile,
  onSaveApiKey,
  onClearApiKey,
  onConnectBroker,
  onDisconnectBroker,
  onToggleDemo,
  onExportBundle,
  onTestNotification,
  onWipeAllData,
  connectingBroker
}) => {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const { profile, brokers } = state;

  // AI BYOK configuration state
  const [provider, setProvider] = useState<AIProviderId>(profile.aiProvider);
  const [model, setModel] = useState(profile.aiModel);
  const [baseUrl, setBaseUrl] = useState(profile.aiBaseUrl);
  const [aiSchedule, setAiSchedule] = useState<AIScheduleMode>(profile.aiSchedule);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [keySavedFlash, setKeySavedFlash] = useState(false);
  const [liveModels, setLiveModels] = useState<Array<{ id: string; displayName: string }>>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsSource, setModelsSource] = useState<'live' | 'fallback'>('fallback');
  const [customModelMode, setCustomModelMode] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    setProvider(profile.aiProvider);
    setModel(profile.aiModel);
    setBaseUrl(profile.aiBaseUrl);
    setAiSchedule(profile.aiSchedule);
  }, [profile.aiProvider, profile.aiModel, profile.aiBaseUrl, profile.aiSchedule]);

  const preset = AI_PROVIDER_PRESETS[provider];
  const hasStoredKey = state.hasAiApiKey[provider];
  const isAiConfigured = !preset.requiresKey || hasStoredKey;
  const hasAnyKey = !preset.requiresKey || hasStoredKey || apiKeyInput.trim().length > 0;

  const fetchLiveModels = async (
    targetProvider: AIProviderId,
    opts?: { apiKeyOverride?: string; baseUrlOverride?: string; currentModel?: string }
  ) => {
    setLoadingModels(true);
    setAiError(null);
    try {
      const list = await window.portfolioPulse.listAiModels({
        provider: targetProvider,
        apiKeyOverride: opts?.apiKeyOverride,
        baseUrl: opts?.baseUrlOverride ?? (baseUrl || undefined)
      });
      setLiveModels(list);
      setModelsSource('live');

      const activeModel = opts?.currentModel ?? model;
      if (list.length > 0 && !list.some((m) => m.id === activeModel)) {
        const picked = list[0].id;
        setModel(picked);
        setCustomModelMode(false);
        await onSaveProfile({ aiProvider: targetProvider, aiModel: picked });
      }
    } catch (err) {
      setLiveModels([]);
      setModelsSource('fallback');
      setAiError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingModels(false);
    }
  };

  useEffect(() => {
    if (!aiConfigOpen) return;
    const p = AI_PROVIDER_PRESETS[provider];
    if (!p.requiresKey || state.hasAiApiKey[provider]) {
      void fetchLiveModels(provider, {
        baseUrlOverride: profile.aiBaseUrl || undefined,
        currentModel: profile.aiModel
      });
    } else {
      setLiveModels([]);
      setModelsSource('fallback');
    }
  }, [aiConfigOpen, provider, state.hasAiApiKey[provider]]);

  useEffect(() => {
    const trimmed = apiKeyInput.trim();
    if (!preset.requiresKey || trimmed.length < 16) return;
    const timer = setTimeout(() => {
      void fetchLiveModels(provider, {
        apiKeyOverride: trimmed,
        baseUrlOverride: baseUrl.trim() || undefined,
        currentModel: model
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [apiKeyInput, provider]);

  const handleProviderChange = async (next: AIProviderId) => {
    const nextPreset = AI_PROVIDER_PRESETS[next];
    setProvider(next);
    setModel(nextPreset.defaultModel);
    setBaseUrl('');
    setApiKeyInput('');
    setLiveModels([]);
    setModelsSource('fallback');
    setCustomModelMode(false);
    setAiError(null);
    await onSaveProfile({ aiProvider: next, aiModel: nextPreset.defaultModel, aiBaseUrl: '' });
  };

  const handleSaveAiConfig = async () => {
    const trimmedKey = apiKeyInput.trim();
    const chosenModel = model.trim() || liveModels[0]?.id || preset.defaultModel;
    await onSaveProfile({
      aiProvider: provider,
      aiModel: chosenModel,
      aiBaseUrl: baseUrl.trim(),
      aiSchedule
    });
    if (trimmedKey) {
      await onSaveApiKey(provider, trimmedKey);
      setApiKeyInput('');
    }
    setKeySavedFlash(true);
    setTimeout(() => setKeySavedFlash(false), 1600);
  };

  const handleExport = async () => {
    setExportMessage(null);
    await onExportBundle();
    setExportMessage('Export completed.');
    setTimeout(() => setExportMessage(null), 3000);
  };

  const cadenceLabel =
    aiSchedule === 'manual' ? 'On-Demand' : aiSchedule === 'weekly' ? 'Weekly Auto' : 'Daily Auto';

  return (
    <div className="space-y-6">
      {/* Connected Broker MCPs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Broker MCP Connections</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Connect INDmoney, Upstox, or both. Reconnecting automatically refreshes your live holdings, cost basis, and SIPs.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(['indmoney', 'upstox'] as BrokerId[]).map((id) => {
            const b = brokers[id];
            const label =
              id === 'indmoney'
                ? 'INDmoney MCP (Multi-Asset Aggregator)'
                : 'Upstox MCP (Demat Stocks, MFs, SIPs & Margin)';
            const badgeColor =
              b.state === 'connected'
                ? 'bg-emerald-500/15 text-emerald-500'
                : b.state === 'reauth_required'
                ? 'bg-amber-500/15 text-amber-500'
                : b.state === 'error'
                ? 'bg-rose-500/15 text-rose-500'
                : 'bg-slate-500/15 text-slate-400';

            return (
              <div key={id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">{label}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${badgeColor}`}>
                    {b.state.replace('_', ' ')}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">Last synced: {formatTimestamp(b.lastSyncAt)}</p>
                {b.lastError && <p className="mt-1 text-[11px] text-rose-500">{b.lastError}</p>}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void onConnectBroker(id)}
                    disabled={connectingBroker !== null}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {connectingBroker === id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5" />
                    )}
                    {b.state === 'disconnected' ? 'Connect' : 'Reconnect'}
                  </button>
                  {b.state !== 'disconnected' && (
                    <button
                      onClick={() => void onDisconnectBroker(id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      <Unlink className="h-3.5 w-3.5" /> Disconnect
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Collapsible BYOK AI Provider Configuration */}
      <div className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-surface-900">
        <button
          type="button"
          onClick={() => onAiConfigOpenChange(!aiConfigOpen)}
          className="flex w-full items-center justify-between px-5 py-4 text-left"
        >
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-emerald-500" />
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                AI Insights &amp; Q&amp;A Configuration (BYOK)
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  {preset.label} · {model}
                </span>
                {isAiConfigured ? (
                  <span className="inline-flex items-center gap-1 text-emerald-500">
                    <CheckCircle2 className="h-3 w-3" /> Key Ready
                  </span>
                ) : (
                  <span className="text-amber-500">API key not configured</span>
                )}
                <span>· {cadenceLabel}</span>
              </div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {aiConfigOpen ? (
              <>
                Hide <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                Configure <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </span>
        </button>

        {aiConfigOpen && (
          <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Keys are encrypted locally via OS Keychain and sent only to your selected AI provider.
              </p>
              <select
                value={aiSchedule}
                onChange={(e) => {
                  const v = e.target.value as AIScheduleMode;
                  setAiSchedule(v);
                  void onSaveProfile({ aiSchedule: v });
                }}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="manual">AI Cadence: On-Demand Only</option>
                <option value="weekly">AI Cadence: Weekly Auto-Review</option>
                <option value="daily">AI Cadence: Daily Auto-Review</option>
              </select>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div>
                <label className="text-[11px] font-medium text-slate-500">1. Provider</label>
                <select
                  value={provider}
                  onChange={(e) => void handleProviderChange(e.target.value as AIProviderId)}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  {(Object.keys(AI_PROVIDER_PRESETS) as AIProviderId[]).map((id) => (
                    <option key={id} value={id}>
                      {AI_PROVIDER_PRESETS[id].label}
                    </option>
                  ))}
                </select>
              </div>

              {preset.requiresKey ? (
                <div>
                  <label className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                    <span>2. API Key ({preset.label})</span>
                    <div className="flex items-center gap-2">
                      {preset.keyUrl && (
                        <button
                          type="button"
                          onClick={() => void window.portfolioPulse.openExternal(preset.keyUrl)}
                          className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 hover:underline"
                        >
                          Get key <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      )}
                      {hasStoredKey && (
                        <button
                          type="button"
                          onClick={() => void onClearApiKey(provider)}
                          className="text-[10px] text-rose-500 hover:underline"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </label>
                  <div className="relative mt-1">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={hasStoredKey ? '•••••••••••• (saved in Keychain)' : 'Paste API key to load models...'}
                      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-[11px] font-medium text-slate-500">2. Ollama Base URL</label>
                  <input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={preset.defaultBaseUrl}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="flex items-center justify-between text-[11px] font-medium text-slate-500">
                  <span>
                    3. Model{' '}
                    {loadingModels ? (
                      <span className="text-amber-500">(loading…)</span>
                    ) : modelsSource === 'live' && liveModels.length > 0 ? (
                      <span className="text-emerald-500">({liveModels.length} live)</span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCustomModelMode((v) => !v)}
                      className="text-[10px] text-slate-400 hover:text-slate-200 hover:underline"
                    >
                      {customModelMode ? 'Use list' : 'Custom ID'}
                    </button>
                    <button
                      type="button"
                      disabled={loadingModels || !hasAnyKey}
                      onClick={() =>
                        void fetchLiveModels(provider, {
                          apiKeyOverride: apiKeyInput.trim() || undefined,
                          baseUrlOverride: baseUrl.trim() || undefined
                        })
                      }
                      className="inline-flex items-center gap-0.5 text-[10px] text-emerald-500 hover:underline disabled:opacity-40"
                    >
                      <RefreshCw className={`h-2.5 w-2.5 ${loadingModels ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                </label>
                {customModelMode ? (
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={preset.defaultModel}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                ) : !hasAnyKey ? (
                  <div className="mt-1 flex items-center rounded-xl border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs text-slate-400 dark:border-slate-700 dark:bg-slate-900/50">
                    Paste API key to load live models
                  </div>
                ) : (
                  <select
                    value={liveModels.some((m) => m.id === model) ? model : '__custom__'}
                    disabled={loadingModels}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setCustomModelMode(true);
                        return;
                      }
                      setModel(e.target.value);
                      void onSaveProfile({ aiProvider: provider, aiModel: e.target.value });
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  >
                    {liveModels.length === 0 && (
                      <option value="__custom__">
                        {loadingModels ? 'Fetching models from API…' : 'No models loaded — click Refresh or Custom ID'}
                      </option>
                    )}
                    {liveModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id}
                      </option>
                    ))}
                    {liveModels.length > 0 && !liveModels.some((m) => m.id === model) && model && (
                      <option value="__custom__">{model} (Custom)</option>
                    )}
                    <option value="__custom__">Enter custom model ID…</option>
                  </select>
                )}
              </div>

              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void handleSaveAiConfig()}
                  className="w-full rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  {keySavedFlash ? 'Saved ✓' : 'Save AI Settings'}
                </button>
              </div>
            </div>

            {provider === 'openai' && (
              <div className="mt-3">
                <label className="text-[11px] font-medium text-slate-500">
                  Optional Custom OpenAI-Compatible Base URL (e.g. OpenRouter, Groq, LM Studio)
                </label>
                <input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com"
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            )}

            {aiError && (
              <div className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs text-rose-500">
                {aiError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Daily Sync & Notifications */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Daily Refresh &amp; Desktop Notifications
          </h2>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Automated Daily Sync</div>
              <div className="text-[11px] text-slate-500">Runs in background tray + wake catch-up</div>
            </div>
            <input
              type="checkbox"
              checked={profile.enableDailySync}
              onChange={(e) => void onSaveProfile({ enableDailySync: e.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Daily Sync Time (Local)</div>
              <div className="text-[11px] text-slate-500">Recommended: 21:30 (after MF NAV publish)</div>
            </div>
            <input
              type="time"
              value={profile.dailySyncTime}
              onChange={(e) => void onSaveProfile({ dailySyncTime: e.target.value })}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Native OS Notifications</div>
              <div className="text-[11px] text-slate-500">Net worth delta, alerts &amp; OAuth re-link prompts</div>
            </div>
            <input
              type="checkbox"
              checked={profile.enableNotifications}
              onChange={(e) => void onSaveProfile({ enableNotifications: e.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-slate-200 p-3.5 text-xs dark:border-slate-800">
            <div>
              <div className="font-medium text-slate-900 dark:text-white">Launch at Login</div>
              <div className="text-[11px] text-slate-500">Keep Portfolio Pulse resident in menu bar / tray</div>
            </div>
            <input
              type="checkbox"
              checked={profile.launchAtLogin}
              onChange={(e) => void onSaveProfile({ launchAtLogin: e.target.checked })}
              className="h-4 w-4 accent-emerald-500"
            />
          </label>
        </div>

        <button
          onClick={() => void onTestNotification()}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <Bell className="h-3.5 w-3.5 text-emerald-500" /> Send Test Desktop Notification
        </button>
      </div>

      {/* Mode, Export & Reset */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-surface-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Data Portability &amp; Demo Mode</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Export a clean Markdown dashboard + JSON bundle anytime, or switch into Demo Mode without affecting live data.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={() => void handleExport()}
              disabled={!state.latestSnapshot}
              className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
            >
              <Download className="h-3.5 w-3.5" /> Export Markdown + JSON
            </button>
            <button
              onClick={() => void onToggleDemo(!state.isDemoMode)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              {state.isDemoMode ? 'Exit Demo Mode' : 'Switch to Demo Mode'}
            </button>
          </div>
          {exportMessage && <p className="mt-2 text-xs text-emerald-500">{exportMessage}</p>}
        </div>

        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5">
          <h2 className="text-sm font-semibold text-rose-600 dark:text-rose-400">Danger Zone — Reset Local Data</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Deletes all local SQLite snapshots, audit history, encrypted OAuth tokens, and saved BYOK AI keys on this computer.
          </p>
          <div className="mt-4">
            {!confirmWipe ? (
              <button
                onClick={() => setConfirmWipe(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-4 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" /> Wipe All Local Data
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await onWipeAllData();
                    setConfirmWipe(false);
                  }}
                  className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
                >
                  Confirm Permanent Wipe
                </button>
                <button
                  onClick={() => setConfirmWipe(false)}
                  className="rounded-xl px-3 py-2 text-xs text-slate-500 hover:underline"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
