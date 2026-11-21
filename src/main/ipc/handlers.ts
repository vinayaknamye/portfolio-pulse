import fs from 'fs';
import path from 'path';
import { app, dialog, ipcMain, BrowserWindow, shell } from 'electron';
import {
  AIProviderId,
  AppStatePayload,
  BrokerId,
  CostBasisOverride,
  SipBaselineItem,
  SymbolAlias,
  UserProfile
} from '@shared/types';
import { PortfolioRepository } from '@main/db/repository';
import { SecureStore } from '@main/db/secureStore';
import { IndmoneyAdapter } from '@main/mcp/indmoneyAdapter';
import { UpstoxAdapter } from '@main/mcp/upstoxAdapter';
import { SyncOrchestrator } from '@main/engine/syncOrchestrator';
import { DailySyncScheduler } from '@main/engine/scheduler';
import { ensureDemoSeeded } from '@main/demo/demoDataset';
import { buildPortfolioContextBlock, buildReviewPrompt, buildSystemPrompt } from '@main/ai/promptBuilder';
import { listProviderModels, runLLMCompletion } from '@main/ai/providers';
import { exportPortfolioBundle } from '@main/engine/exporter';
import { applyCostOverridesToSnapshot } from '@main/engine/reconciler';
import { parseBrokerHoldingsCsv } from '@main/engine/csvCostParser';
import { runPortfolioAudit } from '@main/engine/auditor';

export interface IpcContext {
  repo: PortfolioRepository;
  store: SecureStore;
  indmoney: IndmoneyAdapter;
  upstox: UpstoxAdapter;
  orchestrator: SyncOrchestrator;
  scheduler: DailySyncScheduler;
  getWindow: () => BrowserWindow | null;
}

export function buildAppState(ctx: IpcContext): AppStatePayload {
  const { repo, store } = ctx;
  const isDemoMode = repo.isDemoMode();
  const profile = repo.getProfile();

  if (isDemoMode) {
    ensureDemoSeeded(repo, profile);
  }

  const providers: AIProviderId[] = ['claude', 'gemini', 'openai', 'ollama'];
  const hasAiApiKey: Record<AIProviderId, boolean> = {
    claude: false,
    gemini: false,
    openai: false,
    ollama: true
  };
  for (const p of providers) {
    if (p !== 'ollama') {
      hasAiApiKey[p] = store.hasSecret(`ai_key:${p}`);
    }
  }

  return {
    isDemoMode,
    profile,
    brokers: repo.getBrokerStatuses(),
    hasAiApiKey,
    latestSnapshot: repo.getLatestSnapshot(isDemoMode),
    history: repo.getSnapshotHistory(isDemoMode),
    alerts: repo.getAlerts(isDemoMode),
    sipBaselines: repo.getSipBaselines(isDemoMode),
    aliases: repo.getAliases(),
    costOverrides: repo.getCostOverrides(),
    reports: repo.getAIReports(isDemoMode),
    chatMessages: repo.getChatMessages(isDemoMode)
  };
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const { repo, store, indmoney, upstox, orchestrator, scheduler } = ctx;

  const broadcastState = () => {
    const win = ctx.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('app:stateUpdated', buildAppState(ctx));
    }
  };

  ipcMain.handle('app:getState', () => buildAppState(ctx));

  ipcMain.handle('app:setDemoMode', (_event, enabled: boolean) => {
    repo.setDemoMode(Boolean(enabled));
    if (enabled) {
      ensureDemoSeeded(repo, repo.getProfile());
    }
    const state = buildAppState(ctx);
    broadcastState();
    return state;
  });

  ipcMain.handle('profile:save', (_event, partial: Partial<UserProfile>) => {
    const prevLaunch = repo.getProfile().launchAtLogin;
    const updated = repo.saveProfile(partial);
    if (partial.launchAtLogin !== undefined && partial.launchAtLogin !== prevLaunch) {
      try {
        app.setLoginItemSettings({ openAtLogin: Boolean(updated.launchAtLogin) });
      } catch {
        // Ignore on unsupported dev environments
      }
    }
    broadcastState();
    return updated;
  });

  ipcMain.handle('broker:connect', async (_event, broker: BrokerId) => {
    try {
      if (broker === 'indmoney') {
        await indmoney.connectAndAuthenticate();
      } else {
        await upstox.connectAndAuthenticate();
      }
      repo.setBrokerStatus({
        broker,
        state: 'connected',
        lastSyncAt: repo.getBrokerStatuses()[broker].lastSyncAt,
        lastError: null
      });
      // Switch out of Demo Mode when user links a real account
      if (repo.isDemoMode()) {
        repo.setDemoMode(false);
      }
      broadcastState();
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      repo.setBrokerStatus({
        broker,
        state: 'error',
        lastSyncAt: repo.getBrokerStatuses()[broker].lastSyncAt,
        lastError: msg
      });
      broadcastState();
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('broker:disconnect', (_event, broker: BrokerId) => {
    if (broker === 'indmoney') indmoney.disconnect();
    else upstox.disconnect();
    repo.setBrokerStatus({
      broker,
      state: 'disconnected',
      lastSyncAt: null,
      lastError: null
    });
    broadcastState();
    return buildAppState(ctx);
  });

  ipcMain.handle('sync:run', async (_event, opts?: { interactive?: boolean }) => {
    const result = await orchestrator.sync({
      interactive: opts?.interactive ?? true,
      source: 'manual'
    });
    broadcastState();
    return result;
  });

  ipcMain.handle('alert:dismiss', (_event, alertId: string) => {
    repo.dismissAlert(alertId);
    broadcastState();
    return true;
  });

  ipcMain.handle('sip:saveBaselines', (_event, items: SipBaselineItem[]) => {
    repo.saveSipBaselines(repo.isDemoMode(), items);
    broadcastState();
    return repo.getSipBaselines(repo.isDemoMode());
  });

  ipcMain.handle('sip:resetBaselinesFromLive', () => {
    const isDemo = repo.isDemoMode();
    const latest = repo.getLatestSnapshot(isDemo);
    if (!latest) return [];
    const items: SipBaselineItem[] = latest.activeSips.map((s) => ({
      fundName: s.fundName,
      expectedAmount: s.amount,
      expectedFrequency: s.frequency,
      active: true
    }));
    repo.saveSipBaselines(isDemo, items);
    broadcastState();
    return items;
  });

  ipcMain.handle('alias:save', (_event, alias: SymbolAlias) => {
    repo.saveAlias(alias);
    broadcastState();
    return repo.getAliases();
  });

  ipcMain.handle('alias:delete', (_event, indmoneyName: string) => {
    repo.deleteAlias(indmoneyName);
    broadcastState();
    return repo.getAliases();
  });

  const reapplyOverridesToCurrentSnapshot = (): number => {
    const isDemo = repo.isDemoMode();
    const latest = repo.getLatestSnapshot(isDemo);
    if (!latest) return 0;
    const overrides = repo.getCostOverrides();
    const { snapshot: updatedSnap, matchedCount } = applyCostOverridesToSnapshot(latest, overrides);
    if (matchedCount > 0) {
      const id = repo.saveSnapshot(updatedSnap);
      const prev = repo.getPreviousSnapshot(isDemo, updatedSnap.snapshotDate);
      const alerts = runPortfolioAudit({
        current: { ...updatedSnap, id },
        previous: prev,
        profile: repo.getProfile(),
        sipBaselines: repo.getSipBaselines(isDemo)
      });
      repo.replaceAlertsForSnapshot(isDemo, id, alerts);
    }
    return matchedCount;
  };

  ipcMain.handle(
    'costOverride:save',
    (
      _event,
      payload: {
        holdingKey: string;
        displayName: string;
        symbol?: string;
        isin?: string;
        broker?: string;
        averagePrice: number;
      }
    ) => {
      if (!Number.isFinite(payload.averagePrice) || payload.averagePrice <= 0) {
        throw new Error('Average cost must be a positive number.');
      }
      const override: CostBasisOverride = {
        holdingKey: payload.holdingKey,
        displayName: payload.displayName,
        symbol: payload.symbol,
        isin: payload.isin,
        broker: payload.broker,
        averagePrice: Math.round((payload.averagePrice + Number.EPSILON) * 100) / 100,
        source: 'manual',
        updatedAt: new Date().toISOString()
      };
      repo.saveCostOverride(override);
      reapplyOverridesToCurrentSnapshot();
      broadcastState();
      return repo.getCostOverrides();
    }
  );

  ipcMain.handle('costOverride:delete', (_event, holdingKey: string) => {
    repo.deleteCostOverride(holdingKey);
    broadcastState();
    return repo.getCostOverrides();
  });

  ipcMain.handle('costOverride:importCsv', async () => {
    const win = ctx.getWindow();
    const openOptions: Electron.OpenDialogOptions = {
      title: 'Import Broker Holdings CSV (Paytm Money, Zerodha, Groww, Upstox, Generic)',
      properties: ['openFile'],
      filters: [{ name: 'CSV Files', extensions: ['csv', 'txt'] }]
    };
    const picked = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);

    if (picked.canceled || picked.filePaths.length === 0) {
      return { canceled: true };
    }

    const filePath = picked.filePaths[0];
    const fileName = path.basename(filePath);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseBrokerHoldingsCsv(content);
      if (parsed.length === 0) {
        return {
          canceled: false,
          fileName,
          parsedCount: 0,
          matchedInSnapshot: 0,
          error: 'No valid holdings with average buy price were found in that CSV.'
        };
      }
      repo.saveCostOverridesBulk(parsed);
      const matchedInSnapshot = reapplyOverridesToCurrentSnapshot();
      broadcastState();
      return {
        canceled: false,
        fileName,
        parsedCount: parsed.length,
        matchedInSnapshot
      };
    } catch (err) {
      return {
        canceled: false,
        fileName,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  ipcMain.handle('ai:saveApiKey', (_event, payload: { provider: AIProviderId; apiKey: string }) => {
    if (payload.apiKey.trim()) {
      store.setSecret(`ai_key:${payload.provider}`, payload.apiKey.trim());
    } else {
      store.deleteSecret(`ai_key:${payload.provider}`);
    }
    broadcastState();
    return true;
  });

  ipcMain.handle('ai:clearApiKey', (_event, provider: AIProviderId) => {
    store.deleteSecret(`ai_key:${provider}`);
    broadcastState();
    return true;
  });

  ipcMain.handle(
    'ai:listModels',
    async (_event, payload: { provider: AIProviderId; apiKeyOverride?: string; baseUrl?: string }) => {
      const storedKey = store.getSecret(`ai_key:${payload.provider}`);
      const apiKey = payload.apiKeyOverride?.trim() || storedKey;
      return listProviderModels({
        provider: payload.provider,
        apiKey,
        baseUrl: payload.baseUrl
      });
    }
  );

  ipcMain.handle('ai:generateReport', async () => {
    const isDemo = repo.isDemoMode();
    const snapshot = repo.getLatestSnapshot(isDemo);
    if (!snapshot) {
      throw new Error('No portfolio snapshot available yet. Sync your portfolio or enable Demo Mode first.');
    }

    const profile = repo.getProfile();
    const previous = repo.getPreviousSnapshot(isDemo, snapshot.snapshotDate);
    const alerts = repo.getAlerts(isDemo);
    const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);

    const contextBlock = buildPortfolioContextBlock(snapshot, previous, alerts, profile);
    const completion = await runLLMCompletion({
      provider: profile.aiProvider,
      model: profile.aiModel,
      apiKey,
      baseUrl: profile.aiBaseUrl || undefined,
      systemPrompt: buildSystemPrompt(),
      messages: [{ role: 'user', content: buildReviewPrompt(contextBlock) }]
    });

    const report = repo.saveAIReport({
      isDemo,
      provider: completion.provider,
      model: completion.model,
      createdAt: new Date().toISOString(),
      title: `Portfolio Review (${snapshot.snapshotDate})`,
      markdown: completion.text
    });
    broadcastState();
    return report;
  });

  ipcMain.handle('ai:sendChat', async (_event, userPrompt: string) => {
    const trimmed = userPrompt.trim();
    if (!trimmed) throw new Error('Message cannot be empty.');

    const isDemo = repo.isDemoMode();
    const snapshot = repo.getLatestSnapshot(isDemo);
    if (!snapshot) {
      throw new Error('Sync your portfolio or enable Demo Mode before chatting.');
    }

    const profile = repo.getProfile();
    const previous = repo.getPreviousSnapshot(isDemo, snapshot.snapshotDate);
    const alerts = repo.getAlerts(isDemo);
    const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);

    const priorHistory = repo.getChatMessages(isDemo, 16);
    const userMsg = repo.addChatMessage(isDemo, {
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString()
    });

    const contextBlock = buildPortfolioContextBlock(snapshot, previous, alerts, profile);
    const systemPrompt = `${buildSystemPrompt()}\n\nCurrent Investor Portfolio Context:\n${contextBlock}`;

    try {
      const completion = await runLLMCompletion({
        provider: profile.aiProvider,
        model: profile.aiModel,
        apiKey,
        baseUrl: profile.aiBaseUrl || undefined,
        systemPrompt,
        messages: [
          ...priorHistory.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: trimmed }
        ]
      });

      const assistantMsg = repo.addChatMessage(isDemo, {
        role: 'assistant',
        content: completion.text,
        createdAt: new Date().toISOString()
      });
      broadcastState();
      return { userMsg, assistantMsg };
    } catch (err) {
      broadcastState();
      throw err;
    }
  });

  ipcMain.handle('ai:clearChat', () => {
    repo.clearChatMessages(repo.isDemoMode());
    broadcastState();
    return true;
  });

  ipcMain.handle('export:bundle', async () => {
    const isDemo = repo.isDemoMode();
    const snapshot = repo.getLatestSnapshot(isDemo);
    if (!snapshot) {
      throw new Error('No snapshot to export yet.');
    }

    const win = ctx.getWindow();
    const openOptions: Electron.OpenDialogOptions = {
      title: 'Choose Export Folder for Portfolio Pulse Bundle',
      properties: ['openDirectory', 'createDirectory']
    };
    const picked = win
      ? await dialog.showOpenDialog(win, openOptions)
      : await dialog.showOpenDialog(openOptions);
    if (picked.canceled || picked.filePaths.length === 0) {
      return { canceled: true };
    }

    const res = exportPortfolioBundle(
      picked.filePaths[0],
      snapshot,
      repo.getAlerts(isDemo),
      repo.getProfile()
    );
    return { canceled: false, ...res };
  });

  ipcMain.handle('notification:test', () => {
    const isDemo = repo.isDemoMode();
    const snapshot = repo.getLatestSnapshot(isDemo);
    const nwText = snapshot ? `₹${(snapshot.totalNetworth / 1e7).toFixed(2)} Cr` : 'Ready';
    scheduler.sendNativeNotification(
      `Portfolio Pulse · Test Notification (${nwText})`,
      'Daily post-market notifications are working cleanly on this machine.'
    );
    return true;
  });

  ipcMain.handle('app:wipeAllData', () => {
    repo.wipeAllData();
    store.clearAll();
    broadcastState();
    return buildAppState(ctx);
  });

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    if (/^https:\/\//i.test(url)) {
      await shell.openExternal(url);
    }
    return true;
  });
}
