import { describe, expect, it } from 'vitest';
import { parseBrokerHoldingsCsv } from '@main/engine/csvCostParser';

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
});
