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
