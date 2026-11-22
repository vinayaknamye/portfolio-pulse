import { contextBridge, ipcRenderer } from 'electron';
import {
  AdvisorTopic,
  AIChatMessage,
  AIProviderId,
  AIReportRecord,
  AppStatePayload,
  BrokerId,
  CostBasisOverride,
  CsvImportResult,
  InsurancePolicy,
  SipBaselineItem,
  SymbolAlias,
  SyncResult,
  UserProfile
} from '@shared/types';

export interface PortfolioPulseApi {
  getState: () => Promise<AppStatePayload>;
  setDemoMode: (enabled: boolean) => Promise<AppStatePayload>;
  saveProfile: (partial: Partial<UserProfile>) => Promise<UserProfile>;
  connectBroker: (broker: BrokerId) => Promise<{ success: boolean; error?: string }>;
  disconnectBroker: (broker: BrokerId) => Promise<AppStatePayload>;
  runSync: (opts?: { interactive?: boolean }) => Promise<SyncResult>;
  dismissAlert: (alertId: string) => Promise<boolean>;
  saveSipBaselines: (items: SipBaselineItem[]) => Promise<SipBaselineItem[]>;
  resetSipBaselinesFromLive: () => Promise<SipBaselineItem[]>;
  saveAlias: (alias: SymbolAlias) => Promise<SymbolAlias[]>;
  deleteAlias: (indmoneyName: string) => Promise<SymbolAlias[]>;
  saveCostOverride: (payload: {
    holdingKey: string;
    displayName: string;
    symbol?: string;
    isin?: string;
    broker?: string;
    averagePrice: number;
  }) => Promise<CostBasisOverride[]>;
  deleteCostOverride: (holdingKey: string) => Promise<CostBasisOverride[]>;
  importCostCsv: () => Promise<CsvImportResult>;
  saveInsurancePolicy: (policy: InsurancePolicy) => Promise<InsurancePolicy[]>;
  deleteInsurancePolicy: (id: number) => Promise<InsurancePolicy[]>;
  saveAiApiKey: (provider: AIProviderId, apiKey: string) => Promise<boolean>;
  clearAiApiKey: (provider: AIProviderId) => Promise<boolean>;
  listAiModels: (payload: {
    provider: AIProviderId;
    apiKeyOverride?: string;
    baseUrl?: string;
  }) => Promise<Array<{ id: string; displayName: string }>>;
  generateAiReport: () => Promise<AIReportRecord>;
  validateAdvisorInput: (payload: {
    topic: AdvisorTopic;
    advisorName?: string;
    pitchText: string;
  }) => Promise<AIReportRecord>;
  sendAiChat: (message: string) => Promise<{ userMsg: AIChatMessage; assistantMsg: AIChatMessage }>;
  clearAiChat: () => Promise<boolean>;
  exportBundle: () => Promise<{ canceled: boolean; directory?: string; files?: string[] }>;
  sendTestNotification: () => Promise<boolean>;
  wipeAllData: () => Promise<AppStatePayload>;
  openExternal: (url: string) => Promise<boolean>;
  onStateUpdated: (listener: (state: AppStatePayload) => void) => () => void;
}

const api: PortfolioPulseApi = {
  getState: () => ipcRenderer.invoke('app:getState'),
  setDemoMode: (enabled) => ipcRenderer.invoke('app:setDemoMode', enabled),
  saveProfile: (partial) => ipcRenderer.invoke('profile:save', partial),
  connectBroker: (broker) => ipcRenderer.invoke('broker:connect', broker),
  disconnectBroker: (broker) => ipcRenderer.invoke('broker:disconnect', broker),
  runSync: (opts) => ipcRenderer.invoke('sync:run', opts),
  dismissAlert: (alertId) => ipcRenderer.invoke('alert:dismiss', alertId),
  saveSipBaselines: (items) => ipcRenderer.invoke('sip:saveBaselines', items),
  resetSipBaselinesFromLive: () => ipcRenderer.invoke('sip:resetBaselinesFromLive'),
  saveAlias: (alias) => ipcRenderer.invoke('alias:save', alias),
  deleteAlias: (indmoneyName) => ipcRenderer.invoke('alias:delete', indmoneyName),
  saveCostOverride: (payload) => ipcRenderer.invoke('costOverride:save', payload),
  deleteCostOverride: (holdingKey) => ipcRenderer.invoke('costOverride:delete', holdingKey),
  importCostCsv: () => ipcRenderer.invoke('costOverride:importCsv'),
  saveInsurancePolicy: (policy) => ipcRenderer.invoke('insurance:save', policy),
  deleteInsurancePolicy: (id) => ipcRenderer.invoke('insurance:delete', id),
  saveAiApiKey: (provider, apiKey) => ipcRenderer.invoke('ai:saveApiKey', { provider, apiKey }),
  clearAiApiKey: (provider) => ipcRenderer.invoke('ai:clearApiKey', provider),
  listAiModels: (payload) => ipcRenderer.invoke('ai:listModels', payload),
  generateAiReport: () => ipcRenderer.invoke('ai:generateReport'),
  validateAdvisorInput: (payload) => ipcRenderer.invoke('ai:validateAdvisorInput', payload),
  sendAiChat: (message) => ipcRenderer.invoke('ai:sendChat', message),
  clearAiChat: () => ipcRenderer.invoke('ai:clearChat'),
  exportBundle: () => ipcRenderer.invoke('export:bundle'),
  sendTestNotification: () => ipcRenderer.invoke('notification:test'),
  wipeAllData: () => ipcRenderer.invoke('app:wipeAllData'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  onStateUpdated: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppStatePayload) => listener(state);
    ipcRenderer.on('app:stateUpdated', handler);
    return () => ipcRenderer.removeListener('app:stateUpdated', handler);
  }
};

contextBridge.exposeInMainWorld('portfolioPulse', api);
