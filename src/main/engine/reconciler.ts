import {
  ActiveSipRecord,
  AssetAllocationItem,
  CostBasisOverride,
  IndmoneyFetchPayload,
  PortfolioSnapshot,
  RawIndmoneyStock,
  RawUpstoxHolding,
  ReconciledEquity,
  ReconciledMutualFund,
  ReconciliationSummary,
  SymbolAlias,
  UnmatchedCandidate,
  UpstoxFetchPayload,
  UpstoxSyncState,
  UserProfile
} from '@shared/types';

export interface PreviousUpstoxCostBasis {
  symbol: string;
  name: string;
  isin: string;
  averagePrice: number;
}

export interface ReconcileInput {
  indmoney: IndmoneyFetchPayload | null;
  upstox: UpstoxFetchPayload | null;
  upstoxState: UpstoxSyncState;
  previousCostBasis?: PreviousUpstoxCostBasis[];
  aliases: SymbolAlias[];
  costOverrides?: CostBasisOverride[];
  profile: UserProfile;
  isDemo: boolean;
  fetchedAt?: string;
}

const STOP_WORDS = new Set([
  'ltd',
  'limited',
  'inc',
  'corp',
  'corporation',
  'company',
  'co',
  'industries',
  'india',
  'indian',
  'of',
  'and',
  'the',
  'plc',
  'services',
  'serv',
  'lt',
  'l'
]);

const ABBREV_MAP: Record<string, string> = {
  serv: 'services',
  ind: 'industries',
  fin: 'finance',
  in: 'investment',
  co: 'company',
  nip: 'nippon',
  vn: 'ventures',
  dev: 'developers',
  pharma: 'pharmaceutical',
  intl: 'international',
  eng: 'engineering',
  infra: 'infrastructure',
  tech: 'technologies',
  mfg: 'manufacturing',
  petro: 'petroleum',
  elec: 'electronics',
  aero: 'aeronautics',
  ent: 'enterprises',
  cap: 'capital'
};

export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((t) => ABBREV_MAP[t] || t)
    .filter((token) => token.length > 0 && !STOP_WORDS.has(token))
    .join(' ')
    .trim();
}

export function normalizeCompact(raw: string): string {
  return normalizeCompanyName(raw).replace(/\s+/g, '');
}

/**
 * Generates candidate acronyms from a full company name to match NSE/BSE ticker symbols
 * without hardcoded mappings (e.g., "Jio Platforms Ltd" -> "JPL", "Bharat Dynamics Ltd" -> "BDL",
 * "Mahindra & Mahindra Ltd" -> "MM", "Larsen & Toubro Ltd" -> "LT", "State Bank of India" -> "SBI").
 */
export function buildCompanyAcronyms(rawName: string): Set<string> {
  const cleaned = rawName
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const acronyms = new Set<string>();
  const fullInitials = cleaned.map((w) => w[0]).join('');
  if (fullInitials.length >= 2) acronyms.add(fullInitials);

  const withoutOfAnd = cleaned.filter((w) => w !== 'of' && w !== 'and' && w !== 'the');
  const initialsNoConnectors = withoutOfAnd.map((w) => w[0]).join('');
  if (initialsNoConnectors.length >= 2) acronyms.add(initialsNoConnectors);

  const withoutCorpSuffix = withoutOfAnd.filter(
    (w) => w !== 'ltd' && w !== 'limited' && w !== 'inc' && w !== 'plc'
  );
  const coreInitials = withoutCorpSuffix.map((w) => w[0]).join('');
  if (coreInitials.length >= 2) {
    acronyms.add(coreInitials);
    acronyms.add(`${coreInitials}l`); // e.g., BDL, JPL, HAL
  }

  return acronyms;
}

function normalizeSymbolCompact(symbol: string): string {
  return symbol.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Detects non-equity demat instruments on Upstox (corporate NCDs, G-Secs, SGBs)
 * using Indian ISIN conventions (positions 7-8 = '07'/'08' for debt/NCD, 'IN00' for G-Sec/SGB)
 * and common symbol/company descriptors.
 */
export function isUpstoxNonEquityInstrument(holding: RawUpstoxHolding): boolean {
  const sym = (holding.trading_symbol || holding.tradingsymbol || '').toUpperCase().trim();
  const isin = (holding.isin || '').toUpperCase().trim();
  const company = (holding.company_name || '').toUpperCase();

  if (isin.startsWith('IN00')) return true;
  if (isin.length === 12 && isin.startsWith('INE')) {
    const secType = isin.slice(7, 9);
    if (secType === '07' || secType === '08' || secType === '11') return true;
  }

  if (/^\d{3,}[A-Z]+\d{2}$/.test(sym)) return true; // e.g., 1075SCL34
  if (sym.startsWith('SGB')) return true;
  if (/\b(NCD|BOND|DEBENTURE|G-SEC|SGB)\b/.test(company)) return true;

  return false;
}

function isUpstoxBrokerLabel(broker?: string | null): boolean {
  const lower = (broker || '').trim().toLowerCase();
  return lower.includes('upstox') || lower.includes('rksv');
}

function hasNativeIndmoneyCostBasis(stock: RawIndmoneyStock): boolean {
  const inv = typeof stock.invested_amount === 'number' ? stock.invested_amount : Number(stock.invested_amount);
  if (!Number.isFinite(inv) || inv <= 0) return false;
  const mkt = Number(stock.market_value ?? 0);
  const pnl = Number(stock.total_pnl ?? 0);
  const brokerLower = (stock.broker || '').trim().toLowerCase();
  // INDmoney sets invested_amount === market_value and total_pnl === 0 when external cost basis is unknown.
  // Native INDmoney stocks (or brokers where INDmoney has real buy cost) have differing invested vs market or non-zero P&L.
  if (Math.abs(pnl) > 0.01 || Math.abs(inv - mkt) > 0.01) return true;
  if (brokerLower.includes('indmoney')) return true;
  return false;
}

function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeCompanyName(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompanyName(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      overlap += 1;
      continue;
    }
    for (const tb of tokensB) {
      if (t.length >= 4 && tb.length >= 4 && (t.startsWith(tb) || tb.startsWith(t))) {
        overlap += 0.8;
        break;
      }
    }
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function scoreStockMatch(ind: RawIndmoneyStock, u: NormalizedUpstox): number {
  // Exact ISIN match when available
  if (ind.isin && u.isin && ind.isin.trim().toUpperCase() === u.isin.trim().toUpperCase()) {
    return 1.5;
  }

  const indCompact = normalizeCompact(ind.investment);
  const uCompact = normalizeCompact(u.companyName);
  const symCompact = normalizeSymbolCompact(u.symbol);

  if (indCompact && (indCompact === uCompact || indCompact === symCompact)) {
    return 1.2;
  }

  const price = Number(ind.unit_price ?? 0);
  const units = Number(ind.total_units ?? 0);
  const priceNear = price > 0 && Math.abs(u.lastPrice - price) <= Math.max(2, u.lastPrice * 0.03);
  const qtySame = Math.abs(u.quantity - units) < 0.01;

  // Acronym match (e.g., "Jio Platforms Ltd" -> "JPL", "Bharat Dynamics Ltd" -> "BDL", "Mahindra & Mahindra Ltd" -> "M&M")
  const acronyms = buildCompanyAcronyms(ind.investment);
  if (acronyms.has(symCompact) || (symCompact.length >= 3 && acronyms.has(symCompact.slice(0, -1)))) {
    return priceNear ? 1.05 : 0.85;
  }

  // Symbol prefix inside compact name (e.g. HDFCBANK inside hdfcbank, TATAPOWER inside tatapower)
  if (symCompact.length >= 4 && (indCompact.includes(symCompact) || symCompact.includes(indCompact))) {
    return priceNear ? 1.0 : 0.8;
  }

  const sim = tokenSimilarity(ind.investment, u.companyName);
  if (sim >= 0.45) {
    return sim + (priceNear && qtySame ? 0.3 : priceNear ? 0.12 : 0);
  }

  return 0;
}

function getLocalDateString(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface NormalizedUpstox {
  symbol: string;
  companyName: string;
  isin: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  investedValue: number;
  currentValue: number;
  pnl: number;
  dayChangePct: number;
  isNonEquity: boolean;
}

function normalizeUpstoxHoldings(rawList: RawUpstoxHolding[]): NormalizedUpstox[] {
  return rawList
    .map((h) => {
      const symbol = (h.trading_symbol || h.tradingsymbol || '').trim();
      const quantity = Number(h.quantity ?? h.cnc_used_quantity ?? 0);
      const averagePrice = Number(h.average_price ?? 0);
      const lastPrice = Number(h.last_price ?? h.close_price ?? 0);
      const investedValue = quantity * averagePrice;
      const currentValue = quantity * lastPrice;
      const pnl = h.pnl !== undefined ? Number(h.pnl) : currentValue - investedValue;
      return {
        symbol,
        companyName: (h.company_name || symbol).trim(),
        isin: (h.isin || '').trim(),
        quantity,
        averagePrice,
        lastPrice,
        investedValue,
        currentValue,
        pnl,
        dayChangePct: Number(h.day_change_percentage ?? 0),
        isNonEquity: isUpstoxNonEquityInstrument(h)
      };
    })
    .filter((h) => h.symbol.length > 0 && h.quantity > 0);
}

export function reconcilePortfolio(input: ReconcileInput): PortfolioSnapshot {
  const fetchedAt = input.fetchedAt || new Date().toISOString();
  const snapshotDate = getLocalDateString(fetchedAt);
  const { indmoney, upstox, upstoxState, aliases, profile, isDemo } = input;

  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    aliasMap.set(a.indmoneyName.trim().toLowerCase(), a.upstoxSymbol.trim().toUpperCase());
  }

  const prevCostBySymbol = new Map<string, PreviousUpstoxCostBasis>();
  const prevCostByName = new Map<string, PreviousUpstoxCostBasis>();
  for (const prev of input.previousCostBasis || []) {
    prevCostBySymbol.set(prev.symbol.toUpperCase(), prev);
    prevCostByName.set(normalizeCompact(prev.name), prev);
  }

  const upstoxNormalized = upstox ? normalizeUpstoxHoldings(upstox.holdings || []) : [];
  const availableUpstoxEquity = new Map<string, NormalizedUpstox>();
  const nonEquityUpstox: NormalizedUpstox[] = [];

  for (const u of upstoxNormalized) {
    if (u.isNonEquity) {
      nonEquityUpstox.push(u);
    } else {
      availableUpstoxEquity.set(u.symbol.toUpperCase(), u);
    }
  }

  const upstoxActive = upstoxState === 'live' && upstox !== null;
  const indStocks = indmoney?.stocks || [];
  const indmoneyHasUpstoxRows = indStocks.some((s) => isUpstoxBrokerLabel(s.broker));

  const equities: ReconciledEquity[] = [];
  const discrepancies: ReconciliationSummary['discrepancies'] = [];
  const unmatchedIndmoney: UnmatchedCandidate[] = [];

  let indmoneyStockTotal = 0;
  let externalStockTotal = 0;
  let nonSyncedUpstoxEquityCurrent = 0;
  let nonSyncedUpstoxEquityInvested = 0;
  let trueIndmoneyReconciledStockInvested = 0;

  const pendingUpstoxMatchStocks: RawIndmoneyStock[] = [];

  // Pass 1: Separate external/native INDmoney stocks vs Upstox-broker rows (plus Tier 1 ISIN/Alias matching)
  for (const s of indStocks) {
    const mktVal = Number(s.market_value ?? 0);
    const units = Number(s.total_units ?? 0);
    const unitPrice = Number(s.unit_price ?? (units > 0 ? mktVal / units : 0));
    indmoneyStockTotal += mktVal;

    const brokerLabel = (s.broker || (indmoneyHasUpstoxRows ? 'Unknown' : 'INDmoney')).trim();
    const belongsToUpstox = isUpstoxBrokerLabel(s.broker);

    // If this row belongs to a non-Upstox broker (e.g., INDmoney native demat, Paytm Money, Zerodha, Groww)
    if (!belongsToUpstox) {
      externalStockTotal += mktVal;
      const nativeCost = hasNativeIndmoneyCostBasis(s);
      const investedVal = nativeCost ? Number(s.invested_amount) : mktVal;
      const pnl = nativeCost ? Number(s.total_pnl ?? mktVal - investedVal) : 0;
      const pnlPct = nativeCost && investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      trueIndmoneyReconciledStockInvested += investedVal;

      equities.push({
        id: `ext:${brokerLabel.toLowerCase()}:${s.investment_code || s.investment}`,
        symbol: s.investment_code || s.investment.slice(0, 12).toUpperCase(),
        name: s.investment,
        isin: (s.isin || '').trim(),
        broker: brokerLabel,
        isExternalBroker: !brokerLabel.toLowerCase().includes('indmoney'),
        isNonEquity: false,
        quantity: units,
        averagePrice: nativeCost && units > 0 ? round2(investedVal / units) : null,
        lastPrice: unitPrice,
        investedValue: round2(investedVal),
        currentValue: round2(mktVal),
        pnl: round2(pnl),
        pnlPct: round2(pnlPct),
        dayChangePct: Number(s.one_day_change_percentage ?? 0),
        marketCap: (s.market_cap || 'unknown').toLowerCase(),
        costBasisSource: nativeCost ? 'indmoney_native' : 'market_value_proxy',
        matchStatus: 'external',
        indmoneyQty: units,
        indmoneyValue: round2(mktVal)
      });
      continue;
    }

    // Row is tagged Upstox in INDmoney, but Upstox MCP isn't live right now
    if (!upstoxActive) {
      const aliasedSym = aliasMap.get(s.investment.trim().toLowerCase());
      const carried =
        (aliasedSym ? prevCostBySymbol.get(aliasedSym) : undefined) ||
        prevCostByName.get(normalizeCompact(s.investment));

      if (upstoxState === 'stale_reauth_required' && carried && carried.averagePrice > 0) {
        const inv = units * carried.averagePrice;
        const pnl = mktVal - inv;
        const pnlPct = inv > 0 ? (pnl / inv) * 100 : 0;
        trueIndmoneyReconciledStockInvested += inv;
        equities.push({
          id: `carried:${carried.symbol}`,
          symbol: carried.symbol,
          name: s.investment,
          isin: carried.isin,
          broker: 'Upstox',
          isExternalBroker: false,
          isNonEquity: false,
          quantity: units,
          averagePrice: round2(carried.averagePrice),
          lastPrice: unitPrice,
          investedValue: round2(inv),
          currentValue: round2(mktVal),
          pnl: round2(pnl),
          pnlPct: round2(pnlPct),
          dayChangePct: Number(s.one_day_change_percentage ?? 0),
          marketCap: (s.market_cap || 'unknown').toLowerCase(),
          costBasisSource: 'upstox_carried_forward',
          matchStatus: 'matched',
          indmoneyQty: units,
          indmoneyValue: round2(mktVal)
        });
      } else {
        trueIndmoneyReconciledStockInvested += mktVal;
        equities.push({
          id: `ind:${s.investment_code || s.investment}`,
          symbol: aliasedSym || s.investment_code || s.investment.slice(0, 12).toUpperCase(),
          name: s.investment,
          isin: (s.isin || '').trim(),
          broker: brokerLabel,
          isExternalBroker: false,
          isNonEquity: false,
          quantity: units,
          averagePrice: null,
          lastPrice: unitPrice,
          investedValue: round2(mktVal),
          currentValue: round2(mktVal),
          pnl: 0,
          pnlPct: 0,
          dayChangePct: Number(s.one_day_change_percentage ?? 0),
          marketCap: (s.market_cap || 'unknown').toLowerCase(),
          costBasisSource: 'market_value_proxy',
          matchStatus: upstoxState === 'not_linked' ? 'external' : 'unmatched_indmoney',
          indmoneyQty: units,
          indmoneyValue: round2(mktVal)
        });
      }
      continue;
    }

    // Upstox live: Tier 1 — Alias or Exact ISIN match
    const aliasedSymbol = aliasMap.get(s.investment.trim().toLowerCase());
    if (aliasedSymbol && availableUpstoxEquity.has(aliasedSymbol)) {
      const matched = availableUpstoxEquity.get(aliasedSymbol)!;
      availableUpstoxEquity.delete(aliasedSymbol);
      pushMatchedHolding(s, matched, equities, discrepancies, profile);
      trueIndmoneyReconciledStockInvested += matched.investedValue;
      continue;
    }

    if (s.isin) {
      const targetIsin = s.isin.trim().toUpperCase();
      const byIsin = Array.from(availableUpstoxEquity.values()).find(
        (u) => u.isin && u.isin.toUpperCase() === targetIsin
      );
      if (byIsin) {
        availableUpstoxEquity.delete(byIsin.symbol.toUpperCase());
        pushMatchedHolding(s, byIsin, equities, discrepancies, profile);
        trueIndmoneyReconciledStockInvested += byIsin.investedValue;
        continue;
      }
    }

    pendingUpstoxMatchStocks.push(s);
  }

  // Pass 2 (Upstox live): Tier 2 — Abbreviation-aware & acronym-aware lexical/symbol similarity
  const stillPending: RawIndmoneyStock[] = [];
  for (const s of pendingUpstoxMatchStocks) {
    let bestSym: string | null = null;
    let bestScore = 0;

    for (const [sym, u] of availableUpstoxEquity.entries()) {
      const score = scoreStockMatch(s, u);
      if (score > bestScore) {
        bestScore = score;
        bestSym = sym;
      }
    }

    if (bestSym && bestScore >= 0.72) {
      const matched = availableUpstoxEquity.get(bestSym)!;
      availableUpstoxEquity.delete(bestSym);
      pushMatchedHolding(s, matched, equities, discrepancies, profile);
      trueIndmoneyReconciledStockInvested += matched.investedValue;
    } else {
      stillPending.push(s);
    }
  }

  // Pass 3 (Upstox live): Tier 3 — Unambiguous exact (quantity, unit_price) fallback (handles renames like GROWW)
  for (const s of stillPending) {
    const units = Number(s.total_units ?? 0);
    const price = Number(s.unit_price ?? 0);
    const candidates: NormalizedUpstox[] = [];
    for (const u of availableUpstoxEquity.values()) {
      if (Math.abs(u.quantity - units) < 0.01 && Math.abs(u.lastPrice - price) <= Math.max(0.5, price * 0.01)) {
        candidates.push(u);
      }
    }

    if (candidates.length === 1) {
      const matched = candidates[0];
      availableUpstoxEquity.delete(matched.symbol.toUpperCase());
      pushMatchedHolding(s, matched, equities, discrepancies, profile);
      trueIndmoneyReconciledStockInvested += matched.investedValue;
    } else {
      const mktVal = Number(s.market_value ?? 0);
      trueIndmoneyReconciledStockInvested += mktVal;
      unmatchedIndmoney.push({
        source: 'indmoney',
        name: s.investment,
        quantity: units,
        value: mktVal,
        unitPrice: price
      });
      equities.push({
        id: `unmatched-ind:${s.investment_code || s.investment}`,
        symbol: s.investment_code || s.investment.slice(0, 10).toUpperCase(),
        name: s.investment,
        isin: (s.isin || '').trim(),
        broker: s.broker || 'Upstox',
        isExternalBroker: false,
        isNonEquity: false,
        quantity: units,
        averagePrice: null,
        lastPrice: price,
        investedValue: round2(mktVal),
        currentValue: round2(mktVal),
        pnl: 0,
        pnlPct: 0,
        dayChangePct: Number(s.one_day_change_percentage ?? 0),
        marketCap: (s.market_cap || 'unknown').toLowerCase(),
        costBasisSource: 'market_value_proxy',
        matchStatus: 'unmatched_indmoney',
        indmoneyQty: units,
        indmoneyValue: round2(mktVal)
      });
    }
  }

  // Remaining Upstox equity holdings:
  // - If INDmoney wasn't linked OR INDmoney didn't sync Upstox at all, these are clean standalone Upstox holdings!
  // - If INDmoney DOES sync Upstox, any leftover Upstox equity is genuinely unmatched for review.
  const treatRemainingUpstoxAsStandalone = !indmoney || !indmoneyHasUpstoxRows;
  const unmatchedUpstox: UnmatchedCandidate[] = [];

  for (const u of availableUpstoxEquity.values()) {
    if (treatRemainingUpstoxAsStandalone) {
      nonSyncedUpstoxEquityCurrent += u.currentValue;
      nonSyncedUpstoxEquityInvested += u.investedValue;
    } else {
      unmatchedUpstox.push({
        source: 'upstox',
        name: u.companyName,
        symbol: u.symbol,
        quantity: u.quantity,
        value: u.currentValue,
        unitPrice: u.lastPrice
      });
      trueIndmoneyReconciledStockInvested += u.investedValue;
    }

    equities.push({
      id: treatRemainingUpstoxAsStandalone ? `up-standalone:${u.symbol}` : `unmatched-up:${u.symbol}`,
      symbol: u.symbol,
      name: u.companyName,
      isin: u.isin,
      broker: 'Upstox',
      isExternalBroker: false,
      isNonEquity: false,
      quantity: u.quantity,
      averagePrice: round2(u.averagePrice),
      lastPrice: round2(u.lastPrice),
      investedValue: round2(u.investedValue),
      currentValue: round2(u.currentValue),
      pnl: round2(u.pnl),
      pnlPct: u.investedValue > 0 ? round2((u.pnl / u.investedValue) * 100) : 0,
      dayChangePct: round2(u.dayChangePct),
      marketCap: 'unknown',
      costBasisSource: 'upstox_live',
      matchStatus: treatRemainingUpstoxAsStandalone ? 'upstox_standalone' : 'unmatched_upstox',
      upstoxQty: u.quantity,
      upstoxValue: round2(u.currentValue)
    });
  }

  // Add Upstox non-equity holdings (NCDs/Bonds) clearly flagged
  let upstoxBondsCurrent = 0;
  let upstoxBondsInvested = 0;
  for (const bond of nonEquityUpstox) {
    upstoxBondsCurrent += bond.currentValue;
    upstoxBondsInvested += bond.investedValue;
    equities.push({
      id: `bond:${bond.symbol}`,
      symbol: bond.symbol,
      name: bond.companyName,
      isin: bond.isin,
      broker: 'Upstox',
      isExternalBroker: false,
      isNonEquity: true,
      quantity: bond.quantity,
      averagePrice: round2(bond.averagePrice),
      lastPrice: round2(bond.lastPrice),
      investedValue: round2(bond.investedValue),
      currentValue: round2(bond.currentValue),
      pnl: round2(bond.pnl),
      pnlPct: bond.investedValue > 0 ? round2((bond.pnl / bond.investedValue) * 100) : 0,
      dayChangePct: round2(bond.dayChangePct),
      marketCap: 'debt',
      costBasisSource: 'upstox_live',
      matchStatus: 'non_equity',
      upstoxQty: bond.quantity,
      upstoxValue: round2(bond.currentValue)
    });
  }

  equities.sort((a, b) => b.currentValue - a.currentValue);

  const upstoxEquityTotal = upstoxNormalized
    .filter((u) => !u.isNonEquity)
    .reduce((sum, u) => sum + u.currentValue, 0);

  // Mutual Funds (INDmoney + deduplicated Upstox MF holdings)
  const mutualFunds: ReconciledMutualFund[] = (indmoney?.mutualFunds || []).map((m) => {
    const name = m.investment || 'Unknown Fund';
    const lower = name.toLowerCase();
    const assetClass = (m.assetclass_l2 || 'equity').toLowerCase();
    const isLiquid = assetClass === 'liquid' || lower.includes('liquid') || lower.includes('overnight');
    const isArbitrage = lower.includes('arbitrage');
    return {
      name,
      code: String(m.investment_code || ''),
      broker: (m.broker || 'INDmoney').trim(),
      units: Number(m.total_units ?? 0),
      nav: Number(m.unit_price ?? 0),
      investedValue: Number(m.invested_amount ?? 0),
      currentValue: Number(m.market_value ?? 0),
      pnl: Number(m.total_pnl ?? 0),
      pnlPct: Number(m.pnl_per ?? 0),
      dayChange: Number(m.one_day_change ?? 0),
      dayChangePct: Number(m.one_day_change_percentage ?? 0),
      assetClass,
      isLiquid,
      isArbitrage
    };
  });

  let addedUpstoxMfCurrent = 0;
  let addedUpstoxMfInvested = 0;
  if (upstoxActive && upstox?.mfHoldings && upstox.mfHoldings.length > 0) {
    const existingMfNames = new Set(mutualFunds.map((m) => normalizeCompact(m.name)));
    for (const um of upstox.mfHoldings) {
      const name = (um.fund || um.scheme_name || '').trim();
      const units = Number(um.units ?? um.quantity ?? 0);
      if (!name || units <= 0) continue;
      const normName = normalizeCompact(name);
      if (existingMfNames.has(normName)) continue;
      existingMfNames.add(normName);

      const nav = Number(um.nav ?? um.last_price ?? 0);
      const currentValue = Number(um.current_value ?? units * nav);
      const investedValue = Number(um.invested_value ?? units * Number(um.average_price ?? nav));
      const pnl = Number(um.pnl ?? currentValue - investedValue);
      const pnlPct = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
      const lower = name.toLowerCase();

      addedUpstoxMfCurrent += currentValue;
      addedUpstoxMfInvested += investedValue;

      mutualFunds.push({
        name,
        code: (um.isin || um.instrument_key || name).trim(),
        isin: (um.isin || um.instrument_key || '').trim(),
        broker: 'Upstox',
        units,
        nav,
        investedValue: round2(investedValue),
        currentValue: round2(currentValue),
        pnl: round2(pnl),
        pnlPct: round2(pnlPct),
        dayChange: 0,
        dayChangePct: 0,
        assetClass: lower.includes('liquid') || lower.includes('overnight') ? 'liquid' : 'equity',
        isLiquid: lower.includes('liquid') || lower.includes('overnight'),
        isArbitrage: lower.includes('arbitrage')
      });
    }
  }

  mutualFunds.sort((a, b) => b.currentValue - a.currentValue);

  // Active SIPs merged & deduplicated across all brokers (INDmoney MF + Stock SIPs, Upstox MF SIPs)
  const activeSips: ActiveSipRecord[] = [];
  const seenSipKeys = new Set<string>();

  const normalizeFreq = (raw?: string): ActiveSipRecord['frequency'] => {
    const upper = (raw || 'OTHER').toUpperCase();
    if (upper.includes('WEEK')) return 'WEEKLY';
    if (upper.includes('MONTH')) return 'MONTHLY';
    if (upper.includes('DAY') || upper === 'DAILY') return 'DAILY';
    return 'OTHER';
  };

  const registerSip = (sip: ActiveSipRecord) => {
    const idPart = sip.isin ? sip.isin.toUpperCase() : normalizeCompact(sip.fundName);
    const dedupeKey = `${sip.instrumentType}|${idPart}|${Math.round(sip.amount)}|${sip.frequency}`;
    if (seenSipKeys.has(dedupeKey)) return;
    seenSipKeys.add(dedupeKey);
    activeSips.push(sip);
  };

  // 1. INDmoney Mutual Fund SIPs
  for (const s of indmoney?.mfSips || []) {
    for (const sip of s.active_sips || []) {
      const freq = normalizeFreq(sip.sip_frequency);
      const amt = Number(sip.amount ?? 0);
      if (amt <= 0) continue;
      registerSip({
        fundName: s.name,
        broker: 'INDmoney',
        instrumentType: 'MF',
        isin: (s.isin || '').trim(),
        category: s.category || 'Mutual Fund',
        planType: s.planType || '',
        amount: amt,
        frequency: freq,
        startDate: sip.sip_start_date || '',
        sipType: sip.sip_type || '',
        folioId: s.folio_id || '',
        investedValue: Number(s.investedAmountVal ?? 0),
        currentValue: Number(s.currentValueVal ?? 0),
        gainPct: Number(s.gainPercentageVal ?? 0)
      });
    }
  }

  // 2. INDmoney Indian Stock SIPs
  for (const ss of indmoney?.stockSips || []) {
    const status = (ss.status || 'ACTIVE').toUpperCase();
    if (['CANCELLED', 'PAUSED', 'STOPPED', 'COMPLETED', 'INACTIVE'].includes(status)) continue;
    const name = (ss.name || ss.stock_name || ss.symbol || '').trim();
    const amt = Number(ss.amount ?? ss.sip_amount ?? 0);
    if (!name || amt <= 0) continue;
    registerSip({
      fundName: name,
      broker: 'INDmoney',
      instrumentType: 'STOCK',
      isin: (ss.isin || '').trim(),
      category: 'Stock SIP',
      planType: 'equity',
      amount: amt,
      frequency: normalizeFreq(ss.frequency || ss.sip_frequency),
      startDate: ss.start_date || ss.sip_start_date || '',
      nextInstallmentDate: ss.next_execution_date || undefined,
      sipType: 'stock_sip',
      folioId: '',
      investedValue: Number(ss.invested_amount ?? 0),
      currentValue: Number(ss.current_value ?? 0),
      gainPct: Number(ss.gain_pct ?? 0)
    });
  }

  // 3. Upstox Mutual Fund SIPs (strictly ACTIVE mandates; filters out CANCELLED/COMPLETED)
  if (upstoxActive && upstox?.mfSips && upstox.mfSips.length > 0) {
    const mfByIsinOrName = new Map<string, ReconciledMutualFund>();
    for (const m of mutualFunds) {
      if (m.isin) mfByIsinOrName.set(m.isin.toUpperCase(), m);
      mfByIsinOrName.set(normalizeCompact(m.name), m);
    }

    for (const us of upstox.mfSips) {
      const status = (us.status || '').toUpperCase().trim();
      if (status !== 'ACTIVE' && status !== 'RUNNING' && status !== 'OPEN') continue;

      const name = (us.fund || us.scheme_name || '').trim();
      const amt = Number(us.instalment_amount ?? us.amount ?? 0);
      if (!name || amt <= 0) continue;

      const isin = (us.isin || us.instrument_key || '').trim();
      const matchedMf =
        (isin ? mfByIsinOrName.get(isin.toUpperCase()) : undefined) || mfByIsinOrName.get(normalizeCompact(name));

      registerSip({
        fundName: name,
        broker: 'Upstox',
        instrumentType: 'MF',
        isin,
        category: 'Mutual Fund',
        planType: name.toLowerCase().includes('direct') ? 'direct' : 'regular',
        amount: amt,
        frequency: normalizeFreq(us.frequency),
        startDate: (us.created || '').split(' ')[0] || '',
        nextInstallmentDate: us.next_instalment || undefined,
        sipType: us.sip_type || 'upstox_sip',
        folioId: us.sip_id || '',
        investedValue: matchedMf?.investedValue ?? 0,
        currentValue: matchedMf?.currentValue ?? 0,
        gainPct: matchedMf?.pnlPct ?? 0
      });
    }
  }

  let weeklySipOutflow = 0;
  let monthlySipOutflow = 0;
  let dailySipOutflow = 0;
  for (const sip of activeSips) {
    if (sip.frequency === 'WEEKLY') weeklySipOutflow += sip.amount;
    else if (sip.frequency === 'MONTHLY') monthlySipOutflow += sip.amount;
    else if (sip.frequency === 'DAILY') dailySipOutflow += sip.amount;
  }

  const estimatedMonthlySipTotal = Math.round(weeklySipOutflow * 4.33 + monthlySipOutflow + dailySipOutflow * 21.7);

  // Net Worth & Adjusted Allocations (supports INDmoney+Upstox, INDmoney-only, AND Upstox-only!)
  const upstoxMargin = Number(upstox?.funds?.availableMargin ?? 0);
  let totalNetworth = 0;
  let totalInvestedRaw = 0;
  let totalInvestedAdjusted = 0;
  let totalLiabilities = 0;
  let allocations: AssetAllocationItem[] = [];

  if (indmoney) {
    const nw = indmoney.networth;
    const baseNetworth = Number(nw.total_networth ?? nw.total_current_value ?? 0);
    const baseRawInvested = Number(nw.total_invested ?? 0);
    const indStockRow = (nw.investments || []).find((a) => a.asset_type === 'STOCK');
    const indStockRawInvested = Number(indStockRow?.invested_value ?? 0);

    // Add any standalone Upstox equities/MFs that were NOT already synced into INDmoney
    const extraCurrent = nonSyncedUpstoxEquityCurrent + addedUpstoxMfCurrent;
    const extraInvested = nonSyncedUpstoxEquityInvested + addedUpstoxMfInvested;
    const totalTrueStockInvested = trueIndmoneyReconciledStockInvested + nonSyncedUpstoxEquityInvested;

    totalNetworth = baseNetworth + extraCurrent;
    totalInvestedRaw = baseRawInvested + extraInvested;
    totalInvestedAdjusted =
      upstoxActive || upstoxState === 'stale_reauth_required' || indStocks.some(hasNativeIndmoneyCostBasis)
        ? Math.max(0, baseRawInvested - indStockRawInvested + totalTrueStockInvested + addedUpstoxMfInvested)
        : totalInvestedRaw;
    totalLiabilities = Number(nw.liabilities?.total ?? 0);

    const allocMap = new Map<string, { invested: number; current: number }>();
    for (const a of nw.investments || []) {
      const cur = Number(a.current_value ?? 0);
      const inv = Number(a.invested_value ?? 0);
      if (cur <= 0 && inv <= 0) continue;
      if (a.asset_type === 'STOCK') {
        allocMap.set('STOCK', {
          invested: totalTrueStockInvested,
          current: cur + nonSyncedUpstoxEquityCurrent
        });
      } else if (a.asset_type === 'MF') {
        allocMap.set('MF', {
          invested: inv + addedUpstoxMfInvested,
          current: cur + addedUpstoxMfCurrent
        });
      } else {
        allocMap.set(a.asset_type, { invested: inv, current: cur });
      }
    }

    if (!allocMap.has('STOCK') && nonSyncedUpstoxEquityCurrent > 0) {
      allocMap.set('STOCK', { invested: nonSyncedUpstoxEquityInvested, current: nonSyncedUpstoxEquityCurrent });
    }
    if (!allocMap.has('MF') && addedUpstoxMfCurrent > 0) {
      allocMap.set('MF', { invested: addedUpstoxMfInvested, current: addedUpstoxMfCurrent });
    }

    allocations = Array.from(allocMap.entries())
      .map(([assetType, { invested, current }]) => {
        const ret = current - invested;
        const retPct = invested > 0 ? (ret / invested) * 100 : 0;
        const weightPct = totalNetworth > 0 ? (current / totalNetworth) * 100 : 0;
        return {
          assetType,
          investedValue: round2(invested),
          currentValue: round2(current),
          returnValue: round2(ret),
          returnPct: round2(retPct),
          weightPct: round2(weightPct)
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue);
  } else {
    // Standalone Upstox-only mode
    const buckets: Array<{ type: string; invested: number; current: number }> = [
      { type: 'STOCK', invested: nonSyncedUpstoxEquityInvested, current: nonSyncedUpstoxEquityCurrent },
      { type: 'MF', invested: addedUpstoxMfInvested, current: addedUpstoxMfCurrent },
      { type: 'BOND', invested: upstoxBondsInvested, current: upstoxBondsCurrent },
      { type: 'CASH', invested: upstoxMargin, current: upstoxMargin }
    ].filter((b) => b.current > 0 || b.invested > 0);

    totalNetworth = buckets.reduce((s, b) => s + b.current, 0);
    totalInvestedRaw = buckets.reduce((s, b) => s + b.invested, 0);
    totalInvestedAdjusted = totalInvestedRaw;
    totalLiabilities = 0;

    allocations = buckets
      .map((b) => {
        const ret = b.current - b.invested;
        return {
          assetType: b.type,
          investedValue: round2(b.invested),
          currentValue: round2(b.current),
          returnValue: round2(ret),
          returnPct: b.invested > 0 ? round2((ret / b.invested) * 100) : 0,
          weightPct: totalNetworth > 0 ? round2((b.current / totalNetworth) * 100) : 0
        };
      })
      .sort((a, b) => b.currentValue - a.currentValue);
  }

  const totalUnrealizedGain = totalNetworth - totalInvestedAdjusted;
  const totalUnrealizedGainPct =
    totalInvestedAdjusted > 0 ? (totalUnrealizedGain / totalInvestedAdjusted) * 100 : 0;

  const savingsAccountBalance = allocations.find((a) => a.assetType === 'SA')?.currentValue ?? 0;
  const arbitrageTotal = mutualFunds.filter((m) => m.isArbitrage).reduce((s, m) => s + m.currentValue, 0);
  const liquidCorpusTotal = mutualFunds.filter((m) => m.isLiquid).reduce((s, m) => s + m.currentValue, 0);
  const emergencyCushionTotal = arbitrageTotal + savingsAccountBalance;

  const matchedCount = equities.filter((e) => e.matchStatus === 'matched').length;
  const externalCount = equities.filter(
    (e) => e.matchStatus === 'external' || e.matchStatus === 'upstox_standalone'
  ).length;
  const nonEquityCount = equities.filter((e) => e.isNonEquity).length;
  const aggregateDiff =
    upstoxActive && indmoney && indmoneyHasUpstoxRows
      ? round2(indmoneyStockTotal - (upstoxEquityTotal + externalStockTotal))
      : 0;

  const baseSnapshot: PortfolioSnapshot = {
    isDemo,
    fetchedAt,
    snapshotDate,
    upstoxState,
    totalNetworth: round2(totalNetworth),
    totalInvestedRaw: round2(totalInvestedRaw),
    totalInvestedAdjusted: round2(totalInvestedAdjusted),
    totalUnrealizedGain: round2(totalUnrealizedGain),
    totalUnrealizedGainPct: round2(totalUnrealizedGainPct),
    totalLiabilities: round2(totalLiabilities),
    upstoxAvailableMargin: round2(upstoxMargin),
    savingsAccountBalance: round2(savingsAccountBalance),
    emergencyCushionTotal: round2(emergencyCushionTotal),
    liquidCorpusTotal: round2(liquidCorpusTotal),
    weeklySipOutflow: round2(weeklySipOutflow),
    monthlySipOutflow: round2(monthlySipOutflow),
    estimatedMonthlySipTotal,
    allocations,
    equities,
    mutualFunds,
    activeSips,
    reconciliation: {
      matchedCount,
      externalCount,
      nonEquityCount,
      discrepancies,
      unmatchedIndmoney,
      unmatchedUpstox,
      indmoneyStockTotal: round2(indmoneyStockTotal),
      upstoxEquityTotal: round2(upstoxEquityTotal),
      externalStockTotal: round2(externalStockTotal),
      aggregateDiff
    }
  };

  if (input.costOverrides && input.costOverrides.length > 0) {
    return applyCostOverridesToSnapshot(baseSnapshot, input.costOverrides).snapshot;
  }
  return baseSnapshot;
}

export function findMatchingCostOverride(
  equity: ReconciledEquity,
  overrides: CostBasisOverride[]
): CostBasisOverride | null {
  if (overrides.length === 0) return null;

  const eqIsin = (equity.isin || '').trim().toUpperCase();
  const eqSym = (equity.symbol || '').trim().toUpperCase();
  const eqNormName = normalizeCompact(equity.name);
  const eqIdKey = `id:${equity.id.toLowerCase()}`;

  // Prefer explicit manual overrides over CSV imports if both exist
  const ordered = [...overrides].sort((a, b) => (a.source === 'manual' ? -1 : b.source === 'manual' ? 1 : 0));

  for (const ov of ordered) {
    // Respect broker filter when present on CSV import (unless exact ISIN/manual id match)
    if (ov.holdingKey === eqIdKey) return ov;
    if (eqIsin && ov.isin && ov.isin.toUpperCase() === eqIsin) return ov;
    if (eqSym && ov.symbol && ov.symbol.toUpperCase() === eqSym) return ov;
    if (eqNormName && normalizeCompact(ov.displayName) === eqNormName) return ov;
    if (ov.symbol && eqNormName && normalizeCompact(ov.symbol) === eqNormName) return ov;
  }

  // Secondary fuzzy token match for ETFs / external holdings with minor naming differences
  for (const ov of ordered) {
    if (tokenSimilarity(equity.name, ov.displayName) >= 0.75) {
      return ov;
    }
  }

  return null;
}

/**
 * Applies saved manual & CSV average-cost overrides to a snapshot and recalculates
 * equity P&L, STOCK allocation, and total adjusted invested / unrealized gain.
 */
export function applyCostOverridesToSnapshot(
  snapshot: PortfolioSnapshot,
  overrides: CostBasisOverride[]
): { snapshot: PortfolioSnapshot; matchedCount: number } {
  let matchedCount = 0;
  let investedDelta = 0;

  const nextEquities = snapshot.equities.map((e) => {
    if (e.isNonEquity) return e;
    const match = findMatchingCostOverride(e, overrides);
    if (!match || match.averagePrice <= 0) return e;

    // CSV imports fill missing/previous-override cost basis without overwriting live Upstox/INDmoney broker cost basis;
    // explicit manual overrides always apply.
    const canApply =
      match.source === 'manual' ||
      e.costBasisSource === 'market_value_proxy' ||
      e.costBasisSource === 'csv_import' ||
      e.costBasisSource === 'manual_override';

    if (!canApply) return e;

    matchedCount += 1;
    const newInvested = round2(e.quantity * match.averagePrice);
    const newPnl = round2(e.currentValue - newInvested);
    const newPnlPct = newInvested > 0 ? round2((newPnl / newInvested) * 100) : 0;
    investedDelta += newInvested - e.investedValue;

    return {
      ...e,
      averagePrice: round2(match.averagePrice),
      investedValue: newInvested,
      pnl: newPnl,
      pnlPct: newPnlPct,
      costBasisSource: match.source === 'csv_import' ? ('csv_import' as const) : ('manual_override' as const)
    };
  });

  if (matchedCount === 0) {
    return { snapshot, matchedCount: 0 };
  }

  const nextTotalInvestedAdjusted = round2(Math.max(0, snapshot.totalInvestedAdjusted + investedDelta));
  const nextTotalGain = round2(snapshot.totalNetworth - nextTotalInvestedAdjusted);
  const nextTotalGainPct =
    nextTotalInvestedAdjusted > 0 ? round2((nextTotalGain / nextTotalInvestedAdjusted) * 100) : 0;

  const nextAllocations = snapshot.allocations.map((a) => {
    if (a.assetType !== 'STOCK') return a;
    const nextStockInv = round2(Math.max(0, a.investedValue + investedDelta));
    const nextStockRet = round2(a.currentValue - nextStockInv);
    const nextStockPct = nextStockInv > 0 ? round2((nextStockRet / nextStockInv) * 100) : 0;
    return {
      ...a,
      investedValue: nextStockInv,
      returnValue: nextStockRet,
      returnPct: nextStockPct
    };
  });

  return {
    matchedCount,
    snapshot: {
      ...snapshot,
      totalInvestedAdjusted: nextTotalInvestedAdjusted,
      totalUnrealizedGain: nextTotalGain,
      totalUnrealizedGainPct: nextTotalGainPct,
      allocations: nextAllocations,
      equities: nextEquities
    }
  };
}

function pushMatchedHolding(
  ind: RawIndmoneyStock,
  up: NormalizedUpstox,
  equities: ReconciledEquity[],
  discrepancies: ReconciliationSummary['discrepancies'],
  profile: UserProfile
): void {
  const indQty = Number(ind.total_units ?? 0);
  const indVal = Number(ind.market_value ?? 0);
  const qtyDiff = indQty - up.quantity;
  const valueDiff = indVal - up.currentValue;

  if (Math.abs(qtyDiff) > profile.discrepancyQtyThreshold || Math.abs(valueDiff) > profile.discrepancyValueThreshold) {
    discrepancies.push({
      name: ind.investment,
      symbol: up.symbol,
      indmoneyQty: round2(indQty),
      upstoxQty: round2(up.quantity),
      indmoneyValue: round2(indVal),
      upstoxValue: round2(up.currentValue),
      qtyDiff: round2(qtyDiff),
      valueDiff: round2(valueDiff)
    });
  }

  const pnlPct = up.investedValue > 0 ? (up.pnl / up.investedValue) * 100 : 0;

  equities.push({
    id: `up:${up.symbol}`,
    symbol: up.symbol,
    name: ind.investment,
    isin: up.isin,
    broker: 'Upstox',
    isExternalBroker: false,
    isNonEquity: false,
    quantity: up.quantity,
    averagePrice: round2(up.averagePrice),
    lastPrice: round2(up.lastPrice),
    investedValue: round2(up.investedValue),
    currentValue: round2(up.currentValue),
    pnl: round2(up.pnl),
    pnlPct: round2(pnlPct),
    dayChangePct: round2(up.dayChangePct),
    marketCap: (ind.market_cap || 'unknown').toLowerCase(),
    costBasisSource: 'upstox_live',
    matchStatus: 'matched',
    indmoneyQty: indQty,
    upstoxQty: up.quantity,
    indmoneyValue: round2(indVal),
    upstoxValue: round2(up.currentValue)
  });
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
