import { describe, expect, it, vi } from 'vitest';
import { fetchUpstoxPayloadFromClient } from '@main/mcp/upstoxAdapter';
import { ReauthRequiredError } from '@main/mcp/types';

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
