import { RawUpstoxHolding, RawUpstoxMfHolding, RawUpstoxMfSip, UpstoxFetchPayload } from '@shared/types';
import { MCP_ENDPOINTS, OAUTH_CALLBACK_PORTS } from '@shared/constants';
import { SecureStore } from '@main/db/secureStore';
import { BrokerAdapter, McpFetchOptions, ReauthRequiredError } from './types';
import {
  connectMcpSession,
  ElectronMcpOAuthProvider,
  extractMcpToolError,
  extractMcpToolJson
} from './oauthProvider';

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

export class UpstoxAdapter implements BrokerAdapter<UpstoxFetchPayload> {
  readonly id = 'upstox' as const;
  readonly serverUrl = MCP_ENDPOINTS.upstox;

  constructor(private readonly store: SecureStore) {}

  hasStoredSession(): boolean {
    return ElectronMcpOAuthProvider.hasStoredTokens(this.id, this.store);
  }

  disconnect(): void {
    ElectronMcpOAuthProvider.clearStoredSession(this.id, this.store);
  }

  async connectAndAuthenticate(): Promise<void> {
    const session = await connectMcpSession({
      broker: this.id,
      serverUrl: this.serverUrl,
      callbackPort: OAUTH_CALLBACK_PORTS.upstox,
      store: this.store,
      interactive: true
    });
    await session.close();
  }

  async fetchPortfolio(options: McpFetchOptions): Promise<UpstoxFetchPayload> {
    const session = await connectMcpSession({
      broker: this.id,
      serverUrl: this.serverUrl,
      callbackPort: OAUTH_CALLBACK_PORTS.upstox,
      store: this.store,
      interactive: options.interactive
    });

    try {
      const listed = await session.client.listTools();
      const available = new Set((listed.tools || []).map((t) => t.name));

      const callFirst = async <T>(
        names: string[],
        opts?: { requiredAuthCheck?: boolean }
      ): Promise<T | null> => {
        const match = names.find((n) => available.has(n));
        if (!match) return null;
        const res = await session.client.callTool({ name: match, arguments: {} });
        const errText = extractMcpToolError(res);
        if (errText && opts?.requiredAuthCheck) {
          if (/401|unauthori[sz]ed|token|expired|invalid|session|login/i.test(errText)) {
            throw new ReauthRequiredError('upstox', `Upstox session expired: ${errText}`);
          }
          throw new Error(`Upstox ${match} error: ${errText}`);
        }
        return extractMcpToolJson<T>(res);
      };

      const [holdingsEnv, fundsEnv, positionsEnv, ordersEnv, mfHoldingsEnv, mfSipsEnv] = await Promise.all([
        callFirst<UpstoxListEnvelope<RawUpstoxHolding>>(['get-holdings', 'get_holdings'], { requiredAuthCheck: true }),
        callFirst<UpstoxFundsEnvelope>(
          ['get-funds-margin', 'get_funds_margin', 'get_user_fund_margin', 'get_balance'],
          { requiredAuthCheck: true }
        ),
        callFirst<UpstoxListEnvelope<unknown>>(['get-positions', 'get_positions']),
        callFirst<UpstoxListEnvelope<unknown>>(['get-order-book', 'get_order_book']),
        callFirst<UpstoxListEnvelope<RawUpstoxMfHolding>>(['get-mf-holdings', 'get_mf_holdings']),
        callFirst<UpstoxListEnvelope<RawUpstoxMfSip>>(['get-mf-sips', 'get_mf_sips'])
      ]);

      if (!holdingsEnv && !fundsEnv) {
        throw new ReauthRequiredError(
          'upstox',
          'Upstox MCP did not return holdings or funds data — please reconnect Upstox.'
        );
      }

      const equityFunds = fundsEnv?.data?.equity;
      return {
        holdings: holdingsEnv?.data || [],
        funds: {
          availableMargin: Number(equityFunds?.available_margin ?? 0),
          usedMargin: Number(equityFunds?.used_margin ?? 0),
          payinAmount: Number(equityFunds?.payin_amount ?? equityFunds?.payin ?? 0)
        },
        positions: positionsEnv?.data || [],
        orders: ordersEnv?.data || [],
        mfHoldings: mfHoldingsEnv?.data || [],
        mfSips: mfSipsEnv?.data || []
      };
    } finally {
      await session.close();
    }
  }
}
