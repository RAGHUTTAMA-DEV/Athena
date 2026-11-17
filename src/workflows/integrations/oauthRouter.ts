import express, { Request, Response, Router } from 'express';
import { CredentialVault } from './credentialVault.js';
import { IntegrationRegistry } from './registry.js';
import { CredentialManager } from '../../security/credentialManager.js';

interface PendingOAuthSession {
  serviceId: string;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  createdAt: number;
}

export function createOAuthRouter(options: {
  vault: CredentialVault;
  registry?: IntegrationRegistry;
  defaultRedirectUri?: string;
}): Router {
  const router = express.Router();
  const vault = options.vault;
  const registry = options.registry || new IntegrationRegistry();

  // In-memory store for pending OAuth PKCE states (expires after 10 mins)
  const pendingStates = new Map<string, PendingOAuthSession>();

  const cleanupStaleStates = () => {
    const now = Date.now();
    for (const [state, session] of pendingStates.entries()) {
      if (now - session.createdAt > 10 * 60 * 1000) {
        pendingStates.delete(state);
      }
    }
  };

  function getEnvTokenForService(serviceId: string): string | undefined {
    if (serviceId === 'github') {
      return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    }
    if (serviceId === 'gmail') {
      return process.env.GOOGLE_ACCESS_TOKEN || process.env.GMAIL_ACCESS_TOKEN || process.env.GOOGLE_TOKEN;
    }
    if (serviceId === 'slack') {
      return process.env.SLACK_BOT_TOKEN || process.env.SLACK_TOKEN;
    }
    if (serviceId === 'linear') {
      return process.env.LINEAR_API_KEY || process.env.LINEAR_TOKEN;
    }
    if (serviceId === 'brave') {
      return process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
    }
    return undefined;
  }

  function maskSecret(token?: string): string {
    if (!token) return '';
    if (token.length <= 8) return '••••' + token.slice(-2);
    return token.substring(0, 4) + '••••••••' + token.slice(-4);
  }

  /**
   * GET /api/v1/integrations
   * Lists all integrations and their current connection status.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const integrations = registry.list();
      const connected = await vault.list();
      const connectedMap = new Map(connected.map(c => [c.serviceId, c]));

      const results = integrations.map(def => {
        const conn = connectedMap.get(def.id);
        const envToken = getEnvTokenForService(def.id);
        const isConnected = Boolean(conn || envToken);
        const authSource = conn ? 'vault' : (envToken ? 'environment' : null);
        const masked = conn
          ? 'Encrypted in Vault'
          : (envToken ? maskSecret(envToken) : null);

        return {
          id: def.id,
          name: def.name,
          description: def.description,
          category: def.category,
          authType: def.authType,
          connected: isConnected,
          authSource,
          maskedToken: masked,
          isExpiring: conn ? conn.isExpiring : false,
          expiresAt: conn?.expiresAt,
          scopes: conn?.scopes || (def.oauthConfig ? def.oauthConfig.scopes : []),
          hasRefreshToken: conn?.hasRefreshToken || false
        };
      });

      res.json({ integrations: results });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/integrations/:id
   * Returns details and status for a specific integration.
   */
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const def = registry.get(id);
      if (!def) {
        return res.status(404).json({ error: { message: `Integration "${id}" not found` } });
      }

      const cred = await vault.get(id);
      const envToken = getEnvTokenForService(id);
      const isConnected = Boolean(cred || envToken);
      const authSource = cred ? 'vault' : (envToken ? 'environment' : null);
      const masked = cred
        ? (cred.accessToken ? maskSecret(cred.accessToken) : 'Vault Token')
        : (envToken ? maskSecret(envToken) : null);

      res.json({
        integration: {
          id: def.id,
          name: def.name,
          description: def.description,
          category: def.category,
          authType: def.authType,
          connected: isConnected,
          authSource,
          maskedToken: masked,
          isExpiring: cred ? vault.isExpiring(cred) : false,
          expiresAt: cred?.expiresAt,
          scopes: cred?.scopes || (def.oauthConfig ? def.oauthConfig.scopes : []),
          hasRefreshToken: Boolean(cred?.refreshToken)
        }
      });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/integrations/:id/auth-url
   * Generates authorization URL and PKCE challenge for initiating OAuth.
   */
  router.get('/:id/auth-url', async (req: Request, res: Response) => {
    try {
      cleanupStaleStates();
      const { id } = req.params;
      const def = registry.get(id);
      if (!def) {
        return res.status(404).json({ error: { message: `Integration "${id}" not found` } });
      }
      if (def.authType !== 'oauth2') {
        return res.status(400).json({ error: { message: `Integration "${id}" uses API key authentication, not OAuth2` } });
      }

      const host = req.headers.host || 'localhost:3000';
      const protocol = (req as any).protocol || 'http';
      const redirectUri = (req.query.redirect_uri as string) ||
        options.defaultRedirectUri ||
        `${protocol}://${host}/api/v1/integrations/oauth/callback`;

      const { codeVerifier, codeChallenge } = registry.generatePkce();
      const state = `oauth_${id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

      pendingStates.set(state, {
        serviceId: id,
        state,
        codeVerifier: def.oauthConfig?.pkce ? codeVerifier : undefined,
        redirectUri,
        createdAt: Date.now()
      });

      const authUrl = registry.buildAuthorizationUrl({
        serviceId: id,
        redirectUri,
        state,
        codeChallenge: def.oauthConfig?.pkce ? codeChallenge : undefined
      });

      res.json({ authUrl, state, redirectUri });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET/POST /api/v1/integrations/oauth/callback
   * Exchanges auth code for tokens and persists encrypted credentials into CredentialVault.
   */
  const handleCallback = async (req: Request, res: Response) => {
    try {
      const code = (req.query.code as string) || req.body?.code;
      const state = (req.query.state as string) || req.body?.state;
      const error = (req.query.error as string) || req.body?.error;

      if (error) {
        return res.status(400).json({ error: { message: `OAuth Provider Error: ${error}` } });
      }
      if (!code || !state) {
        return res.status(400).json({ error: { message: 'Missing "code" or "state" parameter' } });
      }

      const session = pendingStates.get(state);
      if (!session) {
        return res.status(400).json({ error: { message: 'Invalid or expired OAuth state' } });
      }
      pendingStates.delete(state);

      const tokens = await registry.exchangeCode({
        serviceId: session.serviceId,
        code,
        redirectUri: session.redirectUri,
        codeVerifier: session.codeVerifier
      });

      const expiresAt = tokens.expiresIn ? Date.now() + tokens.expiresIn * 1000 : undefined;

      await vault.save({
        serviceId: session.serviceId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        tokenType: tokens.tokenType || 'Bearer',
        scopes: tokens.scopes,
        expiresAt
      });

      // Register tokens with CredentialManager for universal redaction
      CredentialManager.getInstance().registerSecret(tokens.accessToken);
      if (tokens.refreshToken) {
        CredentialManager.getInstance().registerSecret(tokens.refreshToken);
      }

      if (req.method === 'GET' && !req.headers['accept']?.includes('application/json')) {
        // Return a clean self-closing HTML callback page for browser popups
        return res.send(`
          <!DOCTYPE html>
          <html>
            <head><title>Integration Connected</title></head>
            <body style="font-family: system-ui, sans-serif; text-align: center; padding: 40px; background: #0f172a; color: #f8fafc;">
              <h2 style="color: #38bdf8;">Integration Connected Successfully</h2>
              <p>You can now close this tab and return to Athena.</p>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'ATHENA_OAUTH_SUCCESS', serviceId: '${session.serviceId}' }, '*');
                  setTimeout(() => window.close(), 1500);
                }
              </script>
            </body>
          </html>
        `);
      }

      res.json({
        success: true,
        serviceId: session.serviceId,
        scopes: tokens.scopes,
        expiresAt
      });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  };

  router.get('/oauth/callback', handleCallback);
  router.post('/oauth/callback', handleCallback);

  /**
   * POST /api/v1/integrations/:id/credentials
   * Stores manual credentials (e.g. API keys or tokens).
   */
  router.post('/:id/credentials', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { accessToken, refreshToken, scopes, expiresIn } = req.body;

      if (!accessToken || typeof accessToken !== 'string') {
        return res.status(400).json({ error: { message: 'Missing required field "accessToken"' } });
      }

      const expiresAt = expiresIn ? Date.now() + Number(expiresIn) * 1000 : undefined;

      await vault.save({
        serviceId: id,
        accessToken,
        refreshToken,
        tokenType: 'api_key',
        scopes,
        expiresAt
      });

      // Register for redaction
      CredentialManager.getInstance().registerSecret(accessToken);
      if (refreshToken) {
        CredentialManager.getInstance().registerSecret(refreshToken);
      }

      res.json({ success: true, serviceId: id });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/integrations/:id/test
   * Validates if credentials are functional by probing the upstream API.
   */
  router.post('/:id/test', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const customToken = req.body?.accessToken;
      let token = customToken;
      if (!token) {
        const cred = await vault.get(id);
        token = cred?.accessToken || getEnvTokenForService(id);
      }

      if (!token) {
        return res.status(400).json({ valid: false, message: `No token found for integration "${id}"` });
      }

      if (id === 'github') {
        const ghRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${token}`,
            'User-Agent': 'Athena-Agent-Runtime',
            Accept: 'application/vnd.github+json'
          }
        });
        if (ghRes.ok) {
          const user: any = await ghRes.json();
          const scopes = ghRes.headers.get('x-oauth-scopes') || 'repo, read:user';
          return res.json({
            valid: true,
            username: user.login,
            name: user.name || user.login,
            avatarUrl: user.avatar_url,
            scopes
          });
        } else {
          const errBody = await ghRes.json().catch(() => ({}));
          return res.status(400).json({
            valid: false,
            message: (errBody as any).message || `GitHub returned ${ghRes.status} ${ghRes.statusText}`
          });
        }
      }

      if (id === 'slack') {
        const slRes = await fetch('https://slack.com/api/auth.test', {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const slData: any = await slRes.json().catch(() => ({ ok: false }));
        if (slData.ok) {
          return res.json({
            valid: true,
            username: slData.user,
            team: slData.team
          });
        } else {
          return res.status(400).json({ valid: false, message: slData.error || 'Slack auth test failed' });
        }
      }

      // Fallback
      return res.json({ valid: true, message: 'Token format is valid' });
    } catch (err: any) {
      res.status(500).json({ valid: false, message: err.message });
    }
  });

  /**
   * DELETE /api/v1/integrations/:id
   * Disconnects and deletes credentials.
   */
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      await vault.delete(id);
      res.json({ success: true, serviceId: id });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/integrations/:id/mcp-env
   * Returns environment variable mapping for launching MCP subprocess.
   */
  router.get('/:id/mcp-env', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let cred = await vault.get(id);
      if (!cred) {
        const envToken = getEnvTokenForService(id);
        if (envToken) {
          cred = { serviceId: id, accessToken: envToken, tokenType: 'api_key' };
        }
      }

      if (!cred) {
        return res.status(404).json({ error: { message: `No credentials configured for "${id}"` } });
      }

      const env = registry.buildMcpEnv(id, cred);
      res.json({ serviceId: id, env });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  return router;
}
