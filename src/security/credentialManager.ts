export interface RedactionRule {
  name: string;
  pattern: RegExp;
  mask: string;
}

export class CredentialManager {
  private static instance: CredentialManager;
  private rules: RedactionRule[] = [];
  private dynamicSecrets: Set<string> = new Set();

  constructor() {
    this.initDefaultRules();
    this.extractEnvironmentSecrets();
  }

  public static getInstance(): CredentialManager {
    if (!CredentialManager.instance) {
      CredentialManager.instance = new CredentialManager();
    }
    return CredentialManager.instance;
  }

  private initDefaultRules(): void {
    this.rules = [
      {
        name: 'GEMINI_API_KEY',
        pattern: /AIzaSy[a-zA-Z0-9_-]{33}/g,
        mask: '[REDACTED_GEMINI_API_KEY]'
      },
      {
        name: 'OPENAI_API_KEY',
        pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,64}/g,
        mask: '[REDACTED_OPENAI_API_KEY]'
      },
      {
        name: 'NVIDIA_API_KEY',
        pattern: /nvapi-[a-zA-Z0-9_-]{30,80}/g,
        mask: '[REDACTED_NVIDIA_API_KEY]'
      },
      {
        name: 'TELEGRAM_BOT_TOKEN',
        pattern: /\b[0-9]{8,11}:[a-zA-Z0-9_-]{35}\b/g,
        mask: '[REDACTED_TELEGRAM_TOKEN]'
      },
      {
        name: 'GITHUB_TOKEN',
        pattern: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g,
        mask: '[REDACTED_GITHUB_TOKEN]'
      },
      {
        name: 'AWS_ACCESS_KEY',
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
        mask: '[REDACTED_AWS_KEY]'
      },
      {
        name: 'PRIVATE_KEY',
        pattern: /-----BEGIN [A-Z\s]+PRIVATE KEY-----[\s\S]+?-----END [A-Z\s]+PRIVATE KEY-----/g,
        mask: '[REDACTED_PRIVATE_KEY]'
      },
      {
        name: 'BEARER_AUTH',
        pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{25,}/gi,
        mask: 'Bearer [REDACTED_BEARER_TOKEN]'
      }
    ];
  }

  /**
   * Scans current process environment variables for sensitive tokens and registers them for dynamic redaction.
   */
  public extractEnvironmentSecrets(): void {
    const sensitiveKeyPattern = /(KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH|CREDENTIAL)/i;
    for (const [key, value] of Object.entries(process.env)) {
      if (sensitiveKeyPattern.test(key) && value && value.length >= 8) {
        this.dynamicSecrets.add(value.trim());
      }
    }
  }

  /**
   * Registers an explicit secret token to be masked wherever it appears.
   */
  public registerSecret(secret: string): void {
    if (secret && secret.length >= 5) {
      this.dynamicSecrets.add(secret.trim());
    }
  }

  /**
   * Redacts sensitive strings and credentials from a text string.
   */
  public redactString(text: string): string {
    if (!text || typeof text !== 'string') return text;

    let result = text;

    // Apply regex rules
    for (const rule of this.rules) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, rule.mask);
    }

    // Apply dynamic registered secrets
    for (const secret of this.dynamicSecrets) {
      if (result.includes(secret)) {
        result = result.split(secret).join('[REDACTED_SECRET]');
      }
    }

    return result;
  }

  /**
   * Recursively traverses any data structure (objects, arrays, strings) to scrub secrets.
   */
  public redactData<T = any>(data: T): T {
    if (data === null || data === undefined) return data;

    if (typeof data === 'string') {
      return this.redactString(data) as any;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactData(item)) as any;
    }

    if (typeof data === 'object') {
      const copy: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        copy[key] = this.redactData(value);
      }
      return copy as any;
    }

    return data;
  }
}
