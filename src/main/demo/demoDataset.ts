import {
  IndmoneyFetchPayload,
  PortfolioSnapshot,
  SipBaselineItem,
  UpstoxFetchPayload,
  UserProfile
} from '@shared/types';
import { reconcilePortfolio } from '@main/engine/reconciler';
import { runPortfolioAudit } from '@main/engine/auditor';
import { PortfolioRepository } from '@main/db/repository';

/**
 * 100% synthetic sample portfolio for open-source evaluation ("Demo Mode").
 * Contains zero real investor data.
 */
export function buildDemoPayloads(dayOffsetFromToday = 0): {
  indmoney: IndmoneyFetchPayload;
  upstox: UpstoxFetchPayload;
  fetchedAt: string;
} {
  const dt = new Date();
  dt.setDate(dt.getDate() - dayOffsetFromToday);
  dt.setHours(21, 30, 0, 0);

  // Subtle deterministic market curve over 14 days
  const factor = 1 - dayOffsetFromToday * 0.0022 + Math.sin(dayOffsetFromToday * 0.9) * 0.0045;
  const price = (base: number) => Math.round(base * factor * 100) / 100;

  const upstoxHoldings = [
    {
      tradingsymbol: 'HDFCBANK',
      company_name: 'HDFC BANK LTD',
      isin: 'INE040A01034',
      quantity: 140,
      average_price: 1485,
      last_price: price(1742),
      day_change_percentage: 1.12
    },
    {
      tradingsymbol: 'INFY',
      company_name: 'INFOSYS LIMITED',
      isin: 'INE009A01021',
      quantity: 115,
      average_price: 1520,
      last_price: price(1845),
      day_change_percentage: 0.74
    },
    {
      tradingsymbol: 'BHARTIARTL',
      company_name: 'BHARTI AIRTEL LIMITED',
      isin: 'INE397D01024',
      quantity: 110,
      average_price: 1180,
      last_price: price(1665),
      day_change_percentage: 1.65
    },
    {
      tradingsymbol: 'LT',
      company_name: 'LARSEN & TOUBRO LTD',
      isin: 'INE018A01030',
      quantity: 45,
      average_price: 3120,
      last_price: price(3640),
      day_change_percentage: 0.48
    },
    {
      tradingsymbol: 'ITC',
      company_name: 'ITC LIMITED',
      isin: 'INE154A01025',
      quantity: 280,
      average_price: 432,
      last_price: price(478),
      day_change_percentage: -0.35
    },
    {
      tradingsymbol: 'TATAMOTORS',
      company_name: 'TATA MOTORS LIMITED',
      isin: 'INE155A01022',
      quantity: 130,
      average_price: 995,
      last_price: price(812), // Intentional >15% drawdown to showcase audit alert
      day_change_percentage: -1.42
    },
    {
      tradingsymbol: 'GOLDBEES',
      company_name: 'NIP IND ETF GOLD BEES',
      isin: 'INF204KB17I5',
      quantity: 1200,
      average_price: 62.5,
      last_price: price(74.8),
      day_change_percentage: 0.31
    },
    {
      // Corporate NCD to demonstrate automatic non-equity bond filtering
      tradingsymbol: '985NCD29',
      company_name: 'DEMO SECURED NCD 9.85% 2029',
      isin: 'INE999A07AB1',
      quantity: 25,
      average_price: 1000,
      last_price: 1032,
      day_change_percentage: 0.0
    }
  ];

  const upstoxEquities = upstoxHoldings.filter((h) => h.tradingsymbol !== '985NCD29');
  const externalNasdaqPrice = price(194.5);
  const externalNasdaqVal = Math.round(1250 * externalNasdaqPrice * 100) / 100;

  const indStocks = [
    ...upstoxEquities.map((h, i) => ({
      investment:
        h.tradingsymbol === 'LT'
          ? 'Larsen & Toubro Ltd'
          : h.tradingsymbol === 'GOLDBEES'
          ? 'Nippon India ETF Gold BeES'
          : h.company_name
              .toLowerCase()
              .replace(/\b\w/g, (c) => c.toUpperCase()),
      investment_code: `DEMO_S${i + 1}`,
      broker: 'Upstox',
      total_units: h.quantity,
      unit_price: h.last_price,
      market_value: Math.round(h.quantity * h.last_price * 100) / 100,
      invested_amount: Math.round(h.quantity * h.last_price * 100) / 100,
      market_cap: h.tradingsymbol === 'GOLDBEES' ? 'small' : 'large',
      assetclass_l2: h.tradingsymbol === 'GOLDBEES' ? 'gold' : 'equity',
      one_day_change_percentage: h.day_change_percentage
    })),
    {
      investment: 'Motilal Oswal Nasdaq 100 ETF',
      investment_code: 'DEMO_EXT1',
      broker: 'Zerodha',
      total_units: 1250,
      unit_price: externalNasdaqPrice,
      market_value: externalNasdaqVal,
      invested_amount: externalNasdaqVal,
      market_cap: 'large',
      assetclass_l2: 'equity',
      one_day_change_percentage: 0.88
    }
  ];

  const stockTotal = Math.round(indStocks.reduce((s, x) => s + x.market_value, 0) * 100) / 100;

  const liquidReduction = Math.max(0, 14 - dayOffsetFromToday) >= 7 ? 15000 : 0;
  const mfHoldings = [
    {
      investment: 'Parag Parikh Flexi Cap Fund Direct Growth',
      investment_code: 'DM101',
      total_units: 8420.5,
      unit_price: price(86.4),
      invested_amount: 580000,
      market_value: Math.round(8420.5 * price(86.4) * 100) / 100,
      total_pnl: Math.round((8420.5 * price(86.4) - 580000) * 100) / 100,
      pnl_per: Math.round(((8420.5 * price(86.4) - 580000) / 580000) * 10000) / 100,
      assetclass_l2: 'equity',
      one_day_change_percentage: 0.92
    },
    {
      investment: 'UTI Nifty 50 Index Fund Direct Growth',
      investment_code: 'DM102',
      total_units: 3910.2,
      unit_price: price(164.2),
      invested_amount: 540000,
      market_value: Math.round(3910.2 * price(164.2) * 100) / 100,
      total_pnl: Math.round((3910.2 * price(164.2) - 540000) * 100) / 100,
      pnl_per: Math.round(((3910.2 * price(164.2) - 540000) / 540000) * 10000) / 100,
      assetclass_l2: 'equity',
      one_day_change_percentage: 0.85
    },
    {
      investment: 'Kotak Emerging Equity Mid Cap Direct Growth',
      investment_code: 'DM103',
      total_units: 3280.0,
      unit_price: price(138.5),
      invested_amount: 395000,
      market_value: Math.round(3280.0 * price(138.5) * 100) / 100,
      total_pnl: Math.round((3280.0 * price(138.5) - 395000) * 100) / 100,
      pnl_per: Math.round(((3280.0 * price(138.5) - 395000) / 395000) * 10000) / 100,
      assetclass_l2: 'equity',
      one_day_change_percentage: 1.15
    },
    {
      investment: 'Nippon India Small Cap Fund Direct Growth',
      investment_code: 'DM104',
      total_units: 1850.4,
      unit_price: price(178.9),
      invested_amount: 295000,
      market_value: Math.round(1850.4 * price(178.9) * 100) / 100,
      total_pnl: Math.round((1850.4 * price(178.9) - 295000) * 100) / 100,
      pnl_per: Math.round(((1850.4 * price(178.9) - 295000) / 295000) * 10000) / 100,
      assetclass_l2: 'equity',
      one_day_change_percentage: 0.64
    },
    {
      investment: 'Kotak Equity Arbitrage Fund Direct Growth',
      investment_code: 'DM105',
      total_units: 12100.0,
      unit_price: 38.45,
      invested_amount: 445000,
      market_value: 465245,
      total_pnl: 20245,
      pnl_per: 4.55,
      assetclass_l2: 'others',
      one_day_change_percentage: 0.02
    },
    {
      investment: 'HDFC Liquid Fund Direct Growth',
      investment_code: 'DM106',
      total_units: Math.round(((260000 - liquidReduction) / 5120) * 100) / 100,
      unit_price: 5120,
      invested_amount: 248000 - liquidReduction,
      market_value: 260000 - liquidReduction,
      total_pnl: 12000,
      pnl_per: 4.84,
      assetclass_l2: 'liquid',
      one_day_change_percentage: 0.02
    }
  ];

  const mfTotal = Math.round(mfHoldings.reduce((s, m) => s + m.market_value, 0) * 100) / 100;
  const mfInvested = Math.round(mfHoldings.reduce((s, m) => s + m.invested_amount, 0) * 100) / 100;
  const ppfVal = 425000;
  const ppfInv = 350000;
  const goldVal = 310000;
  const goldInv = 185000;
  const fdVal = 157450;
  const fdInv = 150000;
  const saVal = 48500; // Slightly tight ahead of ₹35k weekly/monthly SIP cycle to demonstrate alert

  const totalCurrent = Math.round((stockTotal + mfTotal + ppfVal + goldVal + fdVal + saVal) * 100) / 100;
  const totalRawInvested = Math.round((stockTotal + mfInvested + ppfInv + goldInv + fdInv + saVal) * 100) / 100;

  const indmoney: IndmoneyFetchPayload = {
    networth: {
      total_invested: totalRawInvested,
      total_current_value: totalCurrent,
      total_networth: totalCurrent,
      investments: [
        {
          asset_type: 'MF',
          invested_value: mfInvested,
          current_value: mfTotal,
          return: mfTotal - mfInvested,
          return_percentage: ((mfTotal - mfInvested) / mfInvested) * 100,
          progress_value_percentage: (mfTotal / totalCurrent) * 100
        },
        {
          asset_type: 'STOCK',
          invested_value: stockTotal,
          current_value: stockTotal,
          return: 0,
          return_percentage: 0,
          progress_value_percentage: (stockTotal / totalCurrent) * 100
        },
        {
          asset_type: 'PPF',
          invested_value: ppfInv,
          current_value: ppfVal,
          return: ppfVal - ppfInv,
          return_percentage: ((ppfVal - ppfInv) / ppfInv) * 100,
          progress_value_percentage: (ppfVal / totalCurrent) * 100
        },
        {
          asset_type: 'GOLD',
          invested_value: goldInv,
          current_value: goldVal,
          return: goldVal - goldInv,
          return_percentage: ((goldVal - goldInv) / goldInv) * 100,
          progress_value_percentage: (goldVal / totalCurrent) * 100
        },
        {
          asset_type: 'FD',
          invested_value: fdInv,
          current_value: fdVal,
          return: fdVal - fdInv,
          return_percentage: ((fdVal - fdInv) / fdInv) * 100,
          progress_value_percentage: (fdVal / totalCurrent) * 100
        },
        {
          asset_type: 'SA',
          invested_value: saVal,
          current_value: saVal,
          return: 0,
          return_percentage: 0,
          progress_value_percentage: (saVal / totalCurrent) * 100
        }
      ],
      liabilities: { total: 0, total_loan_balance: 0, total_credit_card_due: 0 }
    },
    stocks: indStocks,
    mutualFunds: mfHoldings,
    fixedDeposits: [
      {
        investment: 'HDFC Bank Fixed Deposit (7.10%)',
        investment_code: 'DEMO_FD1',
        bank_name: 'HDFC Bank',
        invested_amount: fdInv,
        market_value: fdVal,
        total_pnl: fdVal - fdInv,
        pnl_per: Math.round(((fdVal - fdInv) / fdInv) * 10000) / 100,
        interest_rate: 7.1,
        maturity_date: '15-Sep-2027',
        tenure: '2 Years'
      }
    ],
    bonds: [
      {
        investment: '2.5% SGB 27-Jun-2031',
        investment_code: 'SGBJUN31I',
        isin: 'IN0020230069',
        broker: 'Paytm Money',
        total_units: 12,
        unit_price: price(7920),
        invested_amount: 71112,
        market_value: Math.round(12 * price(7920) * 100) / 100,
        total_pnl: Math.round((12 * price(7920) - 71112) * 100) / 100,
        pnl_per: Math.round(((12 * price(7920) - 71112) / 71112) * 10000) / 100,
        assetclass_l2: 'gold'
      }
    ],
    mfSips: [
      {
        name: 'Parag Parikh Flexi Cap Fund Direct Growth',
        isin: 'INF879O01027',
        category: 'Flexi Cap',
        planType: 'direct',
        investedAmountVal: 580000,
        currentValueVal: mfHoldings[0].market_value,
        gainPercentageVal: mfHoldings[0].pnl_per,
        folio_id: 'DEMO-1001',
        active_sips: [{ sip_frequency: 'WEEKLY', amount: 12000, sip_start_date: '05-05-2026', sip_type: 'flexi_sip' }]
      },
      {
        name: 'Kotak Emerging Equity Mid Cap Direct Growth',
        isin: 'INF174K01LS2',
        category: 'Mid-Cap',
        planType: 'direct',
        investedAmountVal: 395000,
        currentValueVal: mfHoldings[2].market_value,
        gainPercentageVal: mfHoldings[2].pnl_per,
        folio_id: 'DEMO-1002',
        active_sips: [{ sip_frequency: 'WEEKLY', amount: 10000, sip_start_date: '05-05-2026', sip_type: 'flexi_sip' }]
      },
      {
        name: 'Nippon India Small Cap Fund Direct Growth',
        isin: 'INF204K01K15',
        category: 'Small-Cap',
        planType: 'direct',
        investedAmountVal: 295000,
        currentValueVal: mfHoldings[3].market_value,
        gainPercentageVal: mfHoldings[3].pnl_per,
        folio_id: 'DEMO-1003',
        active_sips: [{ sip_frequency: 'WEEKLY', amount: 8000, sip_start_date: '05-05-2026', sip_type: 'flexi_sip' }]
      },
      {
        name: 'UTI Nifty 50 Index Fund Direct Growth',
        isin: 'INF789F01XA0',
        category: 'Index Funds',
        planType: 'direct',
        investedAmountVal: 540000,
        currentValueVal: mfHoldings[1].market_value,
        gainPercentageVal: mfHoldings[1].pnl_per,
        folio_id: 'DEMO-1004',
        active_sips: [{ sip_frequency: 'MONTHLY', amount: 25000, sip_start_date: '07-06-2026', sip_type: 'bse_sip' }]
      }
    ],
    stockSips: []
  };

  const upstox: UpstoxFetchPayload = {
    holdings: upstoxHoldings,
    funds: {
      availableMargin: 7850.5, // Intentionally > ₹5,000 to showcase Idle Margin alert
      usedMargin: 0,
      payinAmount: 7850.5
    },
    positions: [],
    orders: [],
    mfHoldings: [],
    mfSips: [
      {
        fund: 'HDFC Mid-Cap Opportunities Fund Direct Growth',
        status: 'ACTIVE',
        frequency: 'MONTHLY',
        sip_id: 'UP-DEMO-1',
        instrument_key: 'INF179K01XQ0',
        instalment_amount: 10000,
        next_instalment: '2026-12-05',
        created: '2026-04-05 10:00:00.0',
        sip_type: 'Auto'
      },
      {
        fund: 'Legacy ELSS Tax Saver Fund Regular Growth',
        status: 'CANCELLED',
        frequency: 'MONTHLY',
        sip_id: 'UP-DEMO-OLD',
        instrument_key: 'INF204K01GK4',
        instalment_amount: 2000,
        next_instalment: '2020-06-15',
        created: '2018-05-01 10:00:00.0',
        sip_type: 'Auto'
      }
    ]
  };

  return { indmoney, upstox, fetchedAt: dt.toISOString() };
}

export function ensureDemoSeeded(repo: PortfolioRepository, profile: UserProfile): PortfolioSnapshot {
  const existing = repo.getLatestSnapshot(true);
  if (existing) return existing;

  let prevSnap: PortfolioSnapshot | null = null;
  let latestSnap!: PortfolioSnapshot;
  let latestId = 0;

  for (let dayOffset = 13; dayOffset >= 0; dayOffset--) {
    const { indmoney, upstox, fetchedAt } = buildDemoPayloads(dayOffset);
    const snap = reconcilePortfolio({
      indmoney,
      upstox,
      upstoxState: 'live',
      aliases: [],
      profile,
      isDemo: true,
      fetchedAt
    });
    const id = repo.saveSnapshot(snap);
    prevSnap = latestSnap || null;
    latestSnap = { ...snap, id };
    latestId = id;
  }

  const demoBaselines: SipBaselineItem[] = latestSnap.activeSips.map((s) => ({
    fundName: s.fundName,
    expectedAmount: s.amount,
    expectedFrequency: s.frequency,
    active: true
  }));
  repo.saveSipBaselines(true, demoBaselines);

  const alerts = runPortfolioAudit({
    current: latestSnap,
    previous: prevSnap,
    profile,
    sipBaselines: demoBaselines
  });
  repo.replaceAlertsForSnapshot(true, latestId, alerts);

  if (repo.getInsurancePolicies(true).length === 0) {
    repo.saveInsurancePolicy(true, {
      category: 'Term Life',
      insurer: 'HDFC Life',
      planName: 'Click 2 Protect Super (Pure Term)',
      sumAssured: 20000000,
      annualPremium: 24500,
      renewalDate: '15-Mar',
      paymentTerm: 'Regular Pay till Age 60',
      notes: 'Pure term cover — no maturity/investment component.'
    });
    repo.saveInsurancePolicy(true, {
      category: 'Health',
      insurer: 'HDFC Ergo',
      planName: 'Optima Secure Family Floater',
      sumAssured: 1500000,
      annualPremium: 32000,
      renewalDate: '10-Aug',
      paymentTerm: 'Annual',
      notes: 'Personal base cover independent of employer group policy.'
    });
  }

  return latestSnap;
}
