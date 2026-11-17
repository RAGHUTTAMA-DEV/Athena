import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import express from 'express';
import { AthenaDatabase } from '../storage/database.js';
import { CredentialVault } from '../workflows/integrations/credentialVault.js';
import { IntegrationRegistry } from '../workflows/integrations/registry.js';
import { createOAuthRouter } from '../workflows/integrations/oauthRouter.js';
import { CredentialManager } from '../security/credentialManager.js';

const TEST_DB = path.resolve('./scratch_test_workflows_sprint4.db');

async function runTests() {
  console.log('=== STARTING WORKFLOWS SPRINT 4: INTEGRATIONS, OAUTH & CREDENTIAL VAULT ===\n');

  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }

  const athenaDb = await AthenaDatabase.open(TEST_DB);
  const db = athenaDb.getHandle();

  // -------------------------------------------------------------------------
  // TEST 1: Credential Vault AES-256-GCM Encryption & Decryption
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Credential Vault AES-256-GCM Encryption & Decryption ---');
  const vault = new CredentialVault(db);

  const sampleSecret = 'ghp_secret_access_token_1234567890abcdefg';
  const ciphertext = vault.encrypt(sampleSecret);
  assert.ok(ciphertext && typeof ciphertext === 'string', 'Ciphertext must be a non-empty string');
  assert.notStrictEqual(ciphertext, sampleSecret, 'Ciphertext must not match plaintext');

  const decrypted = vault.decrypt(ciphertext);
  assert.strictEqual(decrypted, sampleSecret, 'Decrypted text must match original plaintext');

  // Custom 64-hex character key
  const customHexKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const customVault = new CredentialVault(db, customHexKey);
  const customCipher = customVault.encrypt(sampleSecret);
  assert.strictEqual(customVault.decrypt(customCipher), sampleSecret);

  // Tamper detection: modifying ciphertext or auth tag must throw
  const tampered = Buffer.from(ciphertext, 'base64');
  tampered[tampered.length - 1] ^= 0xff; // Flip bits
  let tamperCaught = false;
  try {
    vault.decrypt(tampered.toString('base64'));
  } catch (err) {
    tamperCaught = true;
  }
  assert.ok(tamperCaught, 'Tampered ciphertext must fail authentication and throw');
  console.log('✔ AES-256-GCM authenticated encryption and tamper detection verified.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Credential Vault SQLite Persistence & Expiration Checks
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: Credential Vault Persistence & Expiration Checks ---');
  const initialList = await vault.list();
  assert.strictEqual(initialList.length, 0, 'Initial vault must be empty');

  const now = Date.now();
  await vault.save({
    serviceId: 'github',
    accessToken: 'gho_access_token_abc_xyz',
    refreshToken: 'ghr_refresh_token_789',
    scopes: ['repo', 'read:user'],
    expiresAt: now + 3600 * 1000 // expires in 1 hr
  });

  const retrieved = await vault.get('github');
  assert.ok(retrieved, 'Must retrieve saved credential');
  assert.strictEqual(retrieved.serviceId, 'github');
  assert.strictEqual(retrieved.accessToken, 'gho_access_token_abc_xyz');
  assert.strictEqual(retrieved.refreshToken, 'ghr_refresh_token_789');
  assert.deepStrictEqual(retrieved.scopes, ['repo', 'read:user']);
  assert.strictEqual(vault.isExpiring(retrieved), false, 'Should not be expiring within 5 min');

  // Expiring credential check
  const expiringCred = {
    serviceId: 'expiring_svc',
    accessToken: 'token_123',
    expiresAt: now + 2 * 60 * 1000 // expires in 2 minutes
  };
  assert.strictEqual(vault.isExpiring(expiringCred), true, 'Must report expiring if within 5 min window');

  const listAfterSave = await vault.list();
  assert.strictEqual(listAfterSave.length, 1);
  assert.strictEqual(listAfterSave[0].serviceId, 'github');
  assert.strictEqual(listAfterSave[0].hasRefreshToken, true);

  await vault.delete('github');
  assert.strictEqual(await vault.get('github'), null, 'Deleted credential must return null');
  console.log('✔ Credential Vault persistence, expiration checking, and deletion verified.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Integration Registry & PKCE Helpers
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: Integration Registry & PKCE Helpers ---');
  const registry = new IntegrationRegistry();

  const builtins = registry.list();
  const ids = builtins.map(b => b.id);
  assert.ok(ids.includes('gmail'), 'Must include gmail');
  assert.ok(ids.includes('github'), 'Must include github');
  assert.ok(ids.includes('brave'), 'Must include brave');
  assert.ok(ids.includes('slack'), 'Must include slack');
  assert.ok(ids.includes('linear'), 'Must include linear');

  // PKCE Generation
  const pkce = registry.generatePkce();
  assert.ok(pkce.codeVerifier.length >= 43, 'Code verifier must be at least 43 chars');
  assert.ok(pkce.codeChallenge.length >= 43, 'Code challenge must be at least 43 chars');

  // Build Authorization URL
  process.env.GOOGLE_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
  const authUrl = registry.buildAuthorizationUrl({
    serviceId: 'gmail',
    redirectUri: 'http://localhost:3000/callback',
    state: 'state_123',
    codeChallenge: pkce.codeChallenge
  });
  const parsedUrl = new URL(authUrl);
  assert.strictEqual(parsedUrl.hostname, 'accounts.google.com');
  assert.strictEqual(parsedUrl.searchParams.get('client_id'), 'test-google-client-id.apps.googleusercontent.com');
  assert.strictEqual(parsedUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/callback');
  assert.strictEqual(parsedUrl.searchParams.get('state'), 'state_123');
  assert.strictEqual(parsedUrl.searchParams.get('code_challenge'), pkce.codeChallenge);
  assert.strictEqual(parsedUrl.searchParams.get('code_challenge_method'), 'S256');

  // MCP Environment mapping
  const mcpEnv = registry.buildMcpEnv('gmail', {
    serviceId: 'gmail',
    accessToken: 'google_access_token_xyz',
    refreshToken: 'google_refresh_token_abc'
  });
  assert.strictEqual(mcpEnv['GOOGLE_ACCESS_TOKEN'], 'google_access_token_xyz');
  assert.strictEqual(mcpEnv['GOOGLE_REFRESH_TOKEN'], 'google_refresh_token_abc');
  console.log('✔ Integration Registry, PKCE generation, and MCP env mapping verified.\n');

  // -------------------------------------------------------------------------
  // TEST 4: OAuth & Integrations Express Router & Security Redaction
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: OAuth & Integrations Express Router & Redaction ---');
  const oauthRouter = createOAuthRouter({ vault, registry });

  async function callRouter(options: {
    method: string;
    url: string;
    body?: any;
    headers?: Record<string, string>;
  }): Promise<{ status: number; json: any; text: string }> {
    return new Promise((resolve) => {
      let statusCode = 200;
      let output = '';

      const urlObj = new URL(`http://localhost:3000${options.url}`);
      const req: any = {
        method: options.method.toUpperCase(),
        url: options.url,
        baseUrl: '',
        originalUrl: options.url,
        path: urlObj.pathname,
        query: Object.fromEntries(urlObj.searchParams.entries()),
        body: options.body || {},
        headers: { host: 'localhost:3000', accept: 'application/json', ...(options.headers || {}) }
      };

      const res: any = {
        statusCode: 200,
        status(code: number) {
          statusCode = code;
          this.statusCode = code;
          return this;
        },
        setHeader() {
          return this;
        },
        json(data: any) {
          output = JSON.stringify(data);
          resolve({ status: statusCode, json: data, text: output });
        },
        send(data: any) {
          output = typeof data === 'string' ? data : JSON.stringify(data);
          let json: any = null;
          try { json = JSON.parse(output); } catch {}
          resolve({ status: statusCode, json, text: output });
        }
      };

      (oauthRouter as any)(req, res, (err: any) => {
        if (err) {
          resolve({ status: 500, json: { error: { message: err.message } }, text: err.message });
        } else {
          resolve({ status: 404, json: { error: { message: 'Not Found' } }, text: 'Not Found' });
        }
      });
    });
  }

  // 1. List integrations
  const listRes = await callRouter({ method: 'GET', url: '/' });
  assert.strictEqual(listRes.status, 200);
  assert.ok(Array.isArray(listRes.json.integrations));
  const braveItem = listRes.json.integrations.find((i: any) => i.id === 'brave');
  assert.strictEqual(braveItem.connected, false);

  // 2. Request Auth URL for Gmail
  const authUrlRes = await callRouter({ method: 'GET', url: '/gmail/auth-url' });
  assert.strictEqual(authUrlRes.status, 200);
  assert.ok(authUrlRes.json.authUrl.includes('accounts.google.com'));
  assert.ok(authUrlRes.json.state);

  // 3. Store API Key for Brave
  const secretKey = 'BSA_test_brave_secret_api_key_998877';
  const saveKeyRes = await callRouter({
    method: 'POST',
    url: '/brave/credentials',
    body: { accessToken: secretKey }
  });
  assert.strictEqual(saveKeyRes.status, 200);
  assert.strictEqual(saveKeyRes.json.success, true);

  // 4. Check Brave status and MCP env
  const braveStatus = await callRouter({ method: 'GET', url: '/brave' });
  assert.strictEqual(braveStatus.status, 200);
  assert.strictEqual(braveStatus.json.integration.connected, true);

  const mcpEnvRes = await callRouter({ method: 'GET', url: '/brave/mcp-env' });
  assert.strictEqual(mcpEnvRes.status, 200);
  assert.strictEqual(mcpEnvRes.json.env['BRAVE_API_KEY'], secretKey);

  // 5. Verify CredentialManager registered secret and redacts it
  const logMessage = `Sending request with key: ${secretKey} to search API`;
  const redacted = CredentialManager.getInstance().redactString(logMessage);
  assert.ok(!redacted.includes(secretKey), 'CredentialManager must redact registered secret');
  assert.ok(redacted.includes('[REDACTED_SECRET]'), 'CredentialManager must replace secret with redaction mask');

  // 6. Delete credentials
  const deleteRes = await callRouter({ method: 'DELETE', url: '/brave' });
  assert.strictEqual(deleteRes.status, 200);
  const braveAfterDelete = await callRouter({ method: 'GET', url: '/brave' });
  assert.strictEqual(braveAfterDelete.json.integration.connected, false);

  await athenaDb.close();
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  console.log('✔ OAuth Express router endpoints and security redaction fully verified.\n');

  console.log('===============================================================');
  console.log('🎉 ALL WORKFLOWS SPRINT 4 INTEGRATION & OAUTH TESTS PASSED! 🎉');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('FATAL TEST ERROR in test_workflows_sprint4:', err);
  process.exit(1);
});
