import { ProviderType } from '../runtime/types.js';
import { CredentialKeyRecord } from './types.js';

export interface CredentialPoolOptions {
  cooldownMs?: number;
  skipEnvInit?: boolean;
}

export class CredentialPool {
  private static instance: CredentialPool;
  private keys: Map<string, CredentialKeyRecord[]> = new Map();
  private currentIndex: Map<string, number> = new Map();
  private defaultCooldownMs: number;

  constructor(options?: CredentialPoolOptions) {
    this.defaultCooldownMs = options?.cooldownMs || 60000;
    if (!options?.skipEnvInit) {
      this.initFromEnv();
    }
  }

  clear(provider?: ProviderType): void {
    if (provider) {
      this.keys.delete(provider);
      this.currentIndex.delete(provider);
    } else {
      this.keys.clear();
      this.currentIndex.clear();
    }
  }

  static getInstance(): CredentialPool {
    if (!CredentialPool.instance) {
      CredentialPool.instance = new CredentialPool();
    }
    return CredentialPool.instance;
  }

  private initFromEnv(): void {
    // Collect Gemini keys (GEMINI_API_KEY, GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.)
    const geminiKeys = this.extractKeysFromEnv('GEMINI_API_KEY');
    for (const key of geminiKeys) {
      this.addKey('gemini', key);
    }

    // Collect Nvidia keys
    const nvidiaKeys = this.extractKeysFromEnv('NVIDIA_API_KEY');
    for (const key of nvidiaKeys) {
      this.addKey('nvidia', key);
    }
  }

  private extractKeysFromEnv(prefix: string): string[] {
    const keys: string[] = [];
    if (process.env[prefix]) {
      keys.push(process.env[prefix]!.trim());
    }

    for (let i = 1; i <= 10; i++) {
      const indexed = process.env[`${prefix}_${i}`];
      if (indexed) {
        keys.push(indexed.trim());
      }
    }
    return keys;
  }

  addKey(provider: ProviderType, key: string): string {
    const providerKeys = this.keys.get(provider) || [];
    const id = `key_${provider}_${providerKeys.length + 1}`;

    const record: CredentialKeyRecord = {
      id,
      provider,
      key,
      status: 'active',
      cooldownUntil: 0,
      failureCount: 0,
      successCount: 0,
      lastUsedAt: 0
    };

    providerKeys.push(record);
    this.keys.set(provider, providerKeys);
    if (!this.currentIndex.has(provider)) {
      this.currentIndex.set(provider, 0);
    }
    return id;
  }

  registerKeys(provider: ProviderType, keys: string[], cooldownMs?: number): string[] {
    if (cooldownMs) {
      this.defaultCooldownMs = cooldownMs;
    }
    const ids: string[] = [];
    for (const k of keys) {
      ids.push(this.addKey(provider, k));
    }
    return ids;
  }

  getKeys(provider: ProviderType): CredentialKeyRecord[] {
    return this.keys.get(provider) || [];
  }

  getStatus(provider: ProviderType): { totalKeys: number; healthyKeys: number; inCooldown: number } {
    const keys = this.keys.get(provider) || [];
    const now = Date.now();
    let healthy = 0;
    let cooling = 0;
    for (const k of keys) {
      if (k.status === 'cooling_down' && now >= k.cooldownUntil) {
        k.status = 'active';
        k.cooldownUntil = 0;
      }
      if (k.status === 'active') {
        healthy++;
      } else {
        cooling++;
      }
    }
    return {
      totalKeys: keys.length,
      healthyKeys: healthy,
      inCooldown: cooling
    };
  }

  /**
   * Acquire a healthy API key for the given provider.
   * If healthy keys exist, rotates round-robin.
   * If all are cooling down (e.g. during a 429 storm), selects the key whose cooldown expires earliest.
   */
  acquireKey(provider: ProviderType): CredentialKeyRecord | null {
    const providerKeys = this.keys.get(provider);
    if (!providerKeys || providerKeys.length === 0) {
      return null;
    }

    const now = Date.now();
    // Re-activate keys whose cooldown has expired
    for (const k of providerKeys) {
      if (k.status === 'cooling_down' && now >= k.cooldownUntil) {
        k.status = 'active';
        k.cooldownUntil = 0;
      }
    }

    const activeKeys = providerKeys.filter(k => k.status === 'active');
    if (activeKeys.length > 0) {
      const idx = (this.currentIndex.get(provider) || 0) % activeKeys.length;
      this.currentIndex.set(provider, (idx + 1) % activeKeys.length);
      const chosen = activeKeys[idx];
      chosen.lastUsedAt = now;
      return chosen;
    }

    // 429 Storm survival: All keys in pool are in cooldown!
    // Pick the one closest to expiry so requests can backoff and proceed without crashing
    const sorted = [...providerKeys].sort((a, b) => a.cooldownUntil - b.cooldownUntil);
    const earliest = sorted[0];
    earliest.lastUsedAt = now;
    return earliest;
  }

  recordSuccess(providerOrKeyId: string, maybeKey?: string): void {
    const target = maybeKey || providerOrKeyId;
    for (const keys of this.keys.values()) {
      const match = keys.find(k => k.id === target || k.key === target);
      if (match) {
        match.successCount++;
        match.status = 'active';
        match.cooldownUntil = 0;
        return;
      }
    }
  }

  recordRateLimit(providerOrKeyId: string, maybeKeyOrCooldown?: string | number, maybeCooldown?: number): void {
    let target = providerOrKeyId;
    let cooldown = this.defaultCooldownMs;

    if (typeof maybeKeyOrCooldown === 'string') {
      target = maybeKeyOrCooldown;
      if (typeof maybeCooldown === 'number') {
        cooldown = maybeCooldown;
      }
    } else if (typeof maybeKeyOrCooldown === 'number') {
      cooldown = maybeKeyOrCooldown;
    }

    for (const keys of this.keys.values()) {
      const match = keys.find(k => k.id === target || k.key === target);
      if (match) {
        match.failureCount++;
        match.status = 'cooling_down';
        match.cooldownUntil = Date.now() + cooldown;
        return;
      }
    }
  }

  resetAll(): void {
    for (const keys of this.keys.values()) {
      for (const k of keys) {
        k.status = 'active';
        k.cooldownUntil = 0;
      }
    }
    for (const provider of this.currentIndex.keys()) {
      this.currentIndex.set(provider, 0);
    }
  }
}
