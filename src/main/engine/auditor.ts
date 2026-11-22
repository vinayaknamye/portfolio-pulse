import { AuditAlert, PortfolioSnapshot, ReconciledEquity, SipBaselineItem, UserProfile } from '@shared/types';

export interface AuditInput {
  current: PortfolioSnapshot;
  previous: PortfolioSnapshot | null;
  profile: UserProfile;
  sipBaselines: SipBaselineItem[];
}

function isInternalOrIsinCode(code: string): boolean {
  const c = (code || '').trim();
  if (!c) return true;
  if (/^INDS\d+$/i.test(c)) return true;
  if (/^DEMO_[A-Z0-9]+$/i.test(c)) return true;
  if (/^[A-Z]{2}[A-Z0-9]{10}$/i.test(c)) return true;
  return false;
}

export function formatEquityDisplayName(e: Pick<ReconciledEquity, 'name' | 'symbol'>): string {
  const cleanName = (e.name || '').trim();
  if (cleanName) return cleanName;
  if (e.symbol && !isInternalOrIsinCode(e.symbol)) return e.symbol;
  return e.symbol || 'Unknown Holding';
}

function formatInrCompact(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)}L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export function runPortfolioAudit(input: AuditInput): AuditAlert[] {
  const { current, previous, profile, sipBaselines } = input;
  const now = current.fetchedAt || new Date().toISOString();
  const alerts: AuditAlert[] = [];
  let seq = 0;

  const push = (
    category: AuditAlert['category'],
    severity: AuditAlert['severity'],
    title: string,
    detail: string
  ) => {
    seq += 1;
    alerts.push({
      id: `${current.snapshotDate}-${category}-${seq}`,
      category,
      severity,
      title,
      detail,
      createdAt: now,
      dismissed: false
    });
  };

  // 1. Upstox session expiry notice (partial sync)
  if (current.upstoxState === 'stale_reauth_required') {
    push(
      'auth',
      'action',
      'Upstox session expired — reconnect required',
      'INDmoney synced successfully, and your last known Upstox cost basis was carried forward. Reconnect Upstox to refresh live margin and exact demat holdings.'
    );
  }

  // 2. Day-over-day Net Worth delta
  if (previous && previous.totalNetworth > 0) {
    const delta = current.totalNetworth - previous.totalNetworth;
    const pct = (delta / previous.totalNetworth) * 100;
    const sign = delta >= 0 ? '+' : '';
    push(
      'performance',
      'info',
      `Net Worth ${sign}${formatInrCompact(delta)} (${sign}${pct.toFixed(2)}%) vs prior snapshot`,
      `Moved from ${formatInrCompact(previous.totalNetworth)} (${previous.snapshotDate}) to ${formatInrCompact(current.totalNetworth)} (${current.snapshotDate}).`
    );
  }

  // 3. Idle Upstox margin check
  if (current.upstoxState === 'live' && current.upstoxAvailableMargin > profile.idleMarginThreshold) {
    push(
      'margin',
      'warning',
      `Idle broker cash: ${formatInrCompact(current.upstoxAvailableMargin)} on Upstox`,
      `Available trading balance exceeds your ${formatInrCompact(profile.idleMarginThreshold)} threshold. Consider deploying or withdrawing idle funds.`
    );
  }

  // 4. Multi-broker reconciliation checks
  const rec = current.reconciliation;
  if (rec.discrepancies.length > 0) {
    const summary = rec.discrepancies
      .slice(0, 3)
      .map((d) => `${formatEquityDisplayName({ name: d.name, symbol: d.symbol })} (ΔQty ${d.qtyDiff.toFixed(2)}, ΔVal ${formatInrCompact(d.valueDiff)})`)
      .join('; ');
    push(
      'reconciliation',
      'action',
      `${rec.discrepancies.length} multi-broker stock discrepanc${rec.discrepancies.length === 1 ? 'y' : 'ies'} found`,
      `INDmoney and Upstox differ on: ${summary}. Check for T+1 settlement lag or corporate actions.`
    );
  }

  if (current.upstoxState === 'live' && (rec.unmatchedIndmoney.length > 0 || rec.unmatchedUpstox.length > 0)) {
    push(
      'reconciliation',
      'warning',
      `Unmatched holdings: ${rec.unmatchedIndmoney.length} INDmoney, ${rec.unmatchedUpstox.length} Upstox`,
      'Open Holdings → Reconciliation to link symbol aliases in one click if these represent the same security.'
    );
  }

  // 5. SIP Baseline Mandate Drift Check
  const activeMap = new Map<string, { amount: number; frequency: string }>();
  for (const s of current.activeSips) {
    activeMap.set(s.fundName.trim().toLowerCase(), { amount: s.amount, frequency: s.frequency });
  }

  const activeBaselines = sipBaselines.filter((b) => b.active);
  for (const base of activeBaselines) {
    const live = activeMap.get(base.fundName.trim().toLowerCase());
    if (!live) {
      push(
        'sip',
        'action',
        `Missing SIP mandate: ${base.fundName}`,
        `Expected ${base.expectedFrequency} SIP of ${formatInrCompact(base.expectedAmount)} is missing or paused across your linked brokers.`
      );
    } else if (Math.abs(live.amount - base.expectedAmount) > 1) {
      push(
        'sip',
        'warning',
        `SIP amount changed: ${base.fundName}`,
        `Baseline expects ${formatInrCompact(base.expectedAmount)} (${base.expectedFrequency}), but active mandate is ${formatInrCompact(live.amount)} (${live.frequency}).`
      );
    }
  }

  // 6. Savings Account cash runway vs upcoming SIP debits
  const nextImmediateSip = Math.max(current.weeklySipOutflow, current.monthlySipOutflow);
  if (nextImmediateSip > 0 && current.savingsAccountBalance > 0) {
    if (current.savingsAccountBalance < nextImmediateSip) {
      push(
        'cashflow',
        'action',
        `Low Savings Account balance (${formatInrCompact(current.savingsAccountBalance)}) vs upcoming SIP`,
        `Your next scheduled SIP cycle requires up to ${formatInrCompact(nextImmediateSip)} (weekly ₹${Math.round(current.weeklySipOutflow).toLocaleString('en-IN')} / monthly ₹${Math.round(current.monthlySipOutflow).toLocaleString('en-IN')}). Top up your bank account to avoid SIP bounce charges.`
      );
    } else if (current.savingsAccountBalance < nextImmediateSip * 1.6) {
      const remaining = current.savingsAccountBalance - nextImmediateSip;
      push(
        'cashflow',
        'warning',
        `Tight Savings Account buffer before next SIP debit`,
        `SA balance is ${formatInrCompact(current.savingsAccountBalance)}; after a ${formatInrCompact(nextImmediateSip)} SIP debit, only ~${formatInrCompact(remaining)} will remain.`
      );
    }
  }

  // 7. Emergency Cushion Check
  if (profile.emergencyTarget > 0 && current.emergencyCushionTotal < profile.emergencyTarget) {
    const gap = profile.emergencyTarget - current.emergencyCushionTotal;
    const parts: string[] = [];
    if (current.savingsAccountBalance > 0) parts.push(`SA ${formatInrCompact(current.savingsAccountBalance)}`);
    if ((current.emergencyFdTotal ?? 0) > 0) parts.push(`FDs ${formatInrCompact(current.emergencyFdTotal ?? 0)}`);
    const arbTotal =
      current.arbitrageTotal ??
      current.mutualFunds.filter((m) => m.isArbitrage).reduce((s, m) => s + m.currentValue, 0);
    if (arbTotal > 0) parts.push(`Arbitrage ${formatInrCompact(arbTotal)}`);
    const breakdown = parts.length > 0 ? ` (${parts.join(' + ')})` : '';
    push(
      'emergency',
      'warning',
      `Emergency cushion below target by ${formatInrCompact(gap)}`,
      `Current Emergency Cushion${breakdown} is ${formatInrCompact(current.emergencyCushionTotal)} vs your ${formatInrCompact(profile.emergencyTarget)} goal (Savings Account + Callable FDs + Arbitrage MFs).`
    );
  }

  // 8. Equity Deep-Red Drawdown Watchlist
  const deepRed = current.equities.filter(
    (e) =>
      !e.isNonEquity &&
      e.costBasisSource !== 'market_value_proxy' &&
      e.pnlPct <= profile.drawdownThresholdPct
  );
  if (deepRed.length > 0) {
    const names = deepRed
      .slice(0, 5)
      .map((e) => `${formatEquityDisplayName(e)} (${e.pnlPct.toFixed(1)}%)`)
      .join(', ');
    push(
      'drawdown',
      'warning',
      `${deepRed.length} equity holding${deepRed.length === 1 ? '' : 's'} past ${profile.drawdownThresholdPct}% drawdown`,
      `Review thesis or tax-loss harvesting opportunities for: ${names}.`
    );
  }

  // 9. Single-Stock Concentration Check
  const totalEquityVal = current.equities
    .filter((e) => !e.isNonEquity)
    .reduce((sum, e) => sum + e.currentValue, 0);

  if (totalEquityVal > 0 && profile.concentrationThresholdPct > 0) {
    const concentrated = current.equities.filter(
      (e) => !e.isNonEquity && (e.currentValue / totalEquityVal) * 100 >= profile.concentrationThresholdPct
    );
    if (concentrated.length > 0) {
      const list = concentrated
        .map((e) => `${formatEquityDisplayName(e)} (${((e.currentValue / totalEquityVal) * 100).toFixed(1)}%)`)
        .join(', ');
      push(
        'concentration',
        'info',
        `High single-stock concentration (>= ${profile.concentrationThresholdPct}% of equity)`,
        `Top heavy positions in direct stocks: ${list}.`
      );
    }
  }

  // 10. Liquid MF STP Balance Observation (when previous snapshot exists)
  if (previous && current.liquidCorpusTotal > 0 && previous.liquidCorpusTotal > current.liquidCorpusTotal) {
    const deployed = previous.liquidCorpusTotal - current.liquidCorpusTotal;
    if (deployed >= 1000) {
      push(
        'sip',
        'info',
        `Liquid STP transfer detected: ${formatInrCompact(deployed)} deployed`,
        `Total liquid fund corpus moved from ${formatInrCompact(previous.liquidCorpusTotal)} to ${formatInrCompact(current.liquidCorpusTotal)}.`
      );
    }
  }

  return alerts;
}

export function buildNotificationSummary(snapshot: PortfolioSnapshot, alerts: AuditAlert[], previous: PortfolioSnapshot | null): {
  title: string;
  body: string;
} {
  const nwStr = formatInrCompact(snapshot.totalNetworth);
  let deltaPart = '';
  if (previous && previous.totalNetworth > 0) {
    const diff = snapshot.totalNetworth - previous.totalNetworth;
    const pct = (diff / previous.totalNetworth) * 100;
    const sign = diff >= 0 ? '+' : '';
    deltaPart = ` (${sign}${formatInrCompact(diff)}, ${sign}${pct.toFixed(2)}%)`;
  }

  const actionable = alerts.filter((a) => a.severity === 'action' || a.severity === 'warning');
  const title = snapshot.upstoxState === 'stale_reauth_required'
    ? `Portfolio Pulse · ${nwStr}${deltaPart} (Upstox Re-link Needed)`
    : `Portfolio Pulse · ${nwStr}${deltaPart}`;

  if (actionable.length === 0) {
    return {
      title,
      body: `All checks green · ${snapshot.activeSips.length} active SIPs · ${snapshot.equities.length} direct holdings synced.`
    };
  }

  const topHeadline = actionable[0].title;
  const extra = actionable.length > 1 ? ` (+${actionable.length - 1} more)` : '';
  return {
    title,
    body: `${actionable.length} alert${actionable.length === 1 ? '' : 's'}: ${topHeadline}${extra}`
  };
}
