import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PROFILE } from '@shared/constants';
import { buildNotificationSummary, runPortfolioAudit } from '@main/engine/auditor';
import { PortfolioSnapshot } from '@shared/types';

function makeSnapshot(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    id: 2,
    isDemo: false,
    fetchedAt: '2026-11-20T16:00:00.000Z',
    snapshotDate: '2026-11-20',
    upstoxState: 'live',
    totalNetworth: 2000000,
    totalInvestedRaw: 1850000,
    totalInvestedAdjusted: 1800000,
    totalUnrealizedGain: 200000,
    totalUnrealizedGainPct: 11.11,
    totalLiabilities: 0,
    upstoxAvailableMargin: 8200,
    savingsAccountBalance: 25000,
    emergencyCushionTotal: 350000,
    liquidCorpusTotal: 190000,
    weeklySipOutflow: 30000,
    monthlySipOutflow: 20000,
    estimatedMonthlySipTotal: 149900,
    allocations: [],
    equities: [
      {
        id: 'up:ALPHA',
        symbol: 'ALPHA',
        name: 'Alpha Corp',
        isin: 'INE001A01010',
        broker: 'Upstox',
        isExternalBroker: false,
        isNonEquity: false,
        quantity: 100,
        averagePrice: 1000,
        lastPrice: 800,
        investedValue: 100000,
        currentValue: 80000,
        pnl: -20000,
        pnlPct: -20,
        dayChangePct: -1.5,
        marketCap: 'large',
        costBasisSource: 'upstox_live',
        matchStatus: 'matched'
      },
      {
        id: 'up:BETA',
        symbol: 'BETA',
        name: 'Beta Corp',
        isin: 'INE002A01010',
        broker: 'Upstox',
        isExternalBroker: false,
        isNonEquity: false,
        quantity: 200,
        averagePrice: 1000,
        lastPrice: 1200,
        investedValue: 200000,
        currentValue: 240000,
        pnl: 40000,
        pnlPct: 20,
        dayChangePct: 1.2,
        marketCap: 'large',
        costBasisSource: 'upstox_live',
        matchStatus: 'matched'
      }
    ],
    mutualFunds: [],
    activeSips: [
      {
        fundName: 'Fund A',
        broker: 'INDmoney',
        instrumentType: 'MF',
        isin: 'INF1',
        category: 'Flexi Cap',
        planType: 'direct',
        amount: 15000,
        frequency: 'WEEKLY',
        startDate: '05-05-2026',
        sipType: 'flexi_sip',
        folioId: '1',
        investedValue: 150000,
        currentValue: 165000,
        gainPct: 10
      }
    ],
    reconciliation: {
      matchedCount: 2,
      externalCount: 0,
      nonEquityCount: 0,
      discrepancies: [],
      unmatchedIndmoney: [],
      unmatchedUpstox: [],
      indmoneyStockTotal: 320000,
      upstoxEquityTotal: 320000,
      externalStockTotal: 0,
      aggregateDiff: 0
    },
    ...overrides
  };
}

describe('runPortfolioAudit', () => {
  it('flags idle margin, SA shortfall vs SIP, missing SIP baseline, emergency gap, drawdown, concentration, and STP deployment', () => {
    const prev = makeSnapshot({
      id: 1,
      snapshotDate: '2026-11-19',
      totalNetworth: 1960000,
      liquidCorpusTotal: 200000
    });
    const curr = makeSnapshot();

    const alerts = runPortfolioAudit({
      current: curr,
      previous: prev,
      profile: {
        ...DEFAULT_USER_PROFILE,
        emergencyTarget: 500000,
        idleMarginThreshold: 5000,
        drawdownThresholdPct: -15,
        concentrationThresholdPct: 50
      },
      sipBaselines: [
        { fundName: 'Fund A', expectedAmount: 15000, expectedFrequency: 'WEEKLY', active: true },
        { fundName: 'Fund B Missing', expectedAmount: 10000, expectedFrequency: 'MONTHLY', active: true }
      ]
    });

    const categories = new Set(alerts.map((a) => a.category));
    expect(categories.has('performance')).toBe(true);
    expect(categories.has('margin')).toBe(true);
    expect(categories.has('cashflow')).toBe(true);
    expect(categories.has('sip')).toBe(true);
    expect(categories.has('emergency')).toBe(true);
    expect(categories.has('drawdown')).toBe(true);
    expect(categories.has('concentration')).toBe(true);

    expect(alerts.some((a) => a.title.includes('Missing SIP mandate: Fund B Missing'))).toBe(true);
    expect(alerts.some((a) => a.title.includes('Low Savings Account balance'))).toBe(true);
    expect(alerts.some((a) => a.title.includes('Liquid STP transfer detected'))).toBe(true);
  });

  it('flags Upstox re-auth required in alerts and notification title', () => {
    const curr = makeSnapshot({ upstoxState: 'stale_reauth_required' });
    const alerts = runPortfolioAudit({
      current: curr,
      previous: null,
      profile: { ...DEFAULT_USER_PROFILE },
      sipBaselines: []
    });

    expect(alerts.some((a) => a.category === 'auth' && a.severity === 'action')).toBe(true);
    const notif = buildNotificationSummary(curr, alerts, null);
    expect(notif.title).toContain('Upstox Re-link Needed');
  });
});
