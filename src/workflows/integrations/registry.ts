import * as crypto from 'crypto';
import { StoredCredential } from './credentialVault.js';

export interface IntegrationDefinition {
  id: string;
  name: string;
  description: string;
  category: 'email' | 'code' | 'search' | 'chat' | 'project' | 'custom';
  authType: 'oauth2' | 'api_key';
  oauthConfig?: {
    authorizationUrl: string;
    tokenUrl: string;
    scopes: string[];
    clientIdEnv: string;
    clientSecretEnv: string;
    pkce?: boolean;
    extraAuthParams?: Record<string, string>;
  };
  apiKeyConfig?: {
    envKey: string;
    headerName?: string;
  };
  mcpServer?: {
    command: string;
    args: string[];
    envMapping: Record<string, string>; // Maps credential keys (e.g. accessToken) to target env variable
  };
}

export const BUILTIN_INTEGRATIONS: Record<string, IntegrationDefinition> = {
  gmail: {
    id: 'gmail',
    name: 'Google Workspace / Gmail',
    description: 'Read, draft, and manage emails via Google OAuth2 and Gmail API.',
    category: 'email',
    authType: 'oauth2',
    oauthConfig: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
      clientIdEnv: 'GOOGLE_CLIENT_ID',
      clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
      pkce: true,
      extraAuthParams: {
        access_type: 'offline',
        prompt: 'consent'
      }
    },
    mcpServer: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-workspace'],
      envMapping: {
        accessToken: 'GOOGLE_ACCESS_TOKEN',
        refreshToken: 'GOOGLE_REFRESH_TOKEN'
      }
    }
  },
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Access repositories, pull requests, issues, and user profiles.',
    category: 'code',
    authType: 'oauth2',
    oauthConfig: {
      authorizationUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      scopes: ['repo', 'read:user', 'user:email'],
      clientIdEnv: 'GITHUB_CLIENT_ID',
      clientSecretEnv: 'GITHUB_CLIENT_SECRET',
      pkce: false
    },
    mcpServer: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envMapping: {
        accessToken: 'GITHUB_PERSONAL_ACCESS_TOKEN'
      }
    }
  },
  brave: {
    id: 'brave',
    name: 'Brave Search',
    description: 'Real-time privacy-preserving web search & local POI search API.',
    category: 'search',
    authType: 'api_key',
    apiKeyConfig: {
      envKey: 'BRAVE_API_KEY',
      headerName: 'X-Subscription-Token'
    },
    mcpServer: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      envMapping: {
        accessToken: 'BRAVE_API_KEY'
      }
    }
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    description: 'Send messages, read channels, and participate in conversations.',
    category: 'chat',
    authType: 'oauth2',
    oauthConfig: {
      authorizationUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      scopes: ['chat:write', 'channels:read', 'chat:write.public'],
      clientIdEnv: 'SLACK_CLIENT_ID',
      clientSecretEnv: 'SLACK_CLIENT_SECRET',
      pkce: true
    },
    mcpServer: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      envMapping: {
        accessToken: 'SLACK_BOT_TOKEN'
      }
    }
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues, cycles, projects, and roadmap milestones.',
    category: 'project',
    authType: 'oauth2',
    oauthConfig: {
      authorizationUrl: 'https://linear.app/oauth/authorize',
      tokenUrl: 'https://api.linear.app/oauth/token',
      scopes: ['read', 'write'],
      clientIdEnv: 'LINEAR_CLIENT_ID',
      clientSecretEnv: 'LINEAR_CLIENT_SECRET',
      pkce: true
    }
  }
};

export class IntegrationRegistry {
  private customIntegrations: Map<string, IntegrationDefinition> = new Map();

  registerCustom(def: IntegrationDefinition): void {
    this.customIntegrations.set(def.id, def);
  }

  get(serviceId: string): IntegrationDefinition | undefined {
    return this.customIntegrations.get(serviceId) || BUILTIN_INTEGRATIONS[serviceId];
  }

  list(): IntegrationDefinition[] {
    const all = { ...BUILTIN_INTEGRATIONS };
    for (const [k, v] of this.customIntegrations.entries()) {
      all[k] = v;
    }
    return Object.values(all);
  }

  /**
   * Generates a random PKCE code verifier and SHA-256 code challenge.
   */
  generatePkce(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    return { codeVerifier, codeChallenge };
  }

  /**
   * Builds an OAuth2 authorization URL with optional PKCE code_challenge and extra params.
   */
  buildAuthorizationUrl(options: {
    serviceId: string;
    redirectUri: string;
    state: string;
    codeChallenge?: string;
    clientIdOverride?: string;
  }): string {
    const def = this.get(options.serviceId);
    if (!def || def.authType !== 'oauth2' || !def.oauthConfig) {
      throw new Error(`Service "${options.serviceId}" does not support OAuth2`);
    }

    const { oauthConfig } = def;
    const clientId = options.clientIdOverride || process.env[oauthConfig.clientIdEnv] || '';
    if (!clientId) {
      throw new Error(`Missing OAuth client ID for ${options.serviceId} (env: ${oauthConfig.clientIdEnv})`);
    }

    const url = new URL(oauthConfig.authorizationUrl);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', options.redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', oauthConfig.scopes.join(' '));
    url.searchParams.set('state', options.state);

    if (oauthConfig.pkce && options.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }

    if (oauthConfig.extraAuthParams) {
      for (const [k, v] of Object.entries(oauthConfig.extraAuthParams)) {
        url.searchParams.set(k, v);
      }
    }

    return url.toString();
  }

  /**
   * Exchanges an authorization code for access & refresh tokens.
   */
  async exchangeCode(options: {
    serviceId: string;
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    clientIdOverride?: string;
    clientSecretOverride?: string;
  }): Promise<{
    accessToken: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scopes?: string[];
  }> {
    const def = this.get(options.serviceId);
    if (!def || def.authType !== 'oauth2' || !def.oauthConfig) {
      throw new Error(`Service "${options.serviceId}" does not support OAuth2`);
    }

    const { oauthConfig } = def;
    const clientId = options.clientIdOverride || process.env[oauthConfig.clientIdEnv] || '';
    const clientSecret = options.clientSecretOverride || process.env[oauthConfig.clientSecretEnv] || '';

    const bodyParams = new URLSearchParams();
    bodyParams.set('grant_type', 'authorization_code');
    bodyParams.set('code', options.code);
    bodyParams.set('redirect_uri', options.redirectUri);
    bodyParams.set('client_id', clientId);

    if (clientSecret) {
      bodyParams.set('client_secret', clientSecret);
    }
    if (options.codeVerifier) {
      bodyParams.set('code_verifier', options.codeVerifier);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: bodyParams.toString()
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OAuth token exchange failed with status ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as any;
    const accessToken = data.access_token;
    if (!accessToken) {
      throw new Error(`OAuth response did not include access_token`);
    }

    return {
      accessToken,
      refreshToken: data.refresh_token,
      tokenType: data.token_type || 'Bearer',
      expiresIn: data.expires_in,
      scopes: data.scope ? (typeof data.scope === 'string' ? data.scope.split(/[\s,]+/) : data.scope) : undefined
    };
  }

  /**
   * Translates a stored credential into an environment variables map for an MCP server subprocess.
   */
  buildMcpEnv(serviceId: string, cred: StoredCredential): Record<string, string> {
    const def = this.get(serviceId);
    const env: Record<string, string> = {};
    if (!def || !def.mcpServer) return env;

    for (const [credProp, targetEnvVar] of Object.entries(def.mcpServer.envMapping)) {
      if (credProp === 'accessToken' && cred.accessToken) {
        env[targetEnvVar] = cred.accessToken;
      } else if (credProp === 'refreshToken' && cred.refreshToken) {
        env[targetEnvVar] = cred.refreshToken;
      }
    }
    return env;
  }
}
