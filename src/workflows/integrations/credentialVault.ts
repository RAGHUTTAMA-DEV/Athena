import { Database } from 'sqlite';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export interface StoredCredential {
  serviceId: string;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scopes?: string[];
  expiresAt?: number;
}

export class CredentialVault {
  private key: Buffer;

  constructor(private db: Database, customKey?: string) {
    this.key = this.resolveVaultKey(customKey || process.env.ATHENA_VAULT_KEY);
  }

  /**
   * Resolves or derives a 32-byte key for AES-256-GCM.
   */
  private resolveVaultKey(keyEnv?: string): Buffer {
    if (keyEnv && keyEnv.length === 64 && /^[0-9a-fA-F]+$/.test(keyEnv)) {
      return Buffer.from(keyEnv, 'hex');
    }
    // Deterministic fallback derivation for local workspace development
    const baseSecret = keyEnv || process.env.ATHENA_SECRET || 'athena-local-vault-master-key-seed';
    return crypto.createHash('sha256').update(baseSecret).digest();
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Returns base64 representation of [12-byte IV + 16-byte AuthTag + Ciphertext].
   */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const combined = Buffer.concat([iv, authTag, encrypted]);
    return combined.toString('base64');
  }

  /**
   * Decrypts ciphertext string using AES-256-GCM.
   */
  decrypt(ciphertextBase64: string): string {
    const combined = Buffer.from(ciphertextBase64, 'base64');
    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      throw new Error('Invalid ciphertext payload: insufficient length');
    }

    const iv = combined.subarray(0, IV_LENGTH);
    const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = combined.subarray(IV_LENGTH + TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Encrypts and stores credentials in SQLite.
   */
  async save(cred: StoredCredential): Promise<void> {
    const encryptedAccess = this.encrypt(cred.accessToken);
    const encryptedRefresh = cred.refreshToken ? this.encrypt(cred.refreshToken) : null;
    const scopesJson = cred.scopes ? JSON.stringify(cred.scopes) : null;
    const now = Date.now();

    await this.db.run(
      `INSERT INTO integration_credentials (
        service_id, encrypted_token, token_type, scopes, expires_at, refresh_token, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(service_id) DO UPDATE SET
        encrypted_token = excluded.encrypted_token,
        token_type = excluded.token_type,
        scopes = excluded.scopes,
        expires_at = excluded.expires_at,
        refresh_token = excluded.refresh_token,
        updated_at = excluded.updated_at`,
      cred.serviceId,
      encryptedAccess,
      cred.tokenType || 'oauth2',
      scopesJson,
      cred.expiresAt || null,
      encryptedRefresh,
      now
    );
  }

  /**
   * Retrieves and decrypts credentials for a service.
   */
  async get(serviceId: string): Promise<StoredCredential | null> {
    const row = await this.db.get(
      `SELECT * FROM integration_credentials WHERE service_id = ?`,
      serviceId
    );
    if (!row) return null;

    return {
      serviceId: row.service_id,
      accessToken: this.decrypt(row.encrypted_token),
      refreshToken: row.refresh_token ? this.decrypt(row.refresh_token) : undefined,
      tokenType: row.token_type,
      scopes: row.scopes ? JSON.parse(row.scopes) : undefined,
      expiresAt: row.expires_at || undefined
    };
  }

  /**
   * Deletes credentials for a service.
   */
  async delete(serviceId: string): Promise<void> {
    await this.db.run(
      `DELETE FROM integration_credentials WHERE service_id = ?`,
      serviceId
    );
  }

  /**
   * Lists all connected integrations without exposing raw secret tokens.
   */
  async list(): Promise<Array<{
    serviceId: string;
    tokenType: string;
    scopes?: string[];
    expiresAt?: number;
    isExpiring: boolean;
    hasRefreshToken: boolean;
  }>> {
    const rows = await this.db.all(`SELECT * FROM integration_credentials ORDER BY service_id ASC`);
    const now = Date.now();

    return rows.map(r => ({
      serviceId: r.service_id,
      tokenType: r.token_type,
      scopes: r.scopes ? JSON.parse(r.scopes) : undefined,
      expiresAt: r.expires_at || undefined,
      isExpiring: r.expires_at ? now >= (r.expires_at - 5 * 60 * 1000) : false,
      hasRefreshToken: Boolean(r.refresh_token)
    }));
  }

  /**
   * Checks whether a credential is expired or expiring within threshold minutes (default: 5 min).
   */
  isExpiring(cred: StoredCredential, thresholdMinutes: number = 5): boolean {
    if (!cred.expiresAt) return false;
    const thresholdMs = thresholdMinutes * 60 * 1000;
    return Date.now() >= (cred.expiresAt - thresholdMs);
  }
}
