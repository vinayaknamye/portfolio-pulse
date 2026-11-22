import { describe, expect, it } from 'vitest';
import { inferBrokerFromFilename, parseBrokerHoldingsCsv } from '@main/engine/csvCostParser';

describe('parseBrokerHoldingsCsv (Multi-Broker CSV Parser)', () => {
  it('parses Zerodha Console holdings CSV with preamble summary lines', () => {
    const csv = `Holdings Statement
Client ID,AB1234
Generated on,2026-11-20

Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L
"HDFCBANK",100,1485.50,1742.00,174200,25650
"INFY",50,"1,520.25",1845.00,92250,16237.50
Total,,,266450,41887.50
`;
    const rows = parseBrokerHoldingsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].symbol).toBe('HDFCBANK');
    expect(rows[0].averagePrice).toBe(1485.5);
    expect(rows[1].symbol).toBe('INFY');
    expect(rows[1].averagePrice).toBe(1520.25);
    expect(rows[0].source).toBe('csv_import');
  });

  it('parses Paytm Money / Groww holdings CSV with ISIN and Stock Name', () => {
    const csv = `Stock Name,ISIN,Quantity,Average Buy Price,Current Value
Mirae Asset NYSE FANG+ ETF,INF769K01HF2,2435,₹148.75,535115.60
Motilal Oswal Nasdaq 100 ETF,INF247L01AP3,1250,132.40,243125.00
`;
    const rows = parseBrokerHoldingsCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].isin).toBe('INF769K01HF2');
    expect(rows[0].displayName).toBe('Mirae Asset NYSE FANG+ ETF');
    expect(rows[0].averagePrice).toBe(148.75);
    expect(rows[1].isin).toBe('INF247L01AP3');
    expect(rows[1].averagePrice).toBe(132.4);
  });

  it('derives average cost from Invested Amount / Quantity when Avg Price column is absent', () => {
    const csv = `Symbol,Quantity,Invested Amount
TCS,12,29259.60
`;
    const rows = parseBrokerHoldingsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe('TCS');
    expect(rows[0].averagePrice).toBe(2438.3);
  });

  it('throws a helpful error when required columns are missing', () => {
    expect(() => parseBrokerHoldingsCsv('ColA,ColB\nfoo,bar')).toThrow(/Could not detect holdings columns/i);
  });

  it('parses Paytm Money Web CSV with Qty, Current Price (LTP), SGBs, and broker inference', () => {
    const detected = inferBrokerFromFilename('paytm-holdings.csv');
    expect(detected).toBe('Paytm Money');

    const csv = `Name,Qty.,Avg. Price (INR),Current Price (INR),Current Value (INR),Returns (INR),Returns (%)
Cholamandalam Investment,60,1240.50,1870.00,112200.00,37770.00,50.74
Swiggy Limited,20,390.00,178.20,3564.00,-4236.00,-54.31
2.5% SGB 27-Jun-2031,10,5926.00,7920.00,79200.00,19940.00,33.65
Oil India,100,340.00,432.00,43200.00,9200.00,27.06
Indian Oil Corp,100,130.00,150.50,15050.00,2050.00,15.77
`;
    const rows = parseBrokerHoldingsCsv(csv, detected);
    expect(rows).toHaveLength(5);
    expect(rows[0].broker).toBe('Paytm Money');
    expect(rows[0].csvQty).toBe(60);
    expect(rows[0].csvCurrentPrice).toBe(1870);
    expect(rows[0].holdingKey).toContain('@paytmmoney');
    expect(rows[1].displayName).toBe('Swiggy Limited');
    expect(rows[1].csvQty).toBe(20);
    expect(rows[1].csvCurrentPrice).toBe(178.2);
    expect(rows[2].displayName).toBe('2.5% SGB 27-Jun-2031');
    expect(rows[2].averagePrice).toBe(5926);
    // Oil India and Indian Oil Corp must NEVER collide!
    expect(rows[3].holdingKey).not.toBe(rows[4].holdingKey);
    expect(rows[3].displayName).toBe('Oil India');
    expect(rows[4].displayName).toBe('Indian Oil Corp');
  });
});
