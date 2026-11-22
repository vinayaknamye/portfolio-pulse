import { describe, expect, it } from 'vitest';
import { DEFAULT_USER_PROFILE } from '@shared/constants';
import {
  applyCostOverridesToSnapshot,
  isUpstoxNonEquityInstrument,
  reconcilePortfolio
} from '@main/engine/reconciler';
import { IndmoneyFetchPayload, UpstoxFetchPayload } from '@shared/types';

function makeBaseIndmoney(): IndmoneyFetchPayload {
  return {
    networth: {
      total_invested: 1500000,
      total_current_value: 1650000,
      total_networth: 1650000,
      investments: [
        { asset_type: 'STOCK', invested_value: 650000, current_value: 650000, progress_value_percentage: 39.39 },
        { asset_type: 'MF', invested_value: 800000, current_value: 950000, return: 150000, return_percentage: 18.75, progress_value_percentage: 57.58 },
        { asset_type: 'SA', invested_value: 50000, current_value: 50000, return: 0, return_percentage: 0, progress_value_percentage: 3.03 }
      ],
      liabilities: { total: 0 }
    },
    stocks: [
      {
        investment: 'HDFC Bank Ltd',
        investment_code: 'S1',
        broker: 'Upstox',
        total_units: 100,
        unit_price: 1700,
        market_value: 170000
      },
      {
        investment: 'Jio Platforms Ltd',
        investment_code: 'S2',
        broker: 'Upstox',
        total_units: 10,
        unit_price: 1400,
        market_value: 14000
      },
      {
        investment: 'Billionbrains Garage Ventures Ltd',
        investment_code: 'S3',
        broker: 'Upstox',
        total_units: 150,
        unit_price: 220,
        market_value: 33000
      },
      {
        investment: 'Motilal Oswal Nasdaq 100 ETF',
        investment_code: 'S4',
        broker: 'Paytm Money',
        total_units: 2000,
        unit_price: 216.5,
        market_value: 433000
      }
    ],
    mutualFunds: [
      {
        investment: 'Kotak Equity Arbitrage Fund',
        investment_code: 'MF1',
        total_units: 10000,
        unit_price: 40,
        invested_amount: 380000,
        market_value: 400000,
        total_pnl: 20000,
        pnl_per: 5.26,
        assetclass_l2: 'others'
      },
      {
        investment: 'HDFC Liquid Fund',
        investment_code: 'MF2',
        total_units: 50,
        unit_price: 5000,
        invested_amount: 240000,
        market_value: 250000,
        total_pnl: 10000,
        pnl_per: 4.17,
        assetclass_l2: 'liquid'
      }
    ],
    mfSips: [
      {
        name: 'Parag Parikh Flexi Cap',
        category: 'Flexi Cap',
        investedAmountVal: 180000,
        currentValueVal: 300000,
        gainPercentageVal: 66.6,
        active_sips: [{ sip_frequency: 'WEEKLY', amount: 10000, sip_start_date: '05-05-2026' }]
      }
    ],
    stockSips: []
  };
}

function makeBaseUpstox(): UpstoxFetchPayload {
  return {
    holdings: [
      {
        tradingsymbol: 'HDFCBANK',
        company_name: 'HDFC BANK LIMITED',
        isin: 'INE040A01034',
        quantity: 100,
        average_price: 1400,
        last_price: 1700,
        pnl: 30000,
        day_change_percentage: 1.2
      },
      {
        tradingsymbol: 'JPL',
        company_name: 'JIO PLATFORMS LIMITED',
        isin: 'INE0BJO01010',
        quantity: 10,
        average_price: 1350,
        last_price: 1400,
        pnl: 500,
        day_change_percentage: 0.4
      },
      {
        tradingsymbol: 'GROWW',
        company_name: 'BILLIONBRAINS GARAGE VN L',
        isin: 'INE0HOQ01053',
        quantity: 150,
        average_price: 180,
        last_price: 220,
        pnl: 6000,
        day_change_percentage: 2.1
      },
      {
        tradingsymbol: '1075SCL34',
        company_name: 'SEC RE NCD 10.75% SR XI',
        isin: 'INE148I07TP7',
        quantity: 10,
        average_price: 1000,
        last_price: 1055,
        pnl: 550,
        day_change_percentage: 0
      }
    ],
    funds: { availableMargin: 1200, usedMargin: 0, payinAmount: 1200 },
    positions: [],
    orders: []
  };
}

describe('reconcilePortfolio', () => {
  it('identifies corporate NCDs and G-Secs via ISIN and symbol rules', () => {
    expect(isUpstoxNonEquityInstrument({ tradingsymbol: '1075SCL34', isin: 'INE148I07TP7' })).toBe(true);
    expect(isUpstoxNonEquityInstrument({ tradingsymbol: 'SGBNOV28', isin: 'IN0020200153' })).toBe(true);
    expect(isUpstoxNonEquityInstrument({ tradingsymbol: 'HDFCBANK', isin: 'INE040A01034' })).toBe(false);
  });

  it('reconciles live Upstox + INDmoney equities dynamically, separates NCD bonds, and adjusts true cost basis', () => {
    const snap = reconcilePortfolio({
      indmoney: makeBaseIndmoney(),
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false,
      fetchedAt: '2026-11-20T16:00:00.000Z'
    });

    expect(snap.reconciliation.matchedCount).toBe(3);
    expect(snap.reconciliation.externalCount).toBe(1);
    expect(snap.reconciliation.nonEquityCount).toBe(1);
    expect(snap.reconciliation.unmatchedIndmoney).toHaveLength(0);
    expect(snap.reconciliation.unmatchedUpstox).toHaveLength(0);
    expect(snap.reconciliation.aggregateDiff).toBe(0);

    // Upstox equity invested = 140,000 + 13,500 + 27,000 = 180,500; external proxy = 433,000 -> total stock cost = 613,500
    // Adjusted total invested = 1,500,000 - 650,000 + 613,500 = 1,463,500
    expect(snap.totalInvestedAdjusted).toBe(1463500);
    expect(snap.emergencyCushionTotal).toBe(450000); // 400k Arbitrage + 50k SA
    expect(snap.liquidCorpusTotal).toBe(250000);
  });

  it('applies user-defined symbol aliases for non-obvious name changes', () => {
    const ind = makeBaseIndmoney();
    ind.stocks[2] = {
      investment: 'Completely Renamed Holding Corp',
      investment_code: 'S3',
      broker: 'Upstox',
      total_units: 150,
      unit_price: 225, // slightly different price so exact fallback would not trigger
      market_value: 33750
    };

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [{ indmoneyName: 'Completely Renamed Holding Corp', upstoxSymbol: 'GROWW' }],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.reconciliation.matchedCount).toBe(3);
    expect(snap.reconciliation.unmatchedIndmoney).toHaveLength(0);
    // Discrepancy flagged because INDmoney value (33,750) vs Upstox value (33,000) differs by ₹750 > ₹500
    expect(snap.reconciliation.discrepancies).toHaveLength(1);
    expect(snap.reconciliation.discrepancies[0].symbol).toBe('GROWW');
  });

  it('carries forward last known Upstox cost basis during stale partial sync', () => {
    const snap = reconcilePortfolio({
      indmoney: makeBaseIndmoney(),
      upstox: null,
      upstoxState: 'stale_reauth_required',
      previousCostBasis: [
        { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', isin: 'INE040A01034', averagePrice: 1400 },
        { symbol: 'JPL', name: 'Jio Platforms Ltd', isin: 'INE0BJO01010', averagePrice: 1350 }
      ],
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    const hdfc = snap.equities.find((e) => e.symbol === 'HDFCBANK');
    expect(hdfc).toBeDefined();
    expect(hdfc?.costBasisSource).toBe('upstox_carried_forward');
    expect(hdfc?.investedValue).toBe(140000);
    expect(hdfc?.pnl).toBe(30000);
  });

  it('merges active SIPs and MF holdings across INDmoney and Upstox, filters CANCELLED SIPs, and deduplicates overlap', () => {
    const ind = makeBaseIndmoney();
    ind.mfSips[0].isin = 'INF879O01027';
    ind.stockSips = [
      {
        name: 'Nippon India ETF Gold BeES',
        symbol: 'GOLDBEES',
        isin: 'INF204KB17I5',
        status: 'ACTIVE',
        amount: 5000,
        frequency: 'MONTHLY',
        start_date: '2026-06-01'
      }
    ];

    const up = makeBaseUpstox();
    up.mfHoldings = [
      {
        fund: 'Kotak Equity Arbitrage Fund', // overlaps INDmoney -> should NOT duplicate
        isin: 'INF174K01LS2',
        units: 10000,
        nav: 40,
        invested_value: 380000,
        current_value: 400000
      },
      {
        fund: 'HDFC Mid-Cap Opportunities Direct Growth', // Upstox-only -> should merge!
        isin: 'INF179K01XQ0',
        units: 500,
        nav: 180,
        invested_value: 75000,
        current_value: 90000
      }
    ];
    up.mfSips = [
      {
        fund: 'Parag Parikh Flexi Cap', // Duplicate of INDmoney weekly ₹10k SIP -> should deduplicate
        status: 'ACTIVE',
        frequency: 'WEEKLY',
        instrument_key: 'INF879O01027',
        instalment_amount: 10000
      },
      {
        fund: 'HDFC Mid-Cap Opportunities Direct Growth', // Active Upstox-only SIP -> should include!
        status: 'ACTIVE',
        frequency: 'MONTHLY',
        instrument_key: 'INF179K01XQ0',
        instalment_amount: 12000,
        next_instalment: '2026-12-05'
      },
      {
        fund: 'Old Cancelled ELSS Fund', // CANCELLED -> must be excluded
        status: 'CANCELLED',
        frequency: 'MONTHLY',
        instrument_key: 'INF999K01001',
        instalment_amount: 1000
      }
    ];

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: up,
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    // 2 INDmoney MFs + 1 unique Upstox MF = 3 total (no duplicate Kotak Arbitrage)
    expect(snap.mutualFunds).toHaveLength(3);
    expect(snap.mutualFunds.some((m) => m.broker === 'Upstox' && m.name.includes('Mid-Cap'))).toBe(true);

    // 1 INDmoney MF SIP + 1 INDmoney Stock SIP + 1 unique Upstox ACTIVE MF SIP = 3 total (duplicate Parag Parikh + CANCELLED ELSS excluded)
    expect(snap.activeSips).toHaveLength(3);
    expect(snap.activeSips.some((s) => s.broker === 'Upstox' && s.amount === 12000)).toBe(true);
    expect(snap.activeSips.some((s) => s.broker === 'INDmoney' && s.instrumentType === 'STOCK' && s.amount === 5000)).toBe(true);
    expect(snap.activeSips.some((s) => s.fundName.includes('Cancelled'))).toBe(false);
    expect(snap.weeklySipOutflow).toBe(10000);
    expect(snap.monthlySipOutflow).toBe(17000); // 12,000 Upstox MF + 5,000 INDmoney Stock SIP
  });

  it('matches acronym/abbreviated NSE holdings generically without manual aliases and preserves native INDmoney cost basis', () => {
    const ind: IndmoneyFetchPayload = {
      networth: {
        total_invested: 900000,
        total_current_value: 950000,
        total_networth: 950000,
        investments: [{ asset_type: 'STOCK', invested_value: 900000, current_value: 950000 }]
      },
      stocks: [
        { investment: 'Bharat Dynamics Ltd', investment_code: 'I1', broker: 'Upstox', total_units: 100, unit_price: 1030, market_value: 103000 },
        { investment: 'Mahindra & Mahindra Ltd', investment_code: 'I2', broker: 'Upstox', total_units: 50, unit_price: 3500, market_value: 175000 },
        { investment: 'Cholamandalam Investment & Finance Company Ltd', investment_code: 'I3', broker: 'Upstox', total_units: 60, unit_price: 1870, market_value: 112200 },
        { investment: 'Nippon India ETF Gold Bees', investment_code: 'I4', broker: 'Upstox', total_units: 800, unit_price: 102, market_value: 81600 },
        // Stock bought directly on INDmoney demat -> has true cost basis & P&L!
        { investment: 'Infosys Ltd', investment_code: 'I5', broker: 'INDmoney', total_units: 100, unit_price: 1850, market_value: 185000, invested_amount: 150000, total_pnl: 35000, pnl_per: 23.33 }
      ],
      mutualFunds: [],
      mfSips: [],
      stockSips: []
    };

    const up: UpstoxFetchPayload = {
      holdings: [
        { tradingsymbol: 'BDL', company_name: 'BHARAT DYNAMICS LIMITED', isin: 'INE171Z01026', quantity: 100, average_price: 1200, last_price: 1030 },
        { tradingsymbol: 'M&M', company_name: 'MAHINDRA & MAHINDRA LTD', isin: 'INE101A01026', quantity: 50, average_price: 3000, last_price: 3500 },
        { tradingsymbol: 'CHOLAFIN', company_name: 'CHOLAMANDALAM IN & FIN CO', isin: 'INE121A01024', quantity: 60, average_price: 1200, last_price: 1870 },
        { tradingsymbol: 'GOLDBEES', company_name: 'NIP IND ETF GOLD BEES', isin: 'INF204KB17I5', quantity: 800, average_price: 120, last_price: 102 }
      ],
      funds: { availableMargin: 0, usedMargin: 0, payinAmount: 0 },
      positions: [],
      orders: []
    };

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: up,
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.reconciliation.matchedCount).toBe(4);
    expect(snap.reconciliation.unmatchedIndmoney).toHaveLength(0);
    expect(snap.reconciliation.unmatchedUpstox).toHaveLength(0);

    const infy = snap.equities.find((e) => e.name === 'Infosys Ltd');
    expect(infy?.costBasisSource).toBe('indmoney_native');
    expect(infy?.averagePrice).toBe(1500);
    expect(infy?.pnl).toBe(35000);
  });

  it('supports standalone Upstox-only mode without INDmoney connected', () => {
    const up = makeBaseUpstox();
    up.mfHoldings = [
      { fund: 'Parag Parikh Flexi Cap Direct Growth', isin: 'INF879O01027', units: 1000, nav: 85, invested_value: 70000, current_value: 85000 }
    ];
    up.mfSips = [
      { fund: 'Parag Parikh Flexi Cap Direct Growth', status: 'ACTIVE', frequency: 'MONTHLY', instrument_key: 'INF879O01027', instalment_amount: 15000 }
    ];

    const snap = reconcilePortfolio({
      indmoney: null,
      upstox: up,
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.reconciliation.unmatchedUpstox).toHaveLength(0);
    expect(snap.equities.filter((e) => !e.isNonEquity)).toHaveLength(3);
    expect(snap.bonds).toHaveLength(1);
    expect(snap.bonds?.[0].bondType).toBe('NCD');
    expect(snap.mutualFunds).toHaveLength(1);
    expect(snap.activeSips).toHaveLength(1);
    // Equities (170k + 14k + 33k = 217k) + MF (85k) + NCD Bond (10.55k) + Cash Margin (1.2k) = 313,750
    expect(snap.totalNetworth).toBe(313750);
  });

  it('adds non-synced Upstox stocks cleanly when INDmoney has no Upstox broker link', () => {
    const ind = makeBaseIndmoney();
    // Simulate a user who only holds Paytm Money stocks inside INDmoney (Upstox not linked inside INDmoney)
    ind.stocks = [ind.stocks[3]];
    ind.networth.total_networth = 1433000;
    ind.networth.total_current_value = 1433000;
    ind.networth.total_invested = 1283000;
    ind.networth.investments[0] = { asset_type: 'STOCK', invested_value: 433000, current_value: 433000 };

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.reconciliation.unmatchedUpstox).toHaveLength(0);
    expect(snap.equities.filter((e) => e.matchStatus === 'upstox_standalone')).toHaveLength(3);
    // INDmoney 14.33L + Upstox equities 2.17L = 16.50L
    expect(snap.totalNetworth).toBe(1650000);
  });

  it('applies manual and CSV cost-basis overrides to external holdings and recalculates total adjusted P&L', () => {
    const snap = reconcilePortfolio({
      indmoney: makeBaseIndmoney(),
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    // Paytm Money Nasdaq ETF has 2000 units @ ₹216.50 = ₹433,000 (initially proxy invested = ₹433,000, pnl = 0)
    const { snapshot: updated, matchedCount } = applyCostOverridesToSnapshot(snap, [
      {
        holdingKey: 'name:motilaloswalnasdaq100etf',
        displayName: 'Motilal Oswal Nasdaq 100 ETF',
        averagePrice: 150,
        source: 'csv_import',
        updatedAt: '2026-11-20T18:00:00.000Z'
      }
    ]);

    expect(matchedCount).toBe(1);
    const nasdaq = updated.equities.find((e) => e.name.includes('Nasdaq'));
    expect(nasdaq?.averagePrice).toBe(150);
    expect(nasdaq?.investedValue).toBe(300000);
    expect(nasdaq?.pnl).toBe(133000);
    expect(nasdaq?.costBasisSource).toBe('csv_import');
    // Total adjusted invested drops by ₹133,000 (from 1,463,500 to 1,330,500)
    expect(updated.totalInvestedAdjusted).toBe(1330500);
    expect(updated.totalUnrealizedGain).toBe(updated.totalNetworth - 1330500);
  });

  it('matches Paytm Money CSV abbreviations, hyphenated names, acronyms, LTP+Qty renames, SGBs, and handles split-broker holdings', () => {
    const ind: IndmoneyFetchPayload = {
      networth: {
        total_invested: 450000,
        total_current_value: 450000,
        total_networth: 450000,
        investments: [{ asset_type: 'STOCK', invested_value: 450000, current_value: 450000 }]
      },
      stocks: [
        { investment: 'Cholamandalam Investment & Finance Company Ltd', investment_code: 'INDS1', broker: 'Paytm Money', total_units: 60, unit_price: 1870, market_value: 112200 },
        { investment: 'Godawari Power & Ispat Ltd', investment_code: 'INDS2', broker: 'Paytm Money', total_units: 50, unit_price: 210, market_value: 10500 },
        { investment: 'Larsen & Toubro Ltd', investment_code: 'INDS3', broker: 'Paytm Money', total_units: 10, unit_price: 3600, market_value: 36000 },
        { investment: 'PCBL Ltd', investment_code: 'INDS4', broker: 'Paytm Money', total_units: 40, unit_price: 420, market_value: 16800 },
        { investment: 'Bundl Technologies Ltd', investment_code: 'INDS5', broker: 'Paytm Money', total_units: 20, unit_price: 178.2, market_value: 3564 },
        // Split-broker ITC Hotels: separate rows in Paytm Money (16) and Pinnacle (4)
        { investment: 'ITC Hotels Ltd', investment_code: 'INDS6', broker: 'Paytm Money', total_units: 16, unit_price: 190, market_value: 3040 },
        { investment: 'ITC Hotels Ltd', investment_code: 'INDS7', broker: 'Pinnacle', total_units: 4, unit_price: 190, market_value: 760 },
        // Aggregated split-broker stock (20 total synced, CSV has 12)
        { investment: 'Tata Steel Ltd', investment_code: 'INDS8', broker: 'Paytm Money', total_units: 20, unit_price: 150, market_value: 3000 },
        // Oil India vs Indian Oil Corporation must match their exact respective holdings without cross-matching
        { investment: 'Oil India Ltd', investment_code: 'INDS10', broker: 'Paytm Money', total_units: 100, unit_price: 432, market_value: 43200 },
        { investment: 'Indian Oil Corporation Ltd', investment_code: 'INDS11', broker: 'Paytm Money', total_units: 100, unit_price: 150.5, market_value: 15050 },
        // Apostrophe normalization: "KWALITY WALL'S (INDIA) L" vs "Kwality Walls India Ltd"
        { investment: 'Kwality Walls India Ltd', investment_code: 'INDS12', broker: 'Paytm Money', total_units: 20, unit_price: 43.58, market_value: 871.6 },
        // SGB appearing inside INDmoney stocks -> routed to snapshot.bonds!
        { investment: '2.5% SGB 27-Jun-2031', investment_code: 'INDS9', broker: 'Paytm Money', total_units: 10, unit_price: 7920, market_value: 79200 }
      ],
      mutualFunds: [],
      mfSips: [],
      stockSips: []
    };

    const baseSnap = reconcilePortfolio({
      indmoney: ind,
      upstox: null,
      upstoxState: 'not_linked',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    // SGB cleanly separated into snapshot.bonds
    expect(baseSnap.bonds).toHaveLength(1);
    expect(baseSnap.bonds?.[0].bondType).toBe('SGB');
    expect(baseSnap.equities).toHaveLength(11);

    const { snapshot: updated, matchedCount, unmatchedOverrideNames } = applyCostOverridesToSnapshot(baseSnap, [
      { holdingKey: 'name:cholamandalaminvestment@paytmmoney', displayName: 'Cholamandalam Investment', broker: 'Paytm Money', averagePrice: 1200, csvQty: 60, csvCurrentPrice: 1870, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:godawaripowisp@paytmmoney', displayName: 'Godawari Pow & Isp', broker: 'Paytm Money', averagePrice: 180, csvQty: 50, csvCurrentPrice: 210, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:ltlarsentoubro@paytmmoney', displayName: 'LT - Larsen & Toubro', broker: 'Paytm Money', averagePrice: 3100, csvQty: 10, csvCurrentPrice: 3600, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:philipscarbonblack@paytmmoney', displayName: 'Philips Carbon Black', broker: 'Paytm Money', averagePrice: 300, csvQty: 40, csvCurrentPrice: 420, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:swiggy@paytmmoney', displayName: 'Swiggy Limited', broker: 'Paytm Money', averagePrice: 390, csvQty: 20, csvCurrentPrice: 178.2, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:itchotels@paytmmoney', displayName: 'ITC Hotels Limited', broker: 'Paytm Money', averagePrice: 165, csvQty: 16, csvCurrentPrice: 190, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:tatasteel@paytmmoney', displayName: 'Tata Steel Limited', broker: 'Paytm Money', averagePrice: 120, csvQty: 12, csvCurrentPrice: 150, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:oilindia@paytmmoney', displayName: 'Oil India', broker: 'Paytm Money', averagePrice: 340, csvQty: 100, csvCurrentPrice: 432, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:indianoilcorp@paytmmoney', displayName: 'Indian Oil Corp', broker: 'Paytm Money', averagePrice: 130, csvQty: 100, csvCurrentPrice: 150.5, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:kwalitywallsindial@paytmmoney', displayName: "KWALITY WALL'S (INDIA) L", broker: 'Paytm Money', averagePrice: 44.71, csvQty: 20, csvCurrentPrice: 43.58, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:25sgb27jun2031@paytmmoney', displayName: '2.5% SGB 27-Jun-2031', broker: 'Paytm Money', averagePrice: 5926, csvQty: 10, csvCurrentPrice: 7920, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' },
      { holdingKey: 'name:ghostcompany@paytmmoney', displayName: 'Unmatched Ghost Holding', broker: 'Paytm Money', averagePrice: 100, csvQty: 5, csvCurrentPrice: 999, source: 'csv_import', updatedAt: '2026-11-22T00:00:00Z' }
    ]);

    // 10 matched equities + 1 matched SGB bond = 11
    expect(matchedCount).toBe(11);
    expect(unmatchedOverrideNames).toEqual(['Unmatched Ghost Holding']);

    expect(updated.equities.find((e) => e.name.includes('Cholamandalam'))?.averagePrice).toBe(1200);
    expect(updated.equities.find((e) => e.name.includes('Godawari'))?.averagePrice).toBe(180);
    expect(updated.equities.find((e) => e.name.includes('Larsen'))?.averagePrice).toBe(3100);
    expect(updated.equities.find((e) => e.name === 'PCBL Ltd')?.averagePrice).toBe(300);
    expect(updated.equities.find((e) => e.name.includes('Bundl'))?.averagePrice).toBe(390);
    expect(updated.equities.find((e) => e.name === 'Oil India Ltd')?.averagePrice).toBe(340);
    expect(updated.equities.find((e) => e.name === 'Indian Oil Corporation Ltd')?.averagePrice).toBe(130);
    expect(updated.equities.find((e) => e.name.includes('Kwality'))?.averagePrice).toBe(44.71);

    // Split-broker: Paytm Money ITC Hotels matched cleanly, Pinnacle ITC Hotels NOT overwritten
    const itcPaytm = updated.equities.find((e) => e.name.includes('ITC Hotels') && e.broker === 'Paytm Money');
    const itcPinnacle = updated.equities.find((e) => e.name.includes('ITC Hotels') && e.broker === 'Pinnacle');
    expect(itcPaytm?.averagePrice).toBe(165);
    expect(itcPaytm?.partialCostBasisNote).toBeUndefined();
    expect(itcPinnacle?.averagePrice).toBeNull();

    // Aggregated split-broker Tata Steel shows partialCostBasisNote (12 of 20 units)
    const tataSteel = updated.equities.find((e) => e.name.includes('Tata Steel'));
    expect(tataSteel?.averagePrice).toBe(120);
    expect(tataSteel?.partialCostBasisNote).toContain('12 of 20 units');

    // SGB bond got its CSV avg cost & P&L
    expect(updated.bonds?.[0].averagePrice).toBe(5926);
    expect(updated.bonds?.[0].costBasisSource).toBe('csv_import');
    expect(updated.bonds?.[0].pnl).toBe(19940);
  });

  it('deduplicates cross-broker NCDs (automatically & via manual alias) and matches SGB tranches by LTP', () => {
    const ind = makeBaseIndmoney();
    ind.bonds = [
      {
        investment: 'SAMMAAN CAPITAL LIMITED SR XI CAT III&IV 10.75 NCD 31MY34 FVRS1000',
        investment_code: 'INDB1',
        broker: 'INDmoney',
        total_units: 10,
        unit_price: 1055,
        invested_amount: 10000,
        market_value: 10550,
        total_pnl: 550,
        pnl_per: 5.5
      },
      {
        investment: 'Sovereign Gold Bond Scheme 2023-24 - Series I',
        investment_code: 'INDB2',
        broker: 'INDmoney',
        total_units: 25,
        unit_price: 12937.8,
        invested_amount: 323445,
        market_value: 323445,
        total_pnl: 0,
        pnl_per: 0
      }
    ];

    // Upstox already has 1075SCL34 ("SEC RE NCD 10.75% SR XI", qty 10, LTP 1055) in makeBaseUpstox()
    const snapAuto = reconcilePortfolio({
      indmoney: ind,
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    // Should have ONLY 2 bonds total (1 merged NCD + 1 SGB), NOT 3!
    expect(snapAuto.bonds).toHaveLength(2);
    const mergedNcd = snapAuto.bonds?.find((b) => b.bondType === 'NCD');
    expect(mergedNcd?.symbol).toBe('1075SCL34');
    expect(mergedNcd?.broker).toBe('Upstox');
    expect(mergedNcd?.name).toContain('SAMMAAN CAPITAL');
    expect(mergedNcd?.costBasisSource).toBe('upstox_live');

    // Also verify manual alias works even if LTP differs > 1.5%
    ind.bonds[0].unit_price = 1120;
    const snapAlias = reconcilePortfolio({
      indmoney: ind,
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [
        {
          indmoneyName: 'SAMMAAN CAPITAL LIMITED SR XI CAT III&IV 10.75 NCD 31MY34 FVRS1000',
          upstoxSymbol: '1075SCL34'
        }
      ],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });
    expect(snapAlias.bonds).toHaveLength(2);

    // SGB CSV tranche "2.5% SGB 27-Jun-2031" (LTP 12936.83) matches "Sovereign Gold Bond Scheme 2023-24 - Series I" (LTP 12937.80)
    const { snapshot: withSgbCsv, unmatchedOverrideNames } = applyCostOverridesToSnapshot(snapAuto, [
      {
        holdingKey: 'name:25sgb27jun2031@paytmmoney',
        displayName: '2.5% SGB 27-Jun-2031',
        broker: 'Paytm Money',
        averagePrice: 5876,
        csvQty: 15,
        csvCurrentPrice: 12936.83,
        source: 'csv_import',
        updatedAt: '2026-11-22T00:00:00Z'
      }
    ]);
    expect(unmatchedOverrideNames).toHaveLength(0);
    const sgb = withSgbCsv.bonds?.find((b) => b.bondType === 'SGB');
    expect(sgb?.averagePrice).toBe(5876);
  });

  it('reconciles itemized INDmoney FDs into emergency cushion while excluding locked tax-saver FDs', () => {
    const ind = makeBaseIndmoney();
    ind.networth.investments.push({
      asset_type: 'FD',
      invested_value: 250000,
      current_value: 268000,
      return: 18000,
      return_percentage: 7.2
    });
    ind.networth.total_current_value += 268000;
    ind.networth.total_networth += 268000;
    ind.networth.total_invested += 250000;

    ind.fixedDeposits = [
      {
        investment: 'HDFC Bank Fixed Deposit (7.10%)',
        investment_code: 'FD1',
        bank_name: 'HDFC Bank',
        invested_amount: 150000,
        market_value: 161000,
        total_pnl: 11000,
        pnl_per: 7.33,
        interest_rate: 7.1,
        maturity_date: '15-Sep-2027'
      },
      {
        investment: 'SBI 5-Year Tax Saver FD (80C)',
        investment_code: 'FD2',
        invested_amount: 100000,
        market_value: 107000,
        interest_rate: '6.50%',
        maturity_date: '10-Mar-2030'
      }
    ];
    ind.savingsAccounts = [
      { investment: 'HDFC Savings', bank_name: 'HDFC Bank', market_value: 35000 },
      { investment: 'ICICI Savings', bank_name: 'ICICI Bank', market_value: 15000 }
    ];

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: makeBaseUpstox(),
      upstoxState: 'live',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.fixedDeposits).toHaveLength(2);
    expect(snap.fixedDepositTotal).toBe(268000);
    expect(snap.emergencyFdTotal).toBe(161000); // Only HDFC callable FD counts; SBI Tax Saver excluded
    // Emergency Cushion = 400k Arbitrage + 50k SA + 161k Callable FD = 611,000
    expect(snap.emergencyCushionTotal).toBe(611000);
    expect(snap.arbitrageTotal).toBe(400000);

    const taxSaver = snap.fixedDeposits?.find((f) => f.bank === 'SBI');
    expect(taxSaver?.isTaxSaver).toBe(true);
    expect(taxSaver?.countsTowardEmergency).toBe(false);
    expect(taxSaver?.interestRate).toBe(6.5);

    expect(snap.savingsAccounts).toHaveLength(2);
    expect(snap.savingsAccounts?.[0].bank).toBe('HDFC Bank');
  });

  it('falls back to INDmoney aggregate FD allocation row when itemized FD holdings are unavailable', () => {
    const ind = makeBaseIndmoney();
    ind.networth.investments.push({
      asset_type: 'FD',
      invested_value: 200000,
      current_value: 212500,
      return: 12500,
      return_percentage: 6.25
    });
    ind.networth.total_current_value += 212500;
    ind.networth.total_networth += 212500;
    ind.networth.total_invested += 200000;
    ind.fixedDeposits = [];

    const snap = reconcilePortfolio({
      indmoney: ind,
      upstox: null,
      upstoxState: 'not_linked',
      aliases: [],
      profile: { ...DEFAULT_USER_PROFILE },
      isDemo: false
    });

    expect(snap.fixedDeposits).toHaveLength(1);
    expect(snap.fixedDeposits?.[0].source).toBe('indmoney_aggregate');
    expect(snap.fixedDeposits?.[0].countsTowardEmergency).toBe(true);
    expect(snap.fixedDepositTotal).toBe(212500);
    expect(snap.emergencyFdTotal).toBe(212500);
    // 400k Arbitrage + 50k SA + 212.5k Aggregate FD = 662,500
    expect(snap.emergencyCushionTotal).toBe(662500);
  });
});
