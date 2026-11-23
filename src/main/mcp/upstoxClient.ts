import { RawUpstoxHolding, RawUpstoxMfHolding, RawUpstoxMfSip, UpstoxFetchPayload } from '@shared/types';
import { extractMcpToolError, extractMcpToolJson, ReauthRequiredError } from './types';

interface UpstoxListEnvelope<T> {
  status?: string;
  data?: T[];
}

interface UpstoxFundsEnvelope {
  status?: string;
  data?: {
    equity?: {
      available_margin?: number;
      used_margin?: number;
      payin_amount?: number;
      payin?: number;
    };
  };
}

const AUTH_ERROR_RE = /401|unauthori[sz]ed|token|expired|invalid|session|login/i;

export async function fetchUpstoxPayloadFromClient(client: {
  listTools: () => Promise<{ tools?: Array<{ name: string }> }>;
  callTool: (req: { name: string; arguments: Record<string, unknown> }) => Promise<unknown>;
}): Promise<UpstoxFetchPayload> {
  const listed = await client.listTools();
  const available = new Set((listed.tools || []).map((t) => t.name));

  const callFirst = async <T>(
    names: string[],
    opts?: { checkAuthError?: boolean }
  ): Promise<{ data: T | null; error: string | null }> => {
    const match = names.find((n) => available.has(n));
    if (!match) return { data: null, error: null };
    const res = await client.callTool({ name: match, arguments: {} });
    const errText = extractMcpToolError(res);
    if (errText) {
      if (opts?.checkAuthError && AUTH_ERROR_RE.test(errText)) {
        throw new ReauthRequiredError('upstox', `Upstox session expired: ${errText}`);
      }
      return { data: null, error: `Upstox ${match} error: ${errText}` };
    }
    return { data: extractMcpToolJson<T>(res), error: null };
  };

  const [holdingsRes, fundsRes, positionsRes, ordersRes, mfHoldingsRes, mfSipsRes] = await Promise.all([
    callFirst<UpstoxListEnvelope<RawUpstoxHolding>>(['get-holdings', 'get_holdings'], { checkAuthError: true }),
    callFirst<UpstoxFundsEnvelope>(
      ['get-funds-margin', 'get_funds_margin', 'get_fund_and_margin_v3', 'get_user_fund_margin', 'get_balance'],
      { checkAuthError: true }
    ),
    callFirst<UpstoxListEnvelope<unknown>>(['get-positions', 'get_positions']),
    callFirst<UpstoxListEnvelope<unknown>>(['get-order-book', 'get_order_book']),
    callFirst<UpstoxListEnvelope<RawUpstoxMfHolding>>(['get-mf-holdings', 'get_mf_holdings']),
    callFirst<UpstoxListEnvelope<RawUpstoxMfSip>>(['get-mf-sips', 'get_mf_sips'])
  ]);

  const holdingsEnv = holdingsRes.data;
  const fundsEnv = fundsRes.data;

  // Non-auth upstream errors in get-funds-margin (common during Upstox's 12:00 AM–5:30 AM IST EOD lockout)
  // must not abort a valid holdings sync. Still fail if holdings itself failed or both returned nothing.
  if (!holdingsEnv) {
    if (holdingsRes.error) {
      throw new Error(holdingsRes.error);
    }
    if (!fundsEnv) {
      if (fundsRes.error) {
        throw new Error(fundsRes.error);
      }
      throw new ReauthRequiredError(
        'upstox',
        'Upstox MCP did not return holdings or funds data — please reconnect Upstox.'
      );
    }
  }

  const equityFunds = fundsEnv?.data?.equity;
  return {
    holdings: holdingsEnv?.data || [],
    funds: {
      availableMargin: Number(equityFunds?.available_margin ?? 0),
      usedMargin: Number(equityFunds?.used_margin ?? 0),
      payinAmount: Number(equityFunds?.payin_amount ?? equityFunds?.payin ?? 0)
    },
    positions: positionsRes.data?.data || [],
    orders: ordersRes.data?.data || [],
    mfHoldings: mfHoldingsRes.data?.data || [],
    mfSips: mfSipsRes.data?.data || []
  };
}
