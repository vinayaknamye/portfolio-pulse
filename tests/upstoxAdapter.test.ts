import { describe, expect, it, vi } from 'vitest';
import { fetchUpstoxPayloadFromClient } from '@main/mcp/upstoxClient';
import { ReauthRequiredError } from '@main/mcp/types';
import { LocalDatabase } from '@main/db/database';
import { PortfolioRepository } from '@main/db/repository';
import { SyncOrchestrator } from '@main/engine/syncOrchestrator';
import { IndmoneyFetchPayload, UpstoxFetchPayload } from '@shared/types';

describe('UpstoxAdapter (fetchUpstoxPayloadFromClient)', () => {
  it('succeeds with holdings even when get-funds-margin returns a non-auth EOD maintenance error', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'get-holdings' }, { name: 'get-funds-margin' }]
      }),
      callTool: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
        if (name === 'get-holdings') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'success',
                  data: [{ tradingsymbol: 'INFY', quantity: 10, average_price: 1450, last_price: 1620 }]
                })
              }
            ]
          };
        }
        return {
          isError: true,
          content: [{ type: 'text', text: 'Error occurred while calling Upstox API' }]
        };
      })
    };

    const payload = await fetchUpstoxPayloadFromClient(client);
    expect(payload.holdings).toHaveLength(1);
    expect(payload.holdings[0].tradingsymbol).toBe('INFY');
    expect(payload.funds.availableMargin).toBe(0);
  });

  it('throws ReauthRequiredError when either holdings or funds-margin returns an auth/token error', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'get-holdings' }, { name: 'get-funds-margin' }]
      }),
      callTool: vi.fn().mockImplementation(async ({ name }: { name: string }) => {
        if (name === 'get-holdings') {
          return {
            isError: true,
            content: [{ type: 'text', text: '401 Unauthorized: access token expired' }]
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ status: 'success', data: { equity: { available_margin: 100 } } }) }]
        };
      })
    };

    await expect(fetchUpstoxPayloadFromClient(client)).rejects.toBeInstanceOf(ReauthRequiredError);
  });

  it('throws descriptive error when get-holdings itself returns a non-auth error', async () => {
    const client = {
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'get-holdings' }, { name: 'get-funds-margin' }]
      }),
      callTool: vi.fn().mockResolvedValue({
        isError: true,
        content: [{ type: 'text', text: 'Error occurred while calling Upstox API' }]
      })
    };

    await expect(fetchUpstoxPayloadFromClient(client)).rejects.toThrow(/Upstox get-holdings error/i);
  });
});

describe('SyncOrchestrator Upstox error-state cost-basis protection', () => {
  it('still attempts Upstox and carries forward avg buy prices when broker state is error with no stored tokens', async () => {
    const db = await LocalDatabase.open(null);
    try {
      const repo = new PortfolioRepository(db);

      const indPayload: IndmoneyFetchPayload = {
        networth: {
          total_invested: 162000,
          total_current_value: 162000,
          total_networth: 162000,
          investments: [{ asset_type: 'STOCK', invested_value: 162000, current_value: 162000 }]
        },
        stocks: [
          {
            investment: 'Infosys Limited',
            investment_code: 'INDS001',
            isin: 'INE009A01021',
            broker: 'Upstox',
            total_units: 100,
            unit_price: 1620,
            market_value: 162000,
            invested_amount: 162000
          }
        ],
        mutualFunds: [],
        mfSips: [],
        stockSips: []
      };

      const liveUpstoxPayload: UpstoxFetchPayload = {
        holdings: [
          {
            tradingsymbol: 'INFY',
            company_name: 'Infosys Limited',
            isin: 'INE009A01021',
            quantity: 100,
            average_price: 1200,
            last_price: 1620
          }
        ],
        funds: { availableMargin: 5000, usedMargin: 0, payinAmount: 0 },
        positions: [],
        orders: []
      };

      const indmoneyMock = {
        hasStoredSession: vi.fn().mockReturnValue(true),
        fetchPortfolio: vi.fn().mockResolvedValue(indPayload)
      };

      let upstoxConnected = true;
      const upstoxMock = {
        hasStoredSession: vi.fn(() => upstoxConnected),
        fetchPortfolio: vi.fn().mockImplementation(async () => {
          if (!upstoxConnected) {
            throw new ReauthRequiredError('upstox', 'Upstox session requires sign-in');
          }
          return liveUpstoxPayload;
        })
      };

      const orchestrator = new SyncOrchestrator({
        repo,
        store: { getSecret: () => null } as never,
        indmoney: indmoneyMock as never,
        upstox: upstoxMock as never
      });

      // Day 1: Live sync populates real Upstox average price (1200) -> invested 1,20,000
      const first = await orchestrator.sync({ interactive: false, source: 'manual' });
      expect(first.success).toBe(true);
      expect(first.upstoxState).toBe('live');
      expect(first.snapshot?.totalInvestedAdjusted).toBe(120000);

      // Simulate post-upgrade Keychain reset / failed broker:connect leaving state='error' and no tokens
      upstoxConnected = false;
      repo.setBrokerStatus({
        broker: 'upstox',
        state: 'error',
        lastSyncAt: null,
        lastError: 'OAuth sign-in timed out'
      });

      // Next sync MUST NOT treat Upstox as 'not_linked' — it must carry forward avg buy price (1200)!
      const second = await orchestrator.sync({ interactive: false, source: 'scheduled' });
      expect(second.success).toBe(true);
      expect(second.upstoxState).toBe('stale_reauth_required');
      expect(second.snapshot?.totalInvestedAdjusted).toBe(120000);
      expect(second.snapshot?.equities[0].averagePrice).toBe(1200);
      expect(second.snapshot?.equities[0].costBasisSource).toBe('upstox_carried_forward');
    } finally {
      db.close();
    }
  });
});
