import { CostBasisOverride } from '@shared/types';
import { normalizeCompact } from './reconciler';

/**
 * Splits a single CSV line handling double-quoted fields and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeHeader(h: string): string {
  return h
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseNumberCell(raw: string | undefined): number {
  if (!raw) return NaN;
  const cleaned = raw.replace(/[₹,\s]/g, '').replace(/INR/gi, '').trim();
  if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return NaN;
  return Number(cleaned);
}

interface DetectedColumns {
  headerIndex: number;
  nameIdx: number;
  symbolIdx: number;
  isinIdx: number;
  avgPriceIdx: number;
  currentPriceIdx: number;
  investedIdx: number;
  qtyIdx: number;
  brokerIdx: number;
}

const NAME_HEADERS = [
  'stock name',
  'security name',
  'company name',
  'scrip name',
  'instrument name',
  'holding name',
  'investment',
  'scheme name',
  'name',
  'particulars'
];

const SYMBOL_HEADERS = [
  'symbol',
  'trading symbol',
  'tradingsymbol',
  'instrument',
  'ticker',
  'nse symbol',
  'bse symbol',
  'scrip',
  'scrip code'
];

const ISIN_HEADERS = ['isin', 'isin code', 'isin no', 'isin number'];

const AVG_PRICE_HEADERS = [
  'avg cost',
  'avg price',
  'average price',
  'average cost',
  'avg buy price',
  'average buy price',
  'buy avg',
  'buy average',
  'buy price',
  'avg purchase price',
  'purchase price',
  'cost price',
  'cost per unit',
  'unit cost',
  'avg'
];

const CURRENT_PRICE_HEADERS = [
  'current price',
  'ltp',
  'last price',
  'market price',
  'cmp',
  'close price',
  'closing price',
  'prev close'
];

const INVESTED_HEADERS = [
  'invested',
  'invested amount',
  'invested value',
  'buy value',
  'total cost',
  'cost value',
  'purchase value',
  'investment amount'
];

const QTY_HEADERS = ['qty', 'quantity', 'units', 'total units', 'shares', 'net qty', 'available qty', 'quantity available'];
const BROKER_HEADERS = ['broker', 'platform', 'source'];

export function inferBrokerFromFilename(fileName?: string): string | undefined {
  if (!fileName) return undefined;
  const lower = fileName.toLowerCase();
  if (lower.includes('paytm')) return 'Paytm Money';
  if (lower.includes('zerodha') || lower.includes('kite')) return 'Zerodha';
  if (lower.includes('groww')) return 'Groww';
  if (lower.includes('upstox') || lower.includes('rksv')) return 'Upstox';
  if (lower.includes('angel')) return 'Angel One';
  if (lower.includes('icici')) return 'ICICI Direct';
  if (lower.includes('hdfc')) return 'HDFC Securities';
  if (lower.includes('kotak')) return 'Kotak Securities';
  if (lower.includes('pinnacle')) return 'Pinnacle';
  if (lower.includes('dhan')) return 'Dhan';
  if (lower.includes('indmoney')) return 'INDmoney';
  return undefined;
}

function findCol(headers: string[], candidates: string[]): number {
  // Exact normalized header match first
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => h === cand);
    if (idx !== -1) return idx;
  }
  // Substring fallback (e.g. "Avg. Cost (INR)" -> "avg cost inr")
  for (const cand of candidates) {
    const idx = headers.findIndex((h) => h.includes(cand));
    if (idx !== -1) return idx;
  }
  return -1;
}

function detectHeaderRow(lines: string[]): DetectedColumns | null {
  const maxScan = Math.min(lines.length, 30);
  for (let i = 0; i < maxScan; i += 1) {
    const cols = parseCsvLine(lines[i]).map(normalizeHeader);
    if (cols.length < 2) continue;

    const nameIdx = findCol(cols, NAME_HEADERS);
    const symbolIdx = findCol(cols, SYMBOL_HEADERS);
    const isinIdx = findCol(cols, ISIN_HEADERS);
    const avgPriceIdx = findCol(cols, AVG_PRICE_HEADERS);
    const currentPriceIdx = findCol(cols, CURRENT_PRICE_HEADERS);
    const investedIdx = findCol(cols, INVESTED_HEADERS);
    const qtyIdx = findCol(cols, QTY_HEADERS);
    const brokerIdx = findCol(cols, BROKER_HEADERS);

    const hasIdentifier = nameIdx !== -1 || symbolIdx !== -1 || isinIdx !== -1;
    const hasCostSource = avgPriceIdx !== -1 || (investedIdx !== -1 && qtyIdx !== -1);

    if (hasIdentifier && hasCostSource) {
      return {
        headerIndex: i,
        nameIdx,
        symbolIdx,
        isinIdx,
        avgPriceIdx,
        currentPriceIdx,
        investedIdx,
        qtyIdx,
        brokerIdx
      };
    }
  }
  return null;
}

/**
 * Parses holdings CSV files from Paytm Money, Zerodha Console/Kite, Groww, Upstox, Angel One,
 * ICICI Direct, or any custom CSV containing Stock/Symbol/ISIN + Avg Buy Price (or Invested + Qty).
 */
export function parseBrokerHoldingsCsv(csvText: string, defaultBroker?: string): CostBasisOverride[] {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0);

  const detected = detectHeaderRow(lines);
  if (!detected) {
    throw new Error(
      'Could not detect holdings columns in CSV. Expected a Stock/Symbol/ISIN column and an Avg Price (or Invested + Qty) column.'
    );
  }

  const now = new Date().toISOString();
  const deduped = new Map<string, CostBasisOverride>();

  for (let i = detected.headerIndex + 1; i < lines.length; i += 1) {
    const row = parseCsvLine(lines[i]);
    if (row.length < 2) continue;

    const rawName = detected.nameIdx !== -1 ? row[detected.nameIdx] || '' : '';
    const rawSymbol = detected.symbolIdx !== -1 ? row[detected.symbolIdx] || '' : '';
    const rawIsin = detected.isinIdx !== -1 ? (row[detected.isinIdx] || '').toUpperCase().trim() : '';
    const rawBroker = detected.brokerIdx !== -1 ? row[detected.brokerIdx] || '' : '';

    // Skip footer/total summary rows
    const idCheck = (rawName || rawSymbol).toLowerCase().trim();
    if (!idCheck && !rawIsin) continue;
    if (/^(total|grand total|summary|disclaimer|generated on)\b/i.test(idCheck)) continue;

    const parsedQty = detected.qtyIdx !== -1 ? parseNumberCell(row[detected.qtyIdx]) : NaN;
    const parsedCurrentPrice =
      detected.currentPriceIdx !== -1 ? parseNumberCell(row[detected.currentPriceIdx]) : NaN;

    let avgPrice = detected.avgPriceIdx !== -1 ? parseNumberCell(row[detected.avgPriceIdx]) : NaN;
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) {
      const inv = detected.investedIdx !== -1 ? parseNumberCell(row[detected.investedIdx]) : NaN;
      if (Number.isFinite(inv) && Number.isFinite(parsedQty) && inv > 0 && parsedQty > 0) {
        avgPrice = inv / parsedQty;
      }
    }

    if (!Number.isFinite(avgPrice) || avgPrice <= 0) continue;

    const cleanIsin = /^[A-Z]{2}[A-Z0-9]{10}$/.test(rawIsin) ? rawIsin : undefined;
    const cleanSymbol = rawSymbol.trim().toUpperCase() || undefined;
    const displayName = (rawName || rawSymbol || cleanIsin || '').trim();
    const effectiveBroker = rawBroker.trim() || defaultBroker || undefined;
    // Use raw alphanumeric slug for CSV deduplication so distinct names (e.g., "Oil India" vs "Indian Oil Corp") never collide
    const rawNameSlug = displayName.toLowerCase().replace(/[^a-z0-9]/g, '') || normalizeCompact(displayName);
    const baseKey =
      (cleanIsin && `isin:${cleanIsin.toLowerCase()}`) ||
      (cleanSymbol && `sym:${cleanSymbol.toLowerCase()}`) ||
      `name:${rawNameSlug}`;
    const brokerSlug = effectiveBroker ? effectiveBroker.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const holdingKey = brokerSlug ? `${baseKey}@${brokerSlug}` : baseKey;

    deduped.set(holdingKey, {
      holdingKey,
      displayName,
      symbol: cleanSymbol,
      isin: cleanIsin,
      broker: effectiveBroker,
      averagePrice: Math.round((avgPrice + Number.EPSILON) * 100) / 100,
      csvQty: Number.isFinite(parsedQty) && parsedQty > 0 ? Math.round((parsedQty + Number.EPSILON) * 10000) / 10000 : undefined,
      csvCurrentPrice:
        Number.isFinite(parsedCurrentPrice) && parsedCurrentPrice > 0
          ? Math.round((parsedCurrentPrice + Number.EPSILON) * 100) / 100
          : undefined,
      source: 'csv_import',
      updatedAt: now
    });
  }

  return Array.from(deduped.values());
}
