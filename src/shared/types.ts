export type BrokerId = 'indmoney' | 'upstox';

export type BrokerAuthState = 'disconnected' | 'connected' | 'reauth_required' | 'error';

export interface BrokerConnectionStatus {
  broker: BrokerId;
  state: BrokerAuthState;
  lastSyncAt: string | null;
  lastError: string | null;
}

export type AIProviderId = 'claude' | 'gemini' | 'openai' | 'ollama';
export type AIScheduleMode = 'manual' | 'weekly' | 'daily';
export type ThemeMode = 'dark' | 'light';

export interface UserProfile {
  displayName: string;
  monthlyIncome: number;
  emergencyTarget: number;
  idleMarginThreshold: number;
  drawdownThresholdPct: number;
  concentrationThresholdPct: number;
  discrepancyQtyThreshold: number;
  discrepancyValueThreshold: number;
  dailySyncTime: string; // HH:MM in local time
  enableDailySync: boolean;
  enableNotifications: boolean;
  launchAtLogin: boolean;
  aiSchedule: AIScheduleMode;
  aiProvider: AIProviderId;
  aiModel: string;
  aiBaseUrl: string;
  theme: ThemeMode;
  strategyMarkdown: string;
}

export interface AssetAllocationItem {
  assetType: string;
  investedValue: number;
  currentValue: number;
  returnValue: number;
  returnPct: number;
  weightPct: number;
}

export interface RawIndmoneyStock {
  investment: string;
  investment_code: string;
  isin?: string | null;
  broker?: string | null;
  total_units: number;
  unit_price: number;
  market_value: number;
  invested_amount?: number | string | null;
  total_pnl?: number;
  pnl_per?: number;
  market_cap?: string | null;
  assetclass_l2?: string | null;
  one_day_change?: number;
  one_day_change_percentage?: number;
}

export interface RawUpstoxHolding {
  tradingsymbol?: string;
  trading_symbol?: string;
  company_name?: string;
  isin?: string;
  exchange?: string;
  quantity?: number;
  cnc_used_quantity?: number;
  average_price?: number;
  last_price?: number;
  close_price?: number;
  pnl?: number;
  day_change?: number;
  day_change_percentage?: number;
}

export interface RawIndmoneyMF {
  investment: string;
  investment_code: string;
  broker?: string | null;
  total_units: number;
  unit_price: number;
  invested_amount: number;
  market_value: number;
  total_pnl: number;
  pnl_per: number;
  holding_percent?: number;
  assetclass_l2?: string | null;
  one_day_change?: number;
  one_day_change_percentage?: number;
}

export interface RawIndmoneySipItem {
  name: string;
  isin?: string;
  category?: string;
  planType?: string;
  risk?: string;
  rating?: number | null;
  nav?: string | number;
  units?: string | number;
  currentValueVal?: number;
  investedAmountVal?: number;
  currentGainVal?: number;
  gainPercentageVal?: number;
  folio_id?: string;
  active_sips?: Array<{
    sip_id?: string;
    sip_type?: string;
    sip_frequency?: string;
    amount?: number;
    sip_start_date?: string;
  }>;
}

export interface RawIndmoneyNetworth {
  total_invested: number;
  total_current_value: number;
  total_networth: number;
  investments: Array<{
    asset_type: string;
    invested_value: number;
    current_value: number;
    return?: number;
    return_percentage?: number;
    progress_value_percentage?: number;
  }>;
  assets?: Array<{
    assetclass_l2: string;
    invested_value: number;
    current_value: number;
    return?: number;
    return_percentage?: number;
    progress_value_percentage?: number;
  }>;
  market_cap?: Array<{
    market_cap: string;
    invested_value: number;
    current_value: number;
    progress_value_percentage?: number;
  }>;
  liabilities?: {
    total?: number;
    total_loan_balance?: number;
    total_credit_card_due?: number;
  };
}

export interface RawUpstoxFunds {
  availableMargin: number;
  usedMargin: number;
  payinAmount: number;
}

export interface RawIndmoneyStockSipItem {
  name?: string;
  stock_name?: string;
  symbol?: string;
  isin?: string;
  status?: string;
  amount?: number;
  sip_amount?: number;
  frequency?: string;
  sip_frequency?: string;
  start_date?: string;
  sip_start_date?: string;
  next_execution_date?: string;
  current_value?: number;
  invested_amount?: number;
  gain_pct?: number;
}

export interface RawUpstoxMfHolding {
  fund?: string;
  scheme_name?: string;
  isin?: string;
  instrument_key?: string;
  quantity?: number;
  units?: number;
  average_price?: number;
  last_price?: number;
  nav?: number;
  invested_value?: number;
  current_value?: number;
  pnl?: number;
  folio?: string;
}

export interface RawUpstoxMfSip {
  fund?: string;
  scheme_name?: string;
  status?: string;
  frequency?: string;
  sip_id?: string;
  instrument_key?: string;
  isin?: string;
  instalment_amount?: number;
  amount?: number;
  next_instalment?: string;
  created?: string;
  sip_type?: string;
  completed_instalments?: number;
  pending_instalments?: number;
}

export interface RawIndmoneyBond {
  investment: string;
  investment_code?: string;
  isin?: string | null;
  broker?: string | null;
  total_units?: number;
  unit_price?: number;
  invested_amount?: number | string | null;
  market_value?: number;
  total_pnl?: number;
  pnl_per?: number;
  assetclass_l2?: string | null;
}

export interface IndmoneyFetchPayload {
  networth: RawIndmoneyNetworth;
  stocks: RawIndmoneyStock[];
  mutualFunds: RawIndmoneyMF[];
  bonds?: RawIndmoneyBond[];
  mfSips: RawIndmoneySipItem[];
  stockSips: RawIndmoneyStockSipItem[];
}

export interface UpstoxFetchPayload {
  holdings: RawUpstoxHolding[];
  funds: RawUpstoxFunds;
  positions: unknown[];
  orders: unknown[];
  mfHoldings?: RawUpstoxMfHolding[];
  mfSips?: RawUpstoxMfSip[];
}

export type UpstoxSyncState = 'live' | 'not_linked' | 'stale_reauth_required';

export interface ReconciledEquity {
  id: string;
  symbol: string;
  name: string;
  isin: string;
  broker: string;
  isExternalBroker: boolean;
  isNonEquity: boolean;
  quantity: number;
  averagePrice: number | null; // null if unknown (external broker without cost basis)
  lastPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChangePct: number;
  marketCap: string;
  costBasisSource:
    | 'upstox_live'
    | 'upstox_carried_forward'
    | 'indmoney_native'
    | 'manual_override'
    | 'csv_import'
    | 'market_value_proxy';
  partialCostBasisNote?: string;
  matchStatus:
    | 'matched'
    | 'external'
    | 'upstox_standalone'
    | 'unmatched_indmoney'
    | 'unmatched_upstox'
    | 'non_equity';
  indmoneyQty?: number;
  upstoxQty?: number;
  indmoneyValue?: number;
  upstoxValue?: number;
}

export interface ReconciledBond {
  id: string;
  name: string;
  symbol: string;
  isin: string;
  bondType: 'SGB' | 'NCD' | 'G-Sec' | 'Bond';
  broker: string;
  quantity: number;
  averagePrice: number | null;
  lastPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  costBasisSource:
    | 'upstox_live'
    | 'indmoney_native'
    | 'manual_override'
    | 'csv_import'
    | 'market_value_proxy';
}

export type InsuranceCategory = 'Term Life' | 'Health' | 'Endowment / Guaranteed' | 'ULIP' | 'Vehicle / Other';

export type InsuranceDocumentType = 'policy' | 'renewal';

export interface InsuranceDocument {
  id: number;
  policyId: number;
  docType: InsuranceDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  docDate: string;
  notes: string;
  uploadedAt: string;
}

export interface InsurancePolicy {
  id?: number;
  category: InsuranceCategory;
  insurer: string;
  planName: string;
  sumAssured: number;
  annualPremium: number;
  renewalDate: string;
  paymentTerm: string;
  notes: string;
  documents?: InsuranceDocument[];
}

export interface ParsedPolicySuggestion {
  canceled?: boolean;
  filePath?: string;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  parsedBy?: 'ai' | 'local_heuristic';
  notice?: string;
  fields?: Partial<Omit<InsurancePolicy, 'id' | 'documents'>>;
  error?: string;
}

export interface DocumentBinaryPayload {
  id: number;
  fileName: string;
  mimeType: string;
  base64: string;
}

export interface AdvisorAttachment {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
}

export type AdvisorTopic = 'holdings' | 'mutual_funds' | 'insurance' | 'tax_loan' | 'general';

export interface ReconciledMutualFund {
  name: string;
  code: string;
  isin?: string;
  broker: string;
  units: number;
  nav: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  dayChange: number;
  dayChangePct: number;
  assetClass: string;
  isLiquid: boolean;
  isArbitrage: boolean;
}

export interface ActiveSipRecord {
  fundName: string;
  broker: string;
  instrumentType: 'MF' | 'STOCK';
  isin: string;
  category: string;
  planType: string;
  amount: number;
  frequency: 'WEEKLY' | 'MONTHLY' | 'DAILY' | 'OTHER';
  startDate: string;
  nextInstallmentDate?: string;
  sipType: string;
  folioId: string;
  investedValue: number;
  currentValue: number;
  gainPct: number;
}

export interface SipBaselineItem {
  id?: number;
  fundName: string;
  expectedAmount: number;
  expectedFrequency: 'WEEKLY' | 'MONTHLY' | 'DAILY' | 'OTHER';
  active: boolean;
}

export interface SymbolAlias {
  indmoneyName: string;
  upstoxSymbol: string;
}

export interface CostBasisOverride {
  holdingKey: string;
  displayName: string;
  symbol?: string;
  isin?: string;
  broker?: string;
  averagePrice: number;
  csvQty?: number;
  csvCurrentPrice?: number;
  source: 'manual' | 'csv_import';
  updatedAt: string;
}

export interface CsvImportResult {
  canceled: boolean;
  fileName?: string;
  detectedBroker?: string;
  parsedCount?: number;
  matchedInSnapshot?: number;
  unmatchedNames?: string[];
  error?: string;
}

export interface UnmatchedCandidate {
  source: 'indmoney' | 'upstox';
  name: string;
  symbol?: string;
  quantity: number;
  value: number;
  unitPrice: number;
}

export interface ReconciliationSummary {
  matchedCount: number;
  externalCount: number;
  nonEquityCount: number;
  discrepancies: Array<{
    name: string;
    symbol: string;
    indmoneyQty: number;
    upstoxQty: number;
    indmoneyValue: number;
    upstoxValue: number;
    qtyDiff: number;
    valueDiff: number;
  }>;
  unmatchedIndmoney: UnmatchedCandidate[];
  unmatchedUpstox: UnmatchedCandidate[];
  indmoneyStockTotal: number;
  upstoxEquityTotal: number;
  externalStockTotal: number;
  aggregateDiff: number;
}

export type AlertSeverity = 'info' | 'warning' | 'action';

export interface AuditAlert {
  id: string;
  snapshotId?: number;
  category:
    | 'reconciliation'
    | 'margin'
    | 'sip'
    | 'cashflow'
    | 'emergency'
    | 'drawdown'
    | 'concentration'
    | 'auth'
    | 'performance';
  severity: AlertSeverity;
  title: string;
  detail: string;
  createdAt: string;
  dismissed: boolean;
}

export interface PortfolioSnapshot {
  id?: number;
  isDemo: boolean;
  fetchedAt: string;
  snapshotDate: string; // YYYY-MM-DD local date
  upstoxState: UpstoxSyncState;
  totalNetworth: number;
  totalInvestedRaw: number;
  totalInvestedAdjusted: number;
  totalUnrealizedGain: number;
  totalUnrealizedGainPct: number;
  totalLiabilities: number;
  upstoxAvailableMargin: number;
  savingsAccountBalance: number;
  emergencyCushionTotal: number;
  liquidCorpusTotal: number;
  weeklySipOutflow: number;
  monthlySipOutflow: number;
  estimatedMonthlySipTotal: number;
  allocations: AssetAllocationItem[];
  equities: ReconciledEquity[];
  bonds?: ReconciledBond[];
  mutualFunds: ReconciledMutualFund[];
  activeSips: ActiveSipRecord[];
  reconciliation: ReconciliationSummary;
}

export interface SnapshotHistoryPoint {
  id: number;
  snapshotDate: string;
  fetchedAt: string;
  totalNetworth: number;
  totalInvestedAdjusted: number;
  upstoxState: UpstoxSyncState;
}

export interface AIReportRecord {
  id: number;
  isDemo: boolean;
  provider: AIProviderId;
  model: string;
  createdAt: string;
  title: string;
  markdown: string;
}

export interface AIChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface SyncResult {
  success: boolean;
  snapshot?: PortfolioSnapshot;
  alerts: AuditAlert[];
  upstoxState: UpstoxSyncState;
  error?: string;
}

export interface AppStatePayload {
  isDemoMode: boolean;
  profile: UserProfile;
  brokers: Record<BrokerId, BrokerConnectionStatus>;
  hasAiApiKey: Record<AIProviderId, boolean>;
  latestSnapshot: PortfolioSnapshot | null;
  history: SnapshotHistoryPoint[];
  alerts: AuditAlert[];
  sipBaselines: SipBaselineItem[];
  aliases: SymbolAlias[];
  costOverrides: CostBasisOverride[];
  insurancePolicies: InsurancePolicy[];
  reports: AIReportRecord[];
  chatMessages: AIChatMessage[];
}
