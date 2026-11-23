import { UpstoxFetchPayload } from '@shared/types';
import { MCP_ENDPOINTS, OAUTH_CALLBACK_PORTS } from '@shared/constants';
import { SecureStore } from '@main/db/secureStore';
import { BrokerAdapter, McpFetchOptions } from './types';
import { connectMcpSession, ElectronMcpOAuthProvider } from './oauthProvider';
import { fetchUpstoxPayloadFromClient } from './upstoxClient';

export { fetchUpstoxPayloadFromClient };

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
      return await fetchUpstoxPayloadFromClient(session.client);
    } finally {
      await session.close();
    }
  }
}
