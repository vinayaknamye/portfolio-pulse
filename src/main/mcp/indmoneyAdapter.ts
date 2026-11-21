import {
  IndmoneyFetchPayload,
  RawIndmoneyMF,
  RawIndmoneyNetworth,
  RawIndmoneySipItem,
  RawIndmoneyStock,
  RawIndmoneyStockSipItem
} from '@shared/types';
import { MCP_ENDPOINTS, OAUTH_CALLBACK_PORTS } from '@shared/constants';
import { SecureStore } from '@main/db/secureStore';
import { BrokerAdapter, McpFetchOptions } from './types';
import { connectMcpSession, ElectronMcpOAuthProvider, extractMcpToolJson } from './oauthProvider';

export class IndmoneyAdapter implements BrokerAdapter<IndmoneyFetchPayload> {
  readonly id = 'indmoney' as const;
  readonly serverUrl = MCP_ENDPOINTS.indmoney;

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
      callbackPort: OAUTH_CALLBACK_PORTS.indmoney,
      store: this.store,
      interactive: true
    });
    await session.close();
  }

  async fetchPortfolio(options: McpFetchOptions): Promise<IndmoneyFetchPayload> {
    const session = await connectMcpSession({
      broker: this.id,
      serverUrl: this.serverUrl,
      callbackPort: OAUTH_CALLBACK_PORTS.indmoney,
      store: this.store,
      interactive: options.interactive
    });

    try {
      const listed = await session.client.listTools();
      const available = new Set((listed.tools || []).map((t) => t.name));

      const callIfPresent = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> => {
        if (!available.has(name)) return null;
        const res = await session.client.callTool({ name, arguments: args });
        return extractMcpToolJson<T>(res);
      };

      const [networthRes, stocksRes, mfRes, mfSipsRes, stockSipsRes] = await Promise.all([
        callIfPresent<RawIndmoneyNetworth>('networth_snapshot'),
        callIfPresent<{ holdings?: RawIndmoneyStock[] }>('networth_holdings', { asset_type: 'IND_STOCK' }),
        callIfPresent<{ holdings?: RawIndmoneyMF[] }>('networth_holdings', { asset_type: 'MF' }),
        callIfPresent<{ mf_sips?: RawIndmoneySipItem[] }>('mf_sips'),
        callIfPresent<{ indian_stocks_sips?: RawIndmoneyStockSipItem[] }>('indian_stocks_sips')
      ]);

      if (!networthRes) {
        throw new Error('INDmoney MCP did not return networth_snapshot data.');
      }

      return {
        networth: networthRes,
        stocks: stocksRes?.holdings || [],
        mutualFunds: mfRes?.holdings || [],
        mfSips: mfSipsRes?.mf_sips || [],
        stockSips: stockSipsRes?.indian_stocks_sips || []
      };
    } finally {
      await session.close();
    }
  }
}
