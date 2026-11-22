import {
  ActiveSipRecord,
  AssetAllocationItem,
  CostBasisOverride,
  IndmoneyFetchPayload,
  PortfolioSnapshot,
  RawIndmoneyBond,
  RawIndmoneyStock,
  RawUpstoxHolding,
  ReconciledBond,
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
  finl: 'financial',
  in: 'investment',
  inv: 'investment',
  co: 'company',
  nip: 'nippon',
  vn: 'ventures',
  dev: 'developers',
  pharma: 'pharmaceutical',
  pharm: 'pharmaceutical',
  intl: 'international',
  eng: 'engineering',
  infra: 'infrastructure',
  tech: 'technologies',
  mfg: 'manufacturing',
  petro: 'petroleum',
  elec: 'electronics',
  aero: 'aeronautics',
  ent: 'enterprises',
  entp: 'enterprises',
  cap: 'capital',
  pow: 'power',
  isp: 'ispat',
  chem: 'chemicals',
  hosp: 'hospitals',
  cons: 'consumer',
  prod: 'products',
  sol: 'solutions',
  sys: 'systems',
  comm: 'communications',
  auto: 'automotive',
  sec: 'securities',
  hsg: 'housing',
  fert: 'fertilizers',
  ref: 'refineries',
  lab: 'laboratories',
  labs: 'laboratories',
  mgt: 'management',
  mgmt: 'management',
  hldg: 'holdings',
  hldgs: 'holdings'
};

export function normalizeCompanyName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/['’]/g, '')
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
 * Extracts alternate names from brand-prefixed or parenthetical broker labels, e.g.:
 * - "LT - Larsen & Toubro" -> ["LT - Larsen & Toubro", "LT", "Larsen & Toubro"]
 * - "Groww - Billionbrains Garage Ventures" -> [..., "Groww", "Billionbrains Garage Ventures"]
 * - "FSN E-Commerce Ventures (Nykaa)" -> [..., "FSN E-Commerce Ventures", "Nykaa"]
 */
export function extractNameVariants(raw: string): string[] {
  const trimmed = (raw || '').trim();
  if (!trimmed) return [];
  const variants = new Set<string>([trimmed]);

  const splitDash = trimmed.split(/\s+[-–—|]\s+/);
  if (splitDash.length >= 2) {
    for (const part of splitDash) {
      const clean = part.trim();
      if (clean.length >= 2) variants.add(clean);
    }
  }

  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    if (parenMatch[1].trim().length >= 2) variants.add(parenMatch[1].trim());
    if (parenMatch[2].trim().length >= 2) variants.add(parenMatch[2].trim());
  }

  return Array.from(variants);
}

function canonicalBrokerName(broker?: string | null): string {
  const compact = (broker || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!compact || compact === 'unknown' || compact === 'multiple' || compact === 'other' || compact === 'external') {
    return '';
  }
  if (compact.includes('paytm')) return 'paytm';
  if (compact.includes('zerodha') || compact.includes('kite')) return 'zerodha';
  if (compact.includes('upstox') || compact.includes('rksv')) return 'upstox';
  if (compact.includes('groww')) return 'groww';
  if (compact.includes('angel')) return 'angelone';
  if (compact.includes('icici')) return 'icicidirect';
  if (compact.includes('hdfc')) return 'hdfcsec';
  if (compact.includes('kotak')) return 'kotaksec';
  if (compact.includes('pinnacle')) return 'pinnacle';
  if (compact.includes('dhan')) return 'dhan';
  if (compact.includes('indmoney')) return 'indmoney';
  return compact;
}

function brokersMatch(a?: string | null, b?: string | null): boolean {
  const ca = canonicalBrokerName(a);
  const cb = canonicalBrokerName(b);
  return ca.length > 0 && ca === cb;
}

function brokersConflict(overrideBroker?: string | null, holdingBroker?: string | null): boolean {
  const ca = canonicalBrokerName(overrideBroker);
  const cb = canonicalBrokerName(holdingBroker);
  // If either side is unspecified, or holding is labeled generic INDmoney (which may aggregate external brokers), do not block.
  if (!ca || !cb || cb === 'indmoney') return false;
  return ca !== cb;
}

export function classifyBondType(
  name: string,
  symbol?: string | null,
  isin?: string | null
): ReconciledBond['bondType'] {
  const upperName = (name || '').toUpperCase();
  const upperSym = (symbol || '').toUpperCase().trim();
  const upperIsin = (isin || '').toUpperCase().trim();

  if (/\bSGB\b|SOVEREIGN\s+GOLD/.test(upperName) || upperSym.startsWith('SGB')) {
    return 'SGB';
  }
  if (
    /\b(NCD|DEBENTURE)\b/.test(upperName) ||
    /^\d{3,}[A-Z]+\d{2}$/.test(upperSym) ||
    (upperIsin.length === 12 && upperIsin.startsWith('INE') && ['07', '08'].includes(upperIsin.slice(7, 9)))
  ) {
    return 'NCD';
  }
  if (
    /\b(G-SEC|GSEC|GOI|T-BILL|TBILL|SDL)\b/.test(upperName) ||
    /^GS\d{4}/.test(upperSym) ||
    upperIsin.startsWith('IN00')
  ) {
    return 'G-Sec';
  }
  return 'Bond';
}

export function isIndmoneyBondOrSgb(item: {
  investment: string;
  investment_code?: string;
  isin?: string | null;
  assetclass_l2?: string | null;
}): boolean {
  const name = (item.investment || '').toUpperCase();
  const code = (item.investment_code || '').toUpperCase().trim();
  const isin = (item.isin || '').toUpperCase().trim();
  const assetClass = (item.assetclass_l2 || '').toLowerCase().trim();

  if (isin.startsWith('IN00')) return true;
  if (isin.length === 12 && isin.startsWith('INE')) {
    const secType = isin.slice(7, 9);
    if (secType === '07' || secType === '08' || secType === '11') return true;
  }
  if (/\b(SGB|SOVEREIGN\s+GOLD\s+BOND|NCD|DEBENTURE|G-SEC|GSEC|T-BILL|TBILL)\b/.test(name)) return true;
  if (code.startsWith('SGB') || /^\d{3,}[A-Z]+\d{2}$/.test(code)) return true;
  if (!/\bETF\b/.test(name) && /\bBOND\b/.test(name)) return true;
  if (!/\bETF\b/.test(name) && (assetClass === 'debt' || assetClass === 'bond' || assetClass === 'bonds')) return true;

  return false;
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

function computeTokenOverlap(a: string, b: string): { overlap: number; sizeA: number; sizeB: number } {
  const tokensA = new Set(normalizeCompanyName(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeCompanyName(b).split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return { overlap: 0, sizeA: tokensA.size, sizeB: tokensB.size };

  let overlap = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      overlap += 1;
      continue;
    }
    for (const tb of tokensB) {
      if (t.length >= 3 && tb.length >= 3 && (t.startsWith(tb) || tb.startsWith(t))) {
        overlap += 0.85;
        break;
      }
    }
  }
  return { overlap, sizeA: tokensA.size, sizeB: tokensB.size };
}

function tokenSimilarity(a: string, b: string): number {
  const { overlap, sizeA, sizeB } = computeTokenOverlap(a, b);
  if (sizeA === 0 || sizeB === 0) return 0;
  return overlap / Math.max(sizeA, sizeB);
}

function subsetTokenSimilarity(a: string, b: string): { ratio: number; minSize: number; overlap: number } {
  const { overlap, sizeA, sizeB } = computeTokenOverlap(a, b);
  const minSize = Math.min(sizeA, sizeB);
  if (minSize === 0) return { ratio: 0, minSize: 0, overlap: 0 };
  return { ratio: overlap / minSize, minSize, overlap };
}

function hasAcronymMatch(nameA: string, nameB: string): boolean {
  const variantsA = extractNameVariants(nameA);
  const variantsB = extractNameVariants(nameB);
  for (const va of variantsA) {
    const compactA = normalizeSymbolCompact(va);
    const acroA = buildCompanyAcronyms(va);
    for (const vb of variantsB) {
      const compactB = normalizeSymbolCompact(vb);
      const acroB = buildCompanyAcronyms(vb);
      if (compactA.length >= 2 && compactA.length <= 6 && acroB.has(compactA)) return true;
      if (compactB.length >= 2 && compactB.length <= 6 && acroA.has(compactB)) return true;
    }
  }
  return false;
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
  const bonds: ReconciledBond[] = [];
  const seenBondKeys = new Set<string>();
  const discrepancies: ReconciliationSummary['discrepancies'] = [];
  const unmatchedIndmoney: UnmatchedCandidate[] = [];

  const registerBond = (bond: ReconciledBond) => {
    const isinKey = bond.isin ? `isin:${bond.isin.toUpperCase()}` : '';
    const nameKey = `name:${normalizeCompact(bond.name)}`;
    if ((isinKey && seenBondKeys.has(isinKey)) || seenBondKeys.has(nameKey)) {
      // If Upstox live data arrives for a bond already added from INDmoney without real cost basis, upgrade its cost basis
      if (bond.costBasisSource === 'upstox_live') {
        const existingIdx = bonds.findIndex(
          (b) => (isinKey && b.isin.toUpperCase() === bond.isin.toUpperCase()) || normalizeCompact(b.name) === normalizeCompact(bond.name)
        );
        if (existingIdx !== -1 && bonds[existingIdx].costBasisSource === 'market_value_proxy') {
          bonds[existingIdx] = {
            ...bonds[existingIdx],
            averagePrice: bond.averagePrice,
            investedValue: bond.investedValue,
            pnl: bond.pnl,
            pnlPct: bond.pnlPct,
            costBasisSource: 'upstox_live'
          };
        }
      }
      return;
    }
    if (isinKey) seenBondKeys.add(isinKey);
    seenBondKeys.add(nameKey);
    bonds.push(bond);
  };

  let indmoneyStockTotal = 0;
  let externalStockTotal = 0;
  let nonSyncedUpstoxEquityCurrent = 0;
  let nonSyncedUpstoxEquityInvested = 0;
  let trueIndmoneyReconciledStockInvested = 0;

  const pendingUpstoxMatchStocks: RawIndmoneyStock[] = [];

  // Pass 1: Separate SGBs/Bonds + external/native INDmoney stocks vs Upstox-broker rows (plus Tier 1 ISIN/Alias matching)
  for (const s of indStocks) {
    const mktVal = Number(s.market_value ?? 0);
    const units = Number(s.total_units ?? 0);
    const unitPrice = Number(s.unit_price ?? (units > 0 ? mktVal / units : 0));
    indmoneyStockTotal += mktVal;

    const brokerLabel = (s.broker || (indmoneyHasUpstoxRows ? 'Unknown' : 'INDmoney')).trim();
    const belongsToUpstox = isUpstoxBrokerLabel(s.broker);

    // Route SGBs, NCDs, G-Secs & Bonds that appear inside INDmoney's IND_STOCK holdings into the dedicated Bonds section
    if (isIndmoneyBondOrSgb(s)) {
      externalStockTotal += mktVal;
      const nativeCost = hasNativeIndmoneyCostBasis(s);
      const investedVal = nativeCost ? Number(s.invested_amount) : mktVal;
      const pnl = nativeCost ? Number(s.total_pnl ?? mktVal - investedVal) : 0;
      const pnlPct = nativeCost && investedVal > 0 ? (pnl / investedVal) * 100 : 0;
      trueIndmoneyReconciledStockInvested += investedVal;

      registerBond({
        id: `bond:indstock:${brokerLabel.toLowerCase()}:${s.investment_code || s.investment}`,
        name: s.investment,
        symbol: s.investment_code || s.investment.slice(0, 14).toUpperCase(),
        isin: (s.isin || '').trim(),
        bondType: classifyBondType(s.investment, s.investment_code, s.isin),
        broker: brokerLabel,
        quantity: units,
        averagePrice: nativeCost && units > 0 ? round2(investedVal / units) : null,
        lastPrice: round2(unitPrice),
        investedValue: round2(investedVal),
        currentValue: round2(mktVal),
        pnl: round2(pnl),
        pnlPct: round2(pnlPct),
        costBasisSource: nativeCost ? 'indmoney_native' : 'market_value_proxy'
      });
      continue;
    }

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

  // Add INDmoney dedicated BOND holdings (e.g., SGBs, NCDs, Corporate Bonds)
  for (const b of indmoney?.bonds || ([] as RawIndmoneyBond[])) {
    const mktVal = Number(b.market_value ?? 0);
    const units = Number(b.total_units ?? 0);
    if (mktVal <= 0 && units <= 0) continue;
    const unitPrice = Number(b.unit_price ?? (units > 0 ? mktVal / units : 0));
    const rawInv = typeof b.invested_amount === 'number' ? b.invested_amount : Number(b.invested_amount ?? 0);
    const pnlVal = Number(b.total_pnl ?? 0);
    const hasRealCost = Number.isFinite(rawInv) && rawInv > 0 && (Math.abs(pnlVal) > 0.01 || Math.abs(rawInv - mktVal) > 0.01);
    const investedVal = hasRealCost ? rawInv : mktVal;
    const pnl = hasRealCost ? Number(b.total_pnl ?? mktVal - investedVal) : 0;
    const pnlPct = hasRealCost && investedVal > 0 ? (pnl / investedVal) * 100 : 0;
    const brokerLabel = (b.broker || 'INDmoney').trim();

    registerBond({
      id: `bond:ind:${b.investment_code || b.investment}`,
      name: b.investment,
      symbol: b.investment_code || b.investment.slice(0, 14).toUpperCase(),
      isin: (b.isin || '').trim(),
      bondType: classifyBondType(b.investment, b.investment_code, b.isin),
      broker: brokerLabel,
      quantity: units,
      averagePrice: hasRealCost && units > 0 ? round2(investedVal / units) : null,
      lastPrice: round2(unitPrice),
      investedValue: round2(investedVal),
      currentValue: round2(mktVal),
      pnl: round2(pnl),
      pnlPct: round2(pnlPct),
      costBasisSource: hasRealCost ? 'indmoney_native' : 'market_value_proxy'
    });
  }

  // Add Upstox non-equity holdings (NCDs/SGBs/G-Secs/Bonds) into the dedicated Bonds section
  let upstoxBondsCurrent = 0;
  let upstoxBondsInvested = 0;
  for (const bond of nonEquityUpstox) {
    upstoxBondsCurrent += bond.currentValue;
    upstoxBondsInvested += bond.investedValue;
    registerBond({
      id: `bond:up:${bond.symbol}`,
      name: bond.companyName,
      symbol: bond.symbol,
      isin: bond.isin,
      bondType: classifyBondType(bond.companyName, bond.symbol, bond.isin),
      broker: 'Upstox',
      quantity: bond.quantity,
      averagePrice: round2(bond.averagePrice),
      lastPrice: round2(bond.lastPrice),
      investedValue: round2(bond.investedValue),
      currentValue: round2(bond.currentValue),
      pnl: round2(bond.pnl),
      pnlPct: bond.investedValue > 0 ? round2((bond.pnl / bond.investedValue) * 100) : 0,
      costBasisSource: 'upstox_live'
    });
  }

  equities.sort((a, b) => b.currentValue - a.currentValue);
  bonds.sort((a, b) => b.currentValue - a.currentValue);

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
  const nonEquityCount = bonds.length;
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
    bonds,
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

interface MatchableHolding {
  id: string;
  name: string;
  symbol: string;
  isin: string;
  broker: string;
  quantity: number;
  lastPrice: number;
  investedValue: number;
  currentValue: number;
  costBasisSource: string;
}

function isPriceNear(csvPrice: number | undefined, holdingPrice: number, pctTol = 0.025, absFloor = 1.5): boolean {
  if (!csvPrice || csvPrice <= 0 || holdingPrice <= 0) return false;
  return Math.abs(csvPrice - holdingPrice) <= Math.max(absFloor, holdingPrice * pctTol);
}

function scoreOverrideLexicalMatch(holding: MatchableHolding, ov: CostBasisOverride): number {
  const hIdKey = `id:${holding.id.toLowerCase()}`;
  if (ov.holdingKey === hIdKey) return 10;

  const hIsin = (holding.isin || '').trim().toUpperCase();
  if (hIsin && ov.isin && ov.isin.trim().toUpperCase() === hIsin) return 5;

  const hSym = (holding.symbol || '').trim().toUpperCase();
  const ovSym = (ov.symbol || '').trim().toUpperCase();
  if (hSym && ovSym && hSym === ovSym) return 4.5;

  const hVariants = extractNameVariants(holding.name);
  const ovVariants = extractNameVariants(ov.displayName);
  if (ovSym) ovVariants.push(ovSym);

  const hCompacts = new Set(hVariants.map(normalizeCompact).filter(Boolean));
  const hSymCompact = normalizeSymbolCompact(hSym);

  for (const ovVar of ovVariants) {
    const ovCompact = normalizeCompact(ovVar);
    const ovSymCompact = normalizeSymbolCompact(ovVar);
    if (ovCompact && hCompacts.has(ovCompact)) return 4.0;
    if (hSymCompact && ovSymCompact && hSymCompact === ovSymCompact && hSymCompact.length >= 2) return 3.8;
  }

  // Bidirectional acronym match (e.g., "Philips Carbon Black" <-> "PCBL Ltd", "Rural Electrification Corp" <-> "REC Ltd")
  if (hasAcronymMatch(holding.name, ov.displayName)) {
    return isPriceNear(ov.csvCurrentPrice, holding.lastPrice) ? 3.2 : 2.5;
  }

  let bestScore = 0;
  const priceNear = isPriceNear(ov.csvCurrentPrice, holding.lastPrice);

  for (const hv of hVariants) {
    for (const ovv of ovVariants) {
      const tokSim = tokenSimilarity(hv, ovv);
      const sub = subsetTokenSimilarity(hv, ovv);

      if (tokSim >= 0.72) {
        bestScore = Math.max(bestScore, 2.0 + tokSim);
      } else if (sub.minSize >= 2 && sub.ratio >= 0.85) {
        // e.g. "Cholamandalam Investment" vs "Cholamandalam Investment & Finance Company Ltd" (2/2 = 1.0)
        // or "Godawari Pow & Isp" vs "Godawari Power & Ispat Ltd" (3/3 = 1.0)
        bestScore = Math.max(bestScore, 1.85 + sub.ratio * 0.5);
      } else if (priceNear && (tokSim >= 0.45 || (sub.minSize >= 1 && sub.ratio >= 0.75))) {
        bestScore = Math.max(bestScore, 1.5 + Math.max(tokSim, sub.ratio * 0.8));
      }
    }
  }

  return bestScore;
}

export function findMatchingCostOverride(
  holding: Pick<MatchableHolding, 'id' | 'name' | 'symbol' | 'isin' | 'broker' | 'quantity' | 'lastPrice'>,
  overrides: CostBasisOverride[],
  options?: { allowBrokerConflict?: boolean }
): CostBasisOverride | null {
  if (overrides.length === 0) return null;

  let bestOv: CostBasisOverride | null = null;
  let bestRank = 0;

  for (const ov of overrides) {
    if (ov.averagePrice <= 0) continue;
    const hIdKey = `id:${holding.id.toLowerCase()}`;
    const isDirectManualId = ov.holdingKey === hIdKey;

    if (!isDirectManualId && !options?.allowBrokerConflict && ov.source === 'csv_import' && brokersConflict(ov.broker, holding.broker)) {
      continue;
    }

    const baseScore = scoreOverrideLexicalMatch(
      { ...holding, investedValue: 0, currentValue: 0, costBasisSource: '' },
      ov
    );
    if (baseScore <= 0) continue;

    // Prefer manual overrides > broker-matched CSV > exact-qty CSV > general CSV
    let rank = baseScore;
    if (ov.source === 'manual') rank += 5;
    if (brokersMatch(ov.broker, holding.broker)) rank += 1.2;
    if (ov.csvQty !== undefined && Math.abs(ov.csvQty - holding.quantity) < 0.01) rank += 0.6;
    if (isPriceNear(ov.csvCurrentPrice, holding.lastPrice, 0.015, 0.75)) rank += 0.4;

    if (rank > bestRank) {
      bestRank = rank;
      bestOv = ov;
    }
  }

  return bestOv;
}

function buildPartialCostBasisNote(holdingQty: number, ov: CostBasisOverride): string | undefined {
  if (ov.source !== 'csv_import' || !ov.csvQty || ov.csvQty <= 0) return undefined;
  if (Math.abs(holdingQty - ov.csvQty) <= 0.01) return undefined;
  const label = ov.broker ? `${ov.broker} CSV` : 'CSV';
  if (holdingQty > ov.csvQty) {
    const diff = round2(holdingQty - ov.csvQty);
    return `${label} covered ${round2(ov.csvQty)} of ${round2(holdingQty)} units (${diff} in another broker — click Avg Cost to enter blended price)`;
  }
  return `${label} had ${round2(ov.csvQty)} units vs ${round2(holdingQty)} synced — click Avg Cost to verify`;
}

/**
 * Applies saved manual & CSV average-cost overrides to both equities and bonds in a snapshot,
 * recalculates P&L, allocations, and total adjusted invested / unrealized gain, and reports
 * any CSV overrides that could not be matched.
 */
export function applyCostOverridesToSnapshot(
  snapshot: PortfolioSnapshot,
  overrides: CostBasisOverride[]
): {
  snapshot: PortfolioSnapshot;
  matchedCount: number;
  matchedOverrideKeys: string[];
  unmatchedOverrideNames: string[];
} {
  if (overrides.length === 0) {
    return { snapshot, matchedCount: 0, matchedOverrideKeys: [], unmatchedOverrideNames: [] };
  }

  const canApplyOverride = (costBasisSource: string, ov: CostBasisOverride): boolean =>
    ov.source === 'manual' ||
    costBasisSource === 'market_value_proxy' ||
    costBasisSource === 'csv_import' ||
    costBasisSource === 'manual_override';

  const matchedOverrideKeys = new Set<string>();
  const equityMatches = new Map<number, CostBasisOverride>();
  const bondMatches = new Map<number, CostBasisOverride>();
  const currentBonds = snapshot.bonds || [];

  // Pass 1: Direct, broker-aware, and strong lexical/subset/acronym matching across Equities & Bonds
  snapshot.equities.forEach((e, idx) => {
    if (e.isNonEquity) return;
    const match = findMatchingCostOverride(e, overrides);
    if (match && match.averagePrice > 0 && canApplyOverride(e.costBasisSource, match)) {
      equityMatches.set(idx, match);
      matchedOverrideKeys.add(match.holdingKey);
    }
  });

  currentBonds.forEach((b, idx) => {
    const match = findMatchingCostOverride(b, overrides);
    if (match && match.averagePrice > 0 && canApplyOverride(b.costBasisSource, match)) {
      bondMatches.set(idx, match);
      matchedOverrideKeys.add(match.holdingKey);
    }
  });

  // Pass 2: Unclaimed CSV overrides -> unmatched holdings
  // 2a: Aggregated split-broker holdings where INDmoney combined quantities under another broker's label
  // 2b: Renamed securities (e.g., Swiggy Limited <-> Bundl Technologies, Nykaa <-> FSN E-Commerce) via exact (LTP, Qty) or weak-lexical + LTP
  const unclaimedCsv = overrides.filter(
    (ov) => ov.source === 'csv_import' && ov.averagePrice > 0 && !matchedOverrideKeys.has(ov.holdingKey)
  );

  if (unclaimedCsv.length > 0) {
    const tryPass2ForList = <T extends MatchableHolding>(
      list: T[],
      matchMap: Map<number, CostBasisOverride>,
      skipFn?: (item: T) => boolean
    ) => {
      // 2a: Split-broker aggregated name match (allow broker conflict ONLY when holding.quantity > ov.csvQty)
      list.forEach((item, idx) => {
        if (matchMap.has(idx) || (skipFn && skipFn(item))) return;
        const available = unclaimedCsv.filter((ov) => !matchedOverrideKeys.has(ov.holdingKey));
        const match = findMatchingCostOverride(item, available, { allowBrokerConflict: true });
        if (
          match &&
          canApplyOverride(item.costBasisSource, match) &&
          match.csvQty !== undefined &&
          item.quantity > match.csvQty + 0.01
        ) {
          matchMap.set(idx, match);
          matchedOverrideKeys.add(match.holdingKey);
        }
      });

      // 2b: LTP + weak lexical OR unambiguous exact (LTP, Qty) match
      list.forEach((item, idx) => {
        if (matchMap.has(idx) || (skipFn && skipFn(item))) return;
        if (!canApplyOverride(item.costBasisSource, { ...unclaimedCsv[0], source: 'csv_import' })) return;

        const candidates = unclaimedCsv.filter(
          (ov) => !matchedOverrideKeys.has(ov.holdingKey) && !brokersConflict(ov.broker, item.broker)
        );
        if (candidates.length === 0) return;

        // Weak lexical + near LTP
        let bestWeak: CostBasisOverride | null = null;
        let bestWeakSim = 0;
        for (const ov of candidates) {
          if (!isPriceNear(ov.csvCurrentPrice, item.lastPrice, 0.025, 1.5)) continue;
          const sim = Math.max(
            tokenSimilarity(item.name, ov.displayName),
            subsetTokenSimilarity(item.name, ov.displayName).ratio * 0.9
          );
          if (sim >= 0.35 && sim > bestWeakSim) {
            bestWeakSim = sim;
            bestWeak = ov;
          }
        }
        if (bestWeak) {
          matchMap.set(idx, bestWeak);
          matchedOverrideKeys.add(bestWeak.holdingKey);
          return;
        }

        // Unambiguous exact (LTP within 1.5%, Qty exact) match
        const exactPriceQty = candidates.filter(
          (ov) =>
            ov.csvQty !== undefined &&
            Math.abs(ov.csvQty - item.quantity) < 0.01 &&
            isPriceNear(ov.csvCurrentPrice, item.lastPrice, 0.015, 0.75)
        );
        if (exactPriceQty.length === 1) {
          matchMap.set(idx, exactPriceQty[0]);
          matchedOverrideKeys.add(exactPriceQty[0].holdingKey);
        }
      });
    };

    tryPass2ForList(snapshot.equities, equityMatches, (e) => e.isNonEquity);
    tryPass2ForList(currentBonds, bondMatches);
  }

  let matchedCount = 0;
  let equityInvestedDelta = 0;
  let bondInvestedDelta = 0;

  const nextEquities = snapshot.equities.map((e, idx) => {
    const match = equityMatches.get(idx);
    if (!match) return e;

    matchedCount += 1;
    const newInvested = round2(e.quantity * match.averagePrice);
    const newPnl = round2(e.currentValue - newInvested);
    const newPnlPct = newInvested > 0 ? round2((newPnl / newInvested) * 100) : 0;
    equityInvestedDelta += newInvested - e.investedValue;

    return {
      ...e,
      averagePrice: round2(match.averagePrice),
      investedValue: newInvested,
      pnl: newPnl,
      pnlPct: newPnlPct,
      costBasisSource: match.source === 'csv_import' ? ('csv_import' as const) : ('manual_override' as const),
      partialCostBasisNote: buildPartialCostBasisNote(e.quantity, match)
    };
  });

  const nextBonds = currentBonds.map((b, idx) => {
    const match = bondMatches.get(idx);
    if (!match) return b;

    matchedCount += 1;
    const newInvested = round2(b.quantity * match.averagePrice);
    const newPnl = round2(b.currentValue - newInvested);
    const newPnlPct = newInvested > 0 ? round2((newPnl / newInvested) * 100) : 0;
    bondInvestedDelta += newInvested - b.investedValue;

    return {
      ...b,
      averagePrice: round2(match.averagePrice),
      investedValue: newInvested,
      pnl: newPnl,
      pnlPct: newPnlPct,
      costBasisSource: match.source === 'csv_import' ? ('csv_import' as const) : ('manual_override' as const)
    };
  });

  const matchedKeysArr = Array.from(matchedOverrideKeys);
  const unmatchedOverrideNames = overrides
    .filter((ov) => ov.source === 'csv_import' && !matchedOverrideKeys.has(ov.holdingKey))
    .map((ov) => ov.displayName);

  if (matchedCount === 0) {
    return { snapshot, matchedCount: 0, matchedOverrideKeys: matchedKeysArr, unmatchedOverrideNames };
  }

  const totalInvestedDelta = equityInvestedDelta + bondInvestedDelta;
  const nextTotalInvestedAdjusted = round2(Math.max(0, snapshot.totalInvestedAdjusted + totalInvestedDelta));
  const nextTotalGain = round2(snapshot.totalNetworth - nextTotalInvestedAdjusted);
  const nextTotalGainPct =
    nextTotalInvestedAdjusted > 0 ? round2((nextTotalGain / nextTotalInvestedAdjusted) * 100) : 0;

  const hasBondAlloc = snapshot.allocations.some((a) => a.assetType === 'BOND');
  const nextAllocations = snapshot.allocations.map((a) => {
    let delta = 0;
    if (a.assetType === 'STOCK') {
      delta = equityInvestedDelta + (hasBondAlloc ? 0 : bondInvestedDelta);
    } else if (a.assetType === 'BOND') {
      delta = bondInvestedDelta;
    } else {
      return a;
    }
    if (Math.abs(delta) < 0.005) return a;
    const nextInv = round2(Math.max(0, a.investedValue + delta));
    const nextRet = round2(a.currentValue - nextInv);
    const nextPct = nextInv > 0 ? round2((nextRet / nextInv) * 100) : 0;
    return {
      ...a,
      investedValue: nextInv,
      returnValue: nextRet,
      returnPct: nextPct
    };
  });

  return {
    matchedCount,
    matchedOverrideKeys: matchedKeysArr,
    unmatchedOverrideNames,
    snapshot: {
      ...snapshot,
      totalInvestedAdjusted: nextTotalInvestedAdjusted,
      totalUnrealizedGain: nextTotalGain,
      totalUnrealizedGainPct: nextTotalGainPct,
      allocations: nextAllocations,
      equities: nextEquities,
      bonds: nextBonds
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
