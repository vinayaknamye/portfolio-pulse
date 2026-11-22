import {
  IndmoneyFetchPayload,
  RawIndmoneyBond,
  RawIndmoneyFd,
  RawIndmoneyMF,
  RawIndmoneyNetworth,
  RawIndmoneySavingsAccount,
  RawIndmoneySipItem,
  RawIndmoneyStock,
  RawIndmoneyStockSipItem
} from '@shared/types';
import { MCP_ENDPOINTS, OAUTH_CALLBACK_PORTS } from '@shared/constants';
import { SecureStore } from '@main/db/secureStore';
import { BrokerAdapter, McpFetchOptions } from './types';
import { connectMcpSession, ElectronMcpOAuthProvider, extractMcpToolJson } from './oauthProvider';

const FD_ASSET_TYPE_RE = /^(FD|FDS|FIXED_DEPOSIT|FIXED_DEPOSITS|BANK_FD)$/i;
const SA_ASSET_TYPE_RE = /^(SA|SAVINGS|SAVINGS_ACCOUNT|SAVINGS_ACCOUNTS|BANK_ACCOUNT)$/i;

function extractAllowedAssetTypes(tools: Array<{ name: string; inputSchema?: unknown }>): string[] {
  const holdingsTool = tools.find((t) => t.name === 'networth_holdings');
  const schema = holdingsTool?.inputSchema as
    | {
        properties?: Record<
          string,
          { enum?: unknown[]; anyOf?: Array<{ enum?: unknown[] }>; oneOf?: Array<{ enum?: unknown[] }> }
        >;
      }
    | undefined;
  const prop = schema?.properties?.asset_type;
  if (!prop) return [];
  const collected: string[] = [];
  if (Array.isArray(prop.enum)) {
    for (const v of prop.enum) if (typeof v === 'string') collected.push(v);
  }
  for (const branch of [...(prop.anyOf || []), ...(prop.oneOf || [])]) {
    if (Array.isArray(branch.enum)) {
      for (const v of branch.enum) if (typeof v === 'string') collected.push(v);
    }
  }
  return collected;
}

function extractHoldingsArray<T>(res: unknown): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res as T[];
  if (typeof res === 'object') {
    const rec = res as Record<string, unknown>;
    for (const key of ['holdings', 'data', 'fixed_deposits', 'fds', 'accounts', 'items']) {
      if (Array.isArray(rec[key])) return rec[key] as T[];
    }
  }
  return [];
}

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
      const toolsList = listed.tools || [];
      const available = new Set(toolsList.map((t) => t.name));
      const allowedAssetTypes = extractAllowedAssetTypes(toolsList);

      const fdSchemaType = allowedAssetTypes.find((t) => FD_ASSET_TYPE_RE.test(t)) || 'FD';
      const saSchemaType = allowedAssetTypes.find((t) => SA_ASSET_TYPE_RE.test(t)) || (allowedAssetTypes.length === 0 ? 'SA' : null);

      const callIfPresent = async <T>(name: string, args: Record<string, unknown> = {}): Promise<T | null> => {
        if (!available.has(name)) return null;
        const res = await session.client.callTool({ name, arguments: args });
        return extractMcpToolJson<T>(res);
      };

      const [networthRes, stocksRes, mfRes, bondsRes, fdRes, saRes, mfSipsRes, stockSipsRes] = await Promise.all([
        callIfPresent<RawIndmoneyNetworth>('networth_snapshot'),
        callIfPresent<{ holdings?: RawIndmoneyStock[] }>('networth_holdings', { asset_type: 'IND_STOCK' }),
        callIfPresent<{ holdings?: RawIndmoneyMF[] }>('networth_holdings', { asset_type: 'MF' }),
        callIfPresent<{ holdings?: RawIndmoneyBond[] }>('networth_holdings', { asset_type: 'BOND' }).catch(() => null),
        callIfPresent<unknown>('networth_holdings', { asset_type: fdSchemaType }).catch(() => null),
        saSchemaType
          ? callIfPresent<unknown>('networth_holdings', { asset_type: saSchemaType }).catch(() => null)
          : Promise.resolve(null),
        callIfPresent<{ mf_sips?: RawIndmoneySipItem[] }>('mf_sips'),
        callIfPresent<{ indian_stocks_sips?: RawIndmoneyStockSipItem[] }>('indian_stocks_sips')
      ]);

      if (!networthRes) {
        throw new Error('INDmoney MCP did not return networth_snapshot data.');
      }

      let fixedDeposits = extractHoldingsArray<RawIndmoneyFd>(fdRes);
      if (fixedDeposits.length === 0) {
        const snapshotFdRow = (networthRes.investments || []).find(
          (inv) => FD_ASSET_TYPE_RE.test(inv.asset_type || '') && Number(inv.current_value ?? 0) > 0
        );
        if (snapshotFdRow && snapshotFdRow.asset_type.toUpperCase() !== fdSchemaType.toUpperCase()) {
          const fallbackFdRes = await callIfPresent<unknown>('networth_holdings', {
            asset_type: snapshotFdRow.asset_type
          }).catch(() => null);
          fixedDeposits = extractHoldingsArray<RawIndmoneyFd>(fallbackFdRes);
        }
      }

      let savingsAccounts = extractHoldingsArray<RawIndmoneySavingsAccount>(saRes);
      if (savingsAccounts.length === 0 && !saSchemaType) {
        const snapshotSaRow = (networthRes.investments || []).find(
          (inv) => SA_ASSET_TYPE_RE.test(inv.asset_type || '') && Number(inv.current_value ?? 0) > 0
        );
        if (snapshotSaRow && allowedAssetTypes.some((t) => t.toUpperCase() === snapshotSaRow.asset_type.toUpperCase())) {
          const fallbackSaRes = await callIfPresent<unknown>('networth_holdings', {
            asset_type: snapshotSaRow.asset_type
          }).catch(() => null);
          savingsAccounts = extractHoldingsArray<RawIndmoneySavingsAccount>(fallbackSaRes);
        }
      }

      return {
        networth: networthRes,
        stocks: stocksRes?.holdings || [],
        mutualFunds: mfRes?.holdings || [],
        bonds: bondsRes?.holdings || [],
        fixedDeposits,
        savingsAccounts,
        mfSips: mfSipsRes?.mf_sips || [],
        stockSips: stockSipsRes?.indian_stocks_sips || []
      };
    } finally {
      await session.close();
    }
  }
}
