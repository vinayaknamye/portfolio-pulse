import fs from 'fs';
import path from 'path';
import { app, dialog, ipcMain, BrowserWindow, shell } from 'electron';
import {
  AdvisorAttachment,
  AdvisorTopic,
  AIProviderId,
  AppStatePayload,
  BrokerId,
  CostBasisOverride,
  DocumentBinaryPayload,
  InsuranceDocument,
  InsuranceDocumentType,
  InsurancePolicy,
  LocalCliToolId,
  ParsedPolicySuggestion,
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
import {
  buildAdvisorValidationPrompt,
  buildPortfolioContextBlock,
  buildReviewPrompt,
  buildSystemPrompt
} from '@main/ai/promptBuilder';
import { listProviderModels, LLMAttachment, runLLMCompletion } from '@main/ai/providers';
import { detectLocalCliTools } from '@main/ai/localCli';
import { exportPortfolioBundle } from '@main/engine/exporter';
import { applyCostOverridesToSnapshot } from '@main/engine/reconciler';
import { inferBrokerFromFilename, parseBrokerHoldingsCsv } from '@main/engine/csvCostParser';
import { runPortfolioAudit } from '@main/engine/auditor';
import {
  copyInsuranceDocToVault,
  deleteVaultFile,
  detectMimeType,
  extractFileContent,
  MAX_ATTACHMENT_BYTES,
  readVaultFileBase64,
  resolveVaultFilePath,
  wipeVault
} from '@main/engine/documentVault';
import { parseInsuranceDocument } from '@main/engine/policyParser';

export interface IpcContext {
  userDataDir: string;
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

  const providers: AIProviderId[] = ['claude', 'gemini', 'openai', 'ollama', 'local_cli'];
  const hasAiApiKey: Record<AIProviderId, boolean> = {
    claude: false,
    gemini: false,
    openai: false,
    ollama: true,
    local_cli: true
  };
  for (const p of providers) {
    if (p !== 'ollama' && p !== 'local_cli') {
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
    insurancePolicies: repo.getInsurancePolicies(isDemoMode),
    reports: repo.getAIReports(isDemoMode),
    chatMessages: repo.getChatMessages(isDemoMode)
  };
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const { userDataDir, repo, store, indmoney, upstox, orchestrator, scheduler } = ctx;

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
      // Always clear any stale OAuth tokens/client registration when explicitly connecting so browser sign-in starts fresh
      if (broker === 'indmoney') indmoney.disconnect();
      else upstox.disconnect();
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

  const reapplyOverridesToCurrentSnapshot = (): { matchedCount: number; matchedOverrideKeys: Set<string> } => {
    const isDemo = repo.isDemoMode();
    const latest = repo.getLatestSnapshot(isDemo);
    if (!latest) return { matchedCount: 0, matchedOverrideKeys: new Set() };
    const overrides = repo.getCostOverrides();
    const { snapshot: updatedSnap, matchedCount, matchedOverrideKeys } = applyCostOverridesToSnapshot(latest, overrides);
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
    return { matchedCount, matchedOverrideKeys: new Set(matchedOverrideKeys) };
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
    const detectedBroker = inferBrokerFromFilename(fileName);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseBrokerHoldingsCsv(content, detectedBroker);
      if (parsed.length === 0) {
        return {
          canceled: false,
          fileName,
          detectedBroker,
          parsedCount: 0,
          matchedInSnapshot: 0,
          unmatchedNames: [],
          error: 'No valid holdings with average buy price were found in that CSV.'
        };
      }
      repo.saveCostOverridesBulk(parsed);
      const { matchedOverrideKeys } = reapplyOverridesToCurrentSnapshot();
      const matchedFromFile = parsed.filter((p) => matchedOverrideKeys.has(p.holdingKey));
      const unmatchedNames = parsed
        .filter((p) => !matchedOverrideKeys.has(p.holdingKey))
        .map((p) => p.displayName);
      broadcastState();
      return {
        canceled: false,
        fileName,
        detectedBroker,
        parsedCount: parsed.length,
        matchedInSnapshot: matchedFromFile.length,
        unmatchedNames
      };
    } catch (err) {
      return {
        canceled: false,
        fileName,
        detectedBroker,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  ipcMain.handle(
    'insurance:save',
    (
      _event,
      payload:
        | {
            policy: InsurancePolicy;
            pendingDoc?: { filePath: string; docType: InsuranceDocumentType; docDate?: string; notes?: string };
          }
        | InsurancePolicy
    ) => {
      const isDemo = repo.isDemoMode();
      const policy = 'policy' in payload ? payload.policy : payload;
      const pendingDoc = 'policy' in payload ? payload.pendingDoc : undefined;

      if (!policy.insurer.trim() || !policy.planName.trim()) {
        throw new Error('Insurer and Plan Name are required.');
      }
      const saved = repo.saveInsurancePolicy(isDemo, policy);
      if (pendingDoc?.filePath && saved.id) {
        const stored = copyInsuranceDocToVault(userDataDir, saved.id, pendingDoc.filePath);
        repo.addInsuranceDocument({
          policyId: saved.id,
          docType: pendingDoc.docType || 'policy',
          fileName: stored.fileName,
          storedRelPath: stored.storedRelPath,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          docDate: pendingDoc.docDate || policy.renewalDate || '',
          notes: pendingDoc.notes || ''
        });
      }
      broadcastState();
      return repo.getInsurancePolicies(isDemo);
    }
  );

  ipcMain.handle('insurance:delete', (_event, id: number) => {
    const isDemo = repo.isDemoMode();
    const removedPaths = repo.deleteInsurancePolicy(id);
    for (const rel of removedPaths) {
      deleteVaultFile(userDataDir, rel);
    }
    broadcastState();
    return repo.getInsurancePolicies(isDemo);
  });

  ipcMain.handle(
    'insurance:pickAndParseDoc',
    async (_event, opts?: { docType?: InsuranceDocumentType }): Promise<ParsedPolicySuggestion> => {
      const win = ctx.getWindow();
      const openOptions: Electron.OpenDialogOptions = {
        title: 'Select Insurance Policy or Renewal Document (PDF, Image, Text)',
        properties: ['openFile'],
        filters: [
          { name: 'Policy Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };
      const picked = win
        ? await dialog.showOpenDialog(win, openOptions)
        : await dialog.showOpenDialog(openOptions);

      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true };
      }

      const filePath = picked.filePaths[0];
      try {
        const extracted = await extractFileContent(filePath);
        const profile = repo.getProfile();
        const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);
        const parsed = await parseInsuranceDocument({
          extracted,
          docType: opts?.docType || 'policy',
          ai: {
            provider: profile.aiProvider,
            model: profile.aiModel,
            apiKey,
            baseUrl: profile.aiBaseUrl || undefined,
            cliTool: profile.aiCliTool,
            cliBinaryPath: profile.aiCliBinaryPath || undefined
          }
        });

        return {
          canceled: false,
          filePath: extracted.filePath,
          fileName: extracted.fileName,
          mimeType: extracted.mimeType,
          sizeBytes: extracted.sizeBytes,
          parsedBy: parsed.parsedBy,
          notice: parsed.notice,
          fields: parsed.fields
        };
      } catch (err) {
        return {
          canceled: false,
          filePath,
          fileName: path.basename(filePath),
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  );

  ipcMain.handle(
    'insurance:uploadDocument',
    async (
      _event,
      payload: {
        policyId: number;
        docType: InsuranceDocumentType;
        docDate?: string;
        notes?: string;
      }
    ): Promise<{
      canceled: boolean;
      document?: InsuranceDocument;
      parsedSuggestion?: ParsedPolicySuggestion;
      error?: string;
    }> => {
      const win = ctx.getWindow();
      const openOptions: Electron.OpenDialogOptions = {
        title:
          payload.docType === 'renewal'
            ? 'Upload Renewal Receipt / Renewal Policy Document'
            : 'Upload Insurance Policy Document',
        properties: ['openFile'],
        filters: [
          { name: 'Documents & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };
      const picked = win
        ? await dialog.showOpenDialog(win, openOptions)
        : await dialog.showOpenDialog(openOptions);

      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true };
      }

      const sourcePath = picked.filePaths[0];
      try {
        const stored = copyInsuranceDocToVault(userDataDir, payload.policyId, sourcePath);

        // Auto-parse renewal/policy details so user can optionally sync updated renewal date & premium
        let parsedSuggestion: ParsedPolicySuggestion | undefined;
        let inferredDate = (payload.docDate || '').trim();
        try {
          const extracted = await extractFileContent(sourcePath);
          const profile = repo.getProfile();
          const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);
          const parsed = await parseInsuranceDocument({
            extracted,
            docType: payload.docType,
            ai: {
              provider: profile.aiProvider,
              model: profile.aiModel,
              apiKey,
              baseUrl: profile.aiBaseUrl || undefined,
              cliTool: profile.aiCliTool,
              cliBinaryPath: profile.aiCliBinaryPath || undefined
            }
          });
          parsedSuggestion = {
            canceled: false,
            filePath: sourcePath,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
            parsedBy: parsed.parsedBy,
            notice: parsed.notice,
            fields: parsed.fields
          };
          if (!inferredDate && parsed.fields.renewalDate) {
            inferredDate = parsed.fields.renewalDate;
          }
        } catch {
          // Parsing is best-effort; storing the document always succeeds
        }

        const doc = repo.addInsuranceDocument({
          policyId: payload.policyId,
          docType: payload.docType,
          fileName: stored.fileName,
          storedRelPath: stored.storedRelPath,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          docDate: inferredDate || new Date().toISOString().slice(0, 10),
          notes: payload.notes || ''
        });

        broadcastState();
        return { canceled: false, document: doc, parsedSuggestion };
      } catch (err) {
        return {
          canceled: false,
          error: err instanceof Error ? err.message : String(err)
        };
      }
    }
  );

  ipcMain.handle('insurance:readDocument', (_event, docId: number): DocumentBinaryPayload => {
    const found = repo.getInsuranceDocumentWithPath(docId);
    if (!found) {
      throw new Error('Document not found.');
    }
    const base64 = readVaultFileBase64(userDataDir, found.storedRelPath);
    return {
      id: found.doc.id,
      fileName: found.doc.fileName,
      mimeType: found.doc.mimeType,
      base64
    };
  });

  ipcMain.handle('insurance:openDocumentExternal', async (_event, docId: number) => {
    const found = repo.getInsuranceDocumentWithPath(docId);
    if (!found) {
      throw new Error('Document not found.');
    }
    const absPath = resolveVaultFilePath(userDataDir, found.storedRelPath);
    const errMsg = await shell.openPath(absPath);
    if (errMsg) throw new Error(errMsg);
    return true;
  });

  ipcMain.handle('insurance:deleteDocument', (_event, docId: number) => {
    const isDemo = repo.isDemoMode();
    const removedRelPath = repo.deleteInsuranceDocument(docId);
    if (removedRelPath) {
      deleteVaultFile(userDataDir, removedRelPath);
    }
    broadcastState();
    return repo.getInsurancePolicies(isDemo);
  });

  ipcMain.handle(
    'advisor:pickAttachments',
    async (): Promise<{ canceled: boolean; files: AdvisorAttachment[]; error?: string }> => {
      const win = ctx.getWindow();
      const openOptions: Electron.OpenDialogOptions = {
        title: 'Attach Recommendation Files (Brochures, PDFs, Screenshots, Quotes)',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Supported Documents & Images', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'csv', 'txt', 'md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      };
      const picked = win
        ? await dialog.showOpenDialog(win, openOptions)
        : await dialog.showOpenDialog(openOptions);

      if (picked.canceled || picked.filePaths.length === 0) {
        return { canceled: true, files: [] };
      }

      const files: AdvisorAttachment[] = [];
      for (const fp of picked.filePaths.slice(0, 5)) {
        try {
          const stat = fs.statSync(fp);
          if (stat.size > MAX_ATTACHMENT_BYTES) {
            return {
              canceled: false,
              files: [],
              error: `${path.basename(fp)} exceeds the 15 MB limit per file.`
            };
          }
          files.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            fileName: path.basename(fp),
            filePath: fp,
            mimeType: detectMimeType(fp),
            sizeBytes: stat.size
          });
        } catch (err) {
          return {
            canceled: false,
            files: [],
            error: err instanceof Error ? err.message : String(err)
          };
        }
      }

      return { canceled: false, files };
    }
  );

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

  ipcMain.handle('ai:detectLocalClis', () => detectLocalCliTools());

  ipcMain.handle(
    'ai:listModels',
    async (
      _event,
      payload: {
        provider: AIProviderId;
        apiKeyOverride?: string;
        baseUrl?: string;
        cliTool?: LocalCliToolId;
        cliBinaryPath?: string;
      }
    ) => {
      const storedKey = store.getSecret(`ai_key:${payload.provider}`);
      const apiKey = payload.apiKeyOverride?.trim() || storedKey;
      return listProviderModels({
        provider: payload.provider,
        apiKey,
        baseUrl: payload.baseUrl,
        cliTool: payload.cliTool,
        cliBinaryPath: payload.cliBinaryPath
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
    const policies = repo.getInsurancePolicies(isDemo);
    const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);

    const contextBlock = buildPortfolioContextBlock(snapshot, previous, alerts, profile, policies);
    const completion = await runLLMCompletion({
      provider: profile.aiProvider,
      model: profile.aiModel,
      apiKey,
      baseUrl: profile.aiBaseUrl || undefined,
      cliTool: profile.aiCliTool,
      cliBinaryPath: profile.aiCliBinaryPath || undefined,
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

  ipcMain.handle(
    'ai:validateAdvisorInput',
    async (
      _event,
      payload: {
        topic: AdvisorTopic;
        advisorName?: string;
        pitchText: string;
        attachmentPaths?: string[];
      }
    ) => {
      const trimmedPitch = (payload.pitchText || '').trim();
      const paths = (payload.attachmentPaths || []).filter(Boolean).slice(0, 5);
      if (!trimmedPitch && paths.length === 0) {
        throw new Error('Please describe the advisor recommendation or attach at least one document.');
      }

      const isDemo = repo.isDemoMode();
      const snapshot = repo.getLatestSnapshot(isDemo);
      if (!snapshot) {
        throw new Error('No portfolio snapshot available yet. Sync your portfolio or enable Demo Mode first.');
      }

      const extractedFiles = await Promise.all(paths.map((fp) => extractFileContent(fp)));
      const llmAttachments: LLMAttachment[] = extractedFiles.map((f) => ({
        fileName: f.fileName,
        mimeType: f.mimeType,
        base64: f.shouldAttachBinaryToLLM ? f.base64 : undefined,
        extractedText: f.extractedText
      }));

      const profile = repo.getProfile();
      const previous = repo.getPreviousSnapshot(isDemo, snapshot.snapshotDate);
      const alerts = repo.getAlerts(isDemo);
      const policies = repo.getInsurancePolicies(isDemo);
      const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);

      const contextBlock = buildPortfolioContextBlock(snapshot, previous, alerts, profile, policies);
      const completion = await runLLMCompletion({
        provider: profile.aiProvider,
        model: profile.aiModel,
        apiKey,
        baseUrl: profile.aiBaseUrl || undefined,
        cliTool: profile.aiCliTool,
        cliBinaryPath: profile.aiCliBinaryPath || undefined,
        systemPrompt: buildSystemPrompt(),
        maxTokens: 3200,
        messages: [
          {
            role: 'user',
            content: buildAdvisorValidationPrompt({
              topic: payload.topic,
              advisorName: payload.advisorName,
              pitchText: trimmedPitch,
              attachmentNames: extractedFiles.map((f) => f.fileName),
              contextBlock
            }),
            attachments: llmAttachments
          }
        ]
      });

      const topicTitleMap: Record<AdvisorTopic, string> = {
        holdings: 'Holdings',
        mutual_funds: 'Mutual Funds',
        insurance: 'Insurance',
        tax_loan: 'Tax & Loans',
        general: 'General'
      };
      const sourceSuffix = payload.advisorName?.trim() ? ` · ${payload.advisorName.trim()}` : '';
      const filesSuffix =
        extractedFiles.length > 0
          ? ` (+${extractedFiles.length} file${extractedFiles.length === 1 ? '' : 's'})`
          : '';
      const report = repo.saveAIReport({
        isDemo,
        provider: completion.provider,
        model: completion.model,
        createdAt: new Date().toISOString(),
        title: `Advisor Check: ${topicTitleMap[payload.topic] || 'General'}${sourceSuffix}${filesSuffix} (${snapshot.snapshotDate})`,
        markdown: completion.text
      });
      broadcastState();
      return report;
    }
  );

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
    const policies = repo.getInsurancePolicies(isDemo);
    const apiKey = store.getSecret(`ai_key:${profile.aiProvider}`);

    const priorHistory = repo.getChatMessages(isDemo, 16);
    const userMsg = repo.addChatMessage(isDemo, {
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString()
    });

    const contextBlock = buildPortfolioContextBlock(snapshot, previous, alerts, profile, policies);
    const systemPrompt = `${buildSystemPrompt()}\n\nCurrent Investor Portfolio Context:\n${contextBlock}`;

    try {
      const completion = await runLLMCompletion({
        provider: profile.aiProvider,
        model: profile.aiModel,
        apiKey,
        baseUrl: profile.aiBaseUrl || undefined,
        cliTool: profile.aiCliTool,
        cliBinaryPath: profile.aiCliBinaryPath || undefined,
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
      repo.getProfile(),
      repo.getInsurancePolicies(isDemo)
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
    wipeVault(userDataDir);
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
