import http from 'http';
import crypto from 'crypto';
import { shell } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  OAuthClientProvider,
  OAuthDiscoveryState,
  UnauthorizedError
} from '@modelcontextprotocol/sdk/client/auth.js';
import {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { BrokerId } from '@shared/types';
import { SecureStore } from '@main/db/secureStore';
import { ReauthRequiredError } from './types';

interface CallbackWaiter {
  promise: Promise<string>;
  close: () => void;
}

function startOAuthCallbackServer(port: number, expectedState: string, timeoutMs = 120000): CallbackWaiter {
  let server: http.Server | null = null;
  let timer: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (server) {
      try {
        server.close();
      } catch {
        // Ignore close errors
      }
      server = null;
    }
  };

  const promise = new Promise<string>((resolve, reject) => {
    server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        if (reqUrl.pathname !== '/oauth/callback') {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }

        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, errorDesc || error));
          cleanup();
          reject(new Error(`OAuth authorization denied: ${errorDesc || error}`));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, 'Missing authorization code.'));
          cleanup();
          reject(new Error('OAuth callback missing authorization code'));
          return;
        }

        if (expectedState && state && state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(renderCallbackHtml(false, 'State mismatch — please retry linking from Portfolio Pulse.'));
          cleanup();
          reject(new Error('OAuth state mismatch'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderCallbackHtml(true, 'Account linked! You can close this tab and return to Portfolio Pulse.'));
        cleanup();
        resolve(code);
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    server.on('error', (err) => {
      cleanup();
      reject(new Error(`OAuth callback server error on port ${port}: ${err.message}`));
    });

    server.listen(port, '127.0.0.1');

    timer = setTimeout(() => {
      cleanup();
      reject(new Error('OAuth sign-in timed out after 2 minutes. Please try again.'));
    }, timeoutMs);
  });

  return { promise, close: cleanup };
}

function renderCallbackHtml(success: boolean, message: string): string {
  const accent = success ? '#10b981' : '#ef4444';
  const heading = success ? 'Connected to Portfolio Pulse' : 'Authorization Failed';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${heading}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#070b14;color:#f8fafc;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px 40px;max-width:440px;text-align:center;">
    <div style="width:48px;height:48px;border-radius:9999px;background:${accent}22;color:${accent};display:inline-flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px;">
      ${success ? '✓' : '✕'}
    </div>
    <h1 style="font-size:20px;margin:0 0 10px;">${heading}</h1>
    <p style="font-size:14px;color:#94a3b8;line-height:1.5;margin:0;">${message}</p>
  </div>
</body>
</html>`;
}

export class ElectronMcpOAuthProvider implements OAuthClientProvider {
  private readonly broker: BrokerId;
  private readonly port: number;
  private readonly store: SecureStore;
  private readonly interactive: boolean;
  private readonly currentState: string;
  private pendingAuthCodeWaiter: CallbackWaiter | null = null;
  private triggeredReauth = false;

  constructor(options: {
    broker: BrokerId;
    callbackPort: number;
    store: SecureStore;
    interactive: boolean;
  }) {
    this.broker = options.broker;
    this.port = options.callbackPort;
    this.store = options.store;
    this.interactive = options.interactive;
    this.currentState = crypto.randomBytes(16).toString('hex');
  }

  private key(suffix: string): string {
    return `mcp_oauth:${this.broker}:${suffix}`;
  }

  get redirectUrl(): string {
    return `http://localhost:${this.port}/oauth/callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Portfolio Pulse Desktop',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    };
  }

  state(): string {
    return this.currentState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.store.getJson<OAuthClientInformationMixed>(this.key('client_info')) ?? undefined;
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.store.setJson(this.key('client_info'), info);
  }

  tokens(): OAuthTokens | undefined {
    return this.store.getJson<OAuthTokens>(this.key('tokens')) ?? undefined;
  }

  saveTokens(tokens: OAuthTokens): void {
    this.store.setJson(this.key('tokens'), tokens);
  }

  saveCodeVerifier(codeVerifier: string): void {
    this.store.setSecret(this.key('code_verifier'), codeVerifier);
  }

  codeVerifier(): string {
    return this.store.getSecret(this.key('code_verifier')) || '';
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return this.store.getJson<OAuthDiscoveryState>(this.key('discovery')) ?? undefined;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.store.setJson(this.key('discovery'), state);
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') {
      this.store.deleteByPrefix(`mcp_oauth:${this.broker}:`);
      return;
    }
    if (scope === 'client') this.store.deleteSecret(this.key('client_info'));
    if (scope === 'tokens') this.store.deleteSecret(this.key('tokens'));
    if (scope === 'verifier') this.store.deleteSecret(this.key('code_verifier'));
    if (scope === 'discovery') this.store.deleteSecret(this.key('discovery'));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) {
      this.triggeredReauth = true;
      throw new ReauthRequiredError(
        this.broker,
        `${this.broker} OAuth session expired and requires interactive sign-in.`
      );
    }

    // Start local loopback listener before launching browser
    this.pendingAuthCodeWaiter?.close();
    this.pendingAuthCodeWaiter = startOAuthCallbackServer(this.port, this.currentState);
    await shell.openExternal(authorizationUrl.toString());
  }

  wasReauthTriggered(): boolean {
    return this.triggeredReauth;
  }

  async waitForAuthorizationCode(): Promise<string> {
    if (!this.pendingAuthCodeWaiter) {
      throw new Error('No pending OAuth authorization flow');
    }
    try {
      return await this.pendingAuthCodeWaiter.promise;
    } finally {
      this.pendingAuthCodeWaiter = null;
    }
  }

  cleanup(): void {
    this.pendingAuthCodeWaiter?.close();
    this.pendingAuthCodeWaiter = null;
  }

  static hasStoredTokens(broker: BrokerId, store: SecureStore): boolean {
    const tokens = store.getJson<OAuthTokens>(`mcp_oauth:${broker}:tokens`);
    return Boolean(tokens?.access_token);
  }

  static clearStoredSession(broker: BrokerId, store: SecureStore): void {
    store.deleteByPrefix(`mcp_oauth:${broker}:`);
  }
}

export interface ConnectedMcpSession {
  client: Client;
  transport: StreamableHTTPClientTransport;
  close: () => Promise<void>;
}

/**
 * Connects to a remote StreamableHTTP MCP server with automatic OAuth PKCE handling.
 * - In background mode (`interactive: false`), throws `ReauthRequiredError` cleanly if refresh fails.
 * - In interactive mode (`interactive: true`), completes browser OAuth via loopback callback and reconnects.
 */
export async function connectMcpSession(options: {
  broker: BrokerId;
  serverUrl: string;
  callbackPort: number;
  store: SecureStore;
  interactive: boolean;
}): Promise<ConnectedMcpSession> {
  const provider = new ElectronMcpOAuthProvider({
    broker: options.broker,
    callbackPort: options.callbackPort,
    store: options.store,
    interactive: options.interactive
  });

  const makeClientAndTransport = () => {
    const transport = new StreamableHTTPClientTransport(new URL(options.serverUrl), {
      authProvider: provider
    });
    const client = new Client(
      { name: 'portfolio-pulse-desktop', version: '0.1.0' },
      { capabilities: {} }
    );
    return { client, transport };
  };

  let attempt = 0;
  const maxAttempts = options.interactive ? 3 : 2;

  while (attempt < maxAttempts) {
    attempt += 1;
    const { client, transport } = makeClientAndTransport();

    try {
      await client.connect(transport);
      return {
        client,
        transport,
        close: async () => {
          provider.cleanup();
          try {
            await client.close();
          } catch {
            // Ignore disconnect errors
          }
        }
      };
    } catch (err) {
      if (err instanceof ReauthRequiredError || provider.wasReauthTriggered()) {
        provider.cleanup();
        throw new ReauthRequiredError(options.broker);
      }

      const msg = err instanceof Error ? err.message : String(err);

      // Handle stale dynamic client registration (common on Upstox MCP)
      if (/invalid_client|client not found/i.test(msg)) {
        provider.invalidateCredentials('all');
        if (!options.interactive) {
          provider.cleanup();
          throw new ReauthRequiredError(
            options.broker,
            `${options.broker} client registration expired. Please reconnect interactively.`
          );
        }
        continue;
      }

      if (err instanceof UnauthorizedError) {
        if (!options.interactive) {
          provider.cleanup();
          throw new ReauthRequiredError(options.broker);
        }
        const authCode = await provider.waitForAuthorizationCode();
        await transport.finishAuth(authCode);
        try {
          await transport.close();
        } catch {
          // Ignore close error before fresh reconnect
        }
        continue;
      }

      if (/401|unauthorized|invalid_grant|invalid_token/i.test(msg) && !options.interactive) {
        provider.cleanup();
        throw new ReauthRequiredError(options.broker, msg);
      }

      provider.cleanup();
      throw err;
    }
  }

  provider.cleanup();
  throw new ReauthRequiredError(options.broker, `Could not complete OAuth handshake for ${options.broker}`);
}

export function extractMcpToolJson<T>(result: unknown): T | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  if (rec.isError) return null;
  const text = rec.content?.find((c) => typeof c.text === 'string')?.text;
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
