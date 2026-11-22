import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Briefcase,
  LayoutDashboard,
  Loader2,
  Moon,
  RefreshCw,
  Repeat,
  Settings as SettingsIcon,
  Sparkles,
  Sun
} from 'lucide-react';
import {
  AdvisorTopic,
  AIProviderId,
  AppStatePayload,
  BrokerId,
  CsvImportResult,
  InsurancePolicy,
  SipBaselineItem,
  SymbolAlias,
  UserProfile
} from '@shared/types';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { Holdings } from './pages/Holdings';
import { SipsAndAudit } from './pages/SipsAndAudit';
import { Strategy } from './pages/Strategy';
import { Insights, InsightsSubTab } from './pages/Insights';
import { Settings } from './pages/Settings';
import { FloatingChat } from './components/FloatingChat';
import { formatTimestamp } from './lib/format';

type NavTab = 'dashboard' | 'holdings' | 'audit' | 'strategy' | 'insights' | 'settings';

export default function App() {
  const [state, setState] = useState<AppStatePayload | null>(null);
  const [tab, setTab] = useState<NavTab>('dashboard');
  const [insightsSubTab, setInsightsSubTab] = useState<InsightsSubTab>('alerts');
  const [lastCsvImport, setLastCsvImport] = useState<CsvImportResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [connectingBroker, setConnectingBroker] = useState<BrokerId | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 4500);
  };

  useEffect(() => {
    void window.portfolioPulse.getState().then(setState);
    const unsub = window.portfolioPulse.onStateUpdated((next) => setState(next));
    return unsub;
  }, []);

  useEffect(() => {
    if (!state) return;
    const root = document.documentElement;
    if (state.profile.theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [state?.profile.theme]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-950 text-slate-300">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
      </div>
    );
  }

  const showOnboarding = !state.latestSnapshot && !state.isDemoMode;

  const handleSaveProfile = async (partial: Partial<UserProfile>) => {
    await window.portfolioPulse.saveProfile(partial);
  };

  const handleConnectBroker = async (broker: BrokerId) => {
    setConnectingBroker(broker);
    try {
      const res = await window.portfolioPulse.connectBroker(broker);
      if (!res.success) {
        showToast('err', res.error || `Failed to link ${broker}`);
      } else {
        showToast('ok', `${broker === 'indmoney' ? 'INDmoney' : 'Upstox'} connected!`);
        if (!showOnboarding) {
          void handleSyncNow();
        }
      }
    } finally {
      setConnectingBroker(null);
    }
  };

  const handleDisconnectBroker = async (broker: BrokerId) => {
    await window.portfolioPulse.disconnectBroker(broker);
    showToast('ok', `Disconnected ${broker}.`);
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const res = await window.portfolioPulse.runSync({ interactive: true });
      if (!res.success) {
        showToast('err', res.error || 'Portfolio sync failed.');
      } else if (res.upstoxState === 'stale_reauth_required') {
        showToast('err', 'INDmoney synced, but Upstox session expired — reconnect Upstox.');
      } else {
        showToast('ok', 'Portfolio synced and reconciled!');
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleDemo = async (enabled: boolean) => {
    const next = await window.portfolioPulse.setDemoMode(enabled);
    setState(next);
    if (enabled) setTab('dashboard');
  };

  const handleDismissAlert = async (id: string) => {
    await window.portfolioPulse.dismissAlert(id);
  };

  const handleSaveBaselines = async (items: SipBaselineItem[]) => {
    await window.portfolioPulse.saveSipBaselines(items);
  };

  const handleResetBaselines = async () => {
    await window.portfolioPulse.resetSipBaselinesFromLive();
  };

  const handleSaveAlias = async (alias: SymbolAlias) => {
    await window.portfolioPulse.saveAlias(alias);
    showToast('ok', `Alias saved: ${alias.indmoneyName} → ${alias.upstoxSymbol}. Re-sync to apply.`);
  };

  const handleDeleteAlias = async (indmoneyName: string) => {
    await window.portfolioPulse.deleteAlias(indmoneyName);
  };

  const handleSaveCostOverride = async (payload: {
    holdingKey: string;
    displayName: string;
    symbol?: string;
    isin?: string;
    broker?: string;
    averagePrice: number;
  }) => {
    await window.portfolioPulse.saveCostOverride(payload);
    showToast('ok', `Updated avg cost for ${payload.displayName}`);
  };

  const handleDeleteCostOverride = async (holdingKey: string) => {
    await window.portfolioPulse.deleteCostOverride(holdingKey);
    showToast('ok', 'Removed cost override. Click Sync Now to restore broker default.');
  };

  const handleImportCostCsv = async () => {
    const res = await window.portfolioPulse.importCostCsv();
    if (res.canceled) return;
    if (res.error) {
      showToast('err', res.error);
      return;
    }
    setLastCsvImport(res);
    showToast(
      'ok',
      `Imported ${res.parsedCount} avg costs from ${res.fileName} (${res.matchedInSnapshot} matched to live holdings).`
    );
  };

  const handleSaveInsurancePolicy = async (policy: InsurancePolicy) => {
    await window.portfolioPulse.saveInsurancePolicy(policy);
    showToast('ok', `Saved policy: ${policy.insurer} — ${policy.planName}`);
  };

  const handleDeleteInsurancePolicy = async (id: number) => {
    await window.portfolioPulse.deleteInsurancePolicy(id);
    showToast('ok', 'Removed insurance policy.');
  };

  const handleSaveApiKey = async (provider: AIProviderId, apiKey: string) => {
    await window.portfolioPulse.saveAiApiKey(provider, apiKey);
  };

  const handleClearApiKey = async (provider: AIProviderId) => {
    await window.portfolioPulse.clearAiApiKey(provider);
  };

  const handleGenerateReport = async () => {
    await window.portfolioPulse.generateAiReport();
  };

  const handleValidateAdvisorInput = async (payload: {
    topic: AdvisorTopic;
    advisorName?: string;
    pitchText: string;
  }) => {
    return window.portfolioPulse.validateAdvisorInput(payload);
  };

  const handleSendChat = async (message: string) => {
    await window.portfolioPulse.sendAiChat(message);
  };

  const handleClearChat = async () => {
    await window.portfolioPulse.clearAiChat();
  };

  const handleExportBundle = async () => {
    const res = await window.portfolioPulse.exportBundle();
    if (!res.canceled && res.directory) {
      showToast('ok', `Exported bundle to ${res.directory}`);
    }
  };

  const handleTestNotification = async () => {
    await window.portfolioPulse.sendTestNotification();
  };

  const handleWipeAllData = async () => {
    const next = await window.portfolioPulse.wipeAllData();
    setState(next);
    setLastCsvImport(null);
    setTab('dashboard');
    showToast('ok', 'All local data wiped.');
  };

  const activeAlertCount = state.alerts.filter((a) => !a.dismissed && a.severity !== 'info').length;
  const needsUpstoxRelink =
    !state.isDemoMode &&
    (state.brokers.upstox.state === 'reauth_required' ||
      state.latestSnapshot?.upstoxState === 'stale_reauth_required');

  const needsUpstoxInitialSync =
    !state.isDemoMode &&
    state.brokers.upstox.state === 'connected' &&
    state.latestSnapshot?.upstoxState === 'not_linked';

  const openAiSettingsInTab = () => {
    setChatOpen(false);
    setTab('settings');
    setAiConfigOpen(true);
  };

  const handleNavigate = (
    nextTab: 'holdings' | 'audit' | 'insights' | 'strategy' | 'settings',
    opts?: { insightsSubTab?: InsightsSubTab }
  ) => {
    if (nextTab === 'insights' && opts?.insightsSubTab) {
      setInsightsSubTab(opts.insightsSubTab);
    }
    setTab(nextTab);
  };

  const customDisplayName = state.profile.displayName?.trim();
  const showNameBadge = Boolean(customDisplayName && customDisplayName.toLowerCase() !== 'investor');

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
    { id: 'holdings', label: 'Holdings', icon: <Briefcase className="h-4 w-4" /> },
    { id: 'audit', label: 'SIPs', icon: <Repeat className="h-4 w-4" /> },
    { id: 'insights', label: 'Insights & Alerts', icon: <Sparkles className="h-4 w-4" />, badge: activeAlertCount },
    { id: 'strategy', label: 'Strategy & Cover', icon: <BookOpen className="h-4 w-4" /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="h-4 w-4" /> }
  ];

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 dark:bg-surface-950 dark:text-slate-100">
      {/* Top Drag Titlebar */}
      <header className="app-drag flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white/90 px-4 pl-20 backdrop-blur dark:border-slate-800/80 dark:bg-surface-900/90">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500 text-white">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <span className="text-sm font-bold tracking-tight">Portfolio Pulse</span>
          {showNameBadge && !state.isDemoMode && (
            <span className="hidden rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300 sm:inline">
              {customDisplayName}
            </span>
          )}
          {state.isDemoMode && (
            <span className="app-no-drag rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              DEMO MODE
            </span>
          )}
        </div>

        <div className="app-no-drag flex items-center gap-2">
          {state.latestSnapshot && (
            <span className="hidden text-[11px] text-slate-500 sm:inline">
              Synced {formatTimestamp(state.latestSnapshot.fetchedAt)}
            </span>
          )}

          {!showOnboarding && (
            <button
              onClick={() => void handleSyncNow()}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Sync Now
            </button>
          )}

          <button
            onClick={() =>
              void handleSaveProfile({ theme: state.profile.theme === 'dark' ? 'light' : 'dark' })
            }
            className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            title="Toggle Dark / Light Theme"
          >
            {state.profile.theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </button>
        </div>
      </header>

      {/* Main Body */}
      {showOnboarding ? (
        <main className="flex-1 overflow-hidden">
          <Onboarding
            state={state}
            onSyncNow={handleSyncNow}
            onEnableDemo={() => handleToggleDemo(true)}
            onConnectBroker={handleConnectBroker}
            connectingBroker={connectingBroker}
            syncing={syncing}
          />
        </main>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <aside className="flex w-52 shrink-0 flex-col justify-between border-r border-slate-200 bg-white p-3 dark:border-slate-800/80 dark:bg-surface-900">
            <nav className="space-y-1">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setTab(item.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition ${
                    tab === item.id
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {item.icon}
                    {item.label}
                  </span>
                  {item.badge && item.badge > 0 ? (
                    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              ))}
            </nav>

            <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
              {state.isDemoMode ? (
                <button
                  onClick={() => void handleToggleDemo(false)}
                  className="w-full rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                >
                  Exit Demo → Connect Live Accounts
                </button>
              ) : (
                <div className="space-y-1 px-2 text-[11px] text-slate-500 dark:text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>INDmoney</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        state.brokers.indmoney.state === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'
                      }`}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Upstox</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        state.brokers.upstox.state === 'connected'
                          ? 'bg-emerald-500'
                          : state.brokers.upstox.state === 'reauth_required'
                          ? 'bg-amber-500'
                          : 'bg-slate-500'
                      }`}
                    />
                  </div>
                </div>
              )}
            </div>
          </aside>

          {/* Content Scroll Area */}
          <main className="flex-1 overflow-y-auto p-6">
            {needsUpstoxRelink && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-800 dark:text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                  <span>
                    <strong>Upstox session expired:</strong> INDmoney synced cleanly and your last Upstox cost basis was carried forward. Re-link Upstox to refresh live margin &amp; demat holdings.
                  </span>
                </div>
                <button
                  onClick={() => void handleConnectBroker('upstox').then(() => handleSyncNow())}
                  disabled={connectingBroker !== null || syncing}
                  className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  Reconnect Upstox
                </button>
              </div>
            )}

            {needsUpstoxInitialSync && (
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-800 dark:text-emerald-200">
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>
                    <strong>Upstox is connected:</strong> Sync now to pull live demat average buy prices, P&amp;L, and available margin into your holdings.
                  </span>
                </div>
                <button
                  onClick={() => void handleSyncNow()}
                  disabled={syncing}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                >
                  Sync Upstox Now
                </button>
              </div>
            )}

            {tab === 'dashboard' && (
              <Dashboard state={state} onNavigate={handleNavigate} onDismissAlert={handleDismissAlert} />
            )}
            {tab === 'holdings' && (
              <Holdings
                state={state}
                lastCsvImport={lastCsvImport}
                onDismissCsvImport={() => setLastCsvImport(null)}
                onSaveAlias={handleSaveAlias}
                onDeleteAlias={handleDeleteAlias}
                onSaveCostOverride={handleSaveCostOverride}
                onDeleteCostOverride={handleDeleteCostOverride}
                onImportCostCsv={handleImportCostCsv}
              />
            )}
            {tab === 'audit' && (
              <SipsAndAudit
                state={state}
                onSaveBaselines={handleSaveBaselines}
                onResetBaselines={handleResetBaselines}
                onOpenAlerts={() => handleNavigate('insights', { insightsSubTab: 'alerts' })}
              />
            )}
            {tab === 'strategy' && (
              <Strategy
                state={state}
                onSaveProfile={handleSaveProfile}
                onSaveInsurancePolicy={handleSaveInsurancePolicy}
                onDeleteInsurancePolicy={handleDeleteInsurancePolicy}
              />
            )}
            {tab === 'insights' && (
              <Insights
                state={state}
                subTab={insightsSubTab}
                onSubTabChange={setInsightsSubTab}
                onDismissAlert={handleDismissAlert}
                onOpenAiSettings={openAiSettingsInTab}
                onOpenFloatingChat={() => setChatOpen(true)}
                onGenerateReport={handleGenerateReport}
                onValidateAdvisorInput={handleValidateAdvisorInput}
              />
            )}
            {tab === 'settings' && (
              <Settings
                state={state}
                aiConfigOpen={aiConfigOpen}
                onAiConfigOpenChange={setAiConfigOpen}
                onSaveProfile={handleSaveProfile}
                onSaveApiKey={handleSaveApiKey}
                onClearApiKey={handleClearApiKey}
                onConnectBroker={handleConnectBroker}
                onDisconnectBroker={handleDisconnectBroker}
                onToggleDemo={handleToggleDemo}
                onExportBundle={handleExportBundle}
                onTestNotification={handleTestNotification}
                onWipeAllData={handleWipeAllData}
                connectingBroker={connectingBroker}
              />
            )}
          </main>
        </div>
      )}

      {/* Global Floating AI Q&A Chat (accessible from any section) */}
      {!showOnboarding && state.latestSnapshot && (
        <FloatingChat
          state={state}
          activeTab={tab}
          open={chatOpen}
          onOpenChange={setChatOpen}
          onSendChat={handleSendChat}
          onClearChat={handleClearChat}
          onOpenAiConfig={openAiSettingsInTab}
        />
      )}

      {/* Subtle Toast */}
      {toast && (
        <div
          className={`fixed bottom-20 right-5 z-50 rounded-xl border px-4 py-2.5 text-xs font-medium shadow-lg ${
            toast.kind === 'ok'
              ? 'border-emerald-500/30 bg-emerald-950/95 text-emerald-200'
              : 'border-rose-500/30 bg-rose-950/95 text-rose-200'
          }`}
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}
