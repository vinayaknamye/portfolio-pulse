export function formatInrCompact(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function formatInrFull(val: number, decimals = 0): string {
  const sign = val < 0 ? '−' : '';
  return `${sign}₹${Math.abs(val).toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}`;
}

export function formatSignedPct(val: number, decimals = 2): string {
  const sign = val > 0 ? '+' : val < 0 ? '−' : '';
  return `${sign}${Math.abs(val).toFixed(decimals)}%`;
}

export function formatSignedInrCompact(val: number): string {
  const prefix = val > 0 ? '+' : '';
  return `${prefix}${formatInrCompact(val)}`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export const ASSET_COLORS: Record<string, string> = {
  RE: '#6366f1',
  MF: '#10b981',
  STOCK: '#3b82f6',
  GOLD: '#f59e0b',
  PPF: '#8b5cf6',
  EPF: '#a855f7',
  GLOBAL_FUNDS: '#06b6d4',
  US_STOCK: '#0ea5e9',
  BOND: '#ec4899',
  SA: '#64748b',
  FD: '#14b8a6'
};

export function getAssetColor(assetType: string, idx = 0): string {
  const fallback = ['#10b981', '#3b82f6', '#6366f1', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#64748b'];
  return ASSET_COLORS[assetType] || fallback[idx % fallback.length];
}
