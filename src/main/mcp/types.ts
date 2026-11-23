import { BrokerId } from '@shared/types';

export class ReauthRequiredError extends Error {
  readonly broker: BrokerId;

  constructor(broker: BrokerId, message?: string) {
    super(message || `${broker} requires interactive OAuth sign-in`);
    this.name = 'ReauthRequiredError';
    this.broker = broker;
  }
}

export interface McpFetchOptions {
  interactive: boolean;
  timeoutMs?: number;
}

export interface BrokerAdapter<TPayload> {
  readonly id: BrokerId;
  readonly serverUrl: string;
  connectAndAuthenticate(): Promise<void>;
  fetchPortfolio(options: McpFetchOptions): Promise<TPayload>;
  disconnect(): void;
  hasStoredSession(): boolean;
}

export function extractMcpToolError(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const rec = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  if (!rec.isError) return null;
  const text = (rec.content || [])
    .map((c) => (typeof c.text === 'string' ? c.text : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || 'MCP tool returned an error';
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
