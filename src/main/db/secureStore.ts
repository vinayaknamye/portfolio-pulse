import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';

interface EncryptedPayload {
  encrypted: boolean;
  data: string; // base64 encrypted buffer or plain utf-8 when unavailable
}

/**
 * Local-first secret store backed by Electron safeStorage (macOS Keychain / Windows DPAPI).
 * Never stores secrets in SQLite or plaintext config files when OS encryption is available.
 */
export class SecureStore {
  private readonly filePath: string;
  private cache: Record<string, EncryptedPayload> = {};

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'secrets.enc.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.cache = JSON.parse(raw) as Record<string, EncryptedPayload>;
      }
    } catch {
      this.cache = {};
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
  }

  private canEncrypt(): boolean {
    try {
      return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  setSecret(key: string, value: string): void {
    if (this.canEncrypt()) {
      const buf = safeStorage.encryptString(value);
      this.cache[key] = { encrypted: true, data: buf.toString('base64') };
    } else {
      this.cache[key] = { encrypted: false, data: Buffer.from(value, 'utf-8').toString('base64') };
    }
    this.persist();
  }

  getSecret(key: string): string | null {
    const entry = this.cache[key];
    if (!entry) return null;
    try {
      const buf = Buffer.from(entry.data, 'base64');
      if (entry.encrypted) {
        return safeStorage.decryptString(buf);
      }
      return buf.toString('utf-8');
    } catch {
      return null;
    }
  }

  setJson<T>(key: string, value: T): void {
    this.setSecret(key, JSON.stringify(value));
  }

  getJson<T>(key: string): T | null {
    const raw = this.getSecret(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  deleteSecret(key: string): void {
    if (key in this.cache) {
      delete this.cache[key];
      this.persist();
    }
  }

  hasSecret(key: string): boolean {
    const val = this.getSecret(key);
    return val !== null && val.trim().length > 0;
  }

  deleteByPrefix(prefix: string): void {
    let changed = false;
    for (const k of Object.keys(this.cache)) {
      if (k.startsWith(prefix)) {
        delete this.cache[k];
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  clearAll(): void {
    this.cache = {};
    this.persist();
  }
}
