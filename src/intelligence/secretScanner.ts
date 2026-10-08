import * as fs from 'fs/promises';
import * as path from 'path';
import { SecretScanMatch, SecretScanResult } from './types.js';

export const SENSITIVE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'GOOGLE_API_KEY', pattern: /AIzaSy[a-zA-Z0-9_-]{33}/g },
  { name: 'OPENAI_API_KEY', pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{20,64}/g },
  { name: 'NVIDIA_API_KEY', pattern: /nvapi-[a-zA-Z0-9_-]{30,80}/g },
  { name: 'TELEGRAM_BOT_TOKEN', pattern: /\b[0-9]{8,11}:[a-zA-Z0-9_-]{35}\b/g },
  { name: 'GITHUB_TOKEN', pattern: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b/g },
  { name: 'AWS_ACCESS_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'PRIVATE_KEY', pattern: /-----BEGIN [A-Z\s]+PRIVATE KEY-----/g },
  { name: 'BEARER_AUTH', pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{30,}/gi }
];

export class SecretScanner {
  private customSecrets: Set<string> = new Set();

  registerSecret(secret: string): void {
    if (secret && secret.length >= 8) {
      this.customSecrets.add(secret.trim());
    }
  }

  scanText(text: string, location = 'string'): SecretScanResult {
    if (!text || typeof text !== 'string') {
      return { clean: true, matches: [], findings: [], scannedCount: 1 };
    }

    const matches: SecretScanMatch[] = [];
    const findings: Array<{ type: string; location: string; matchedPattern: string }> = [];

    for (const rule of SENSITIVE_PATTERNS) {
      rule.pattern.lastIndex = 0;
      const found = text.match(rule.pattern);
      if (found) {
        for (const token of found) {
          const maskedSnippet = `${token.slice(0, 4)}...${token.slice(-3)}`;
          matches.push({
            rule: rule.name,
            location,
            maskedSnippet
          });
          findings.push({
            type: rule.name,
            location,
            matchedPattern: maskedSnippet
          });
        }
      }
    }

    for (const secret of this.customSecrets) {
      if (text.includes(secret)) {
        const masked = `${secret.slice(0, 3)}...${secret.slice(-3)}`;
        matches.push({
          rule: 'CUSTOM_REGISTERED_SECRET',
          location,
          maskedSnippet: masked
        });
        findings.push({
          type: 'CUSTOM_REGISTERED_SECRET',
          location,
          matchedPattern: masked
        });
      }
    }

    return {
      clean: matches.length === 0,
      matches,
      findings,
      scannedCount: 1
    };
  }

  async scanFile(filePath: string): Promise<SecretScanResult> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.scanText(content, filePath);
    } catch {
      return { clean: true, matches: [], findings: [], scannedCount: 0 };
    }
  }

  scanData(data: any, location = 'object'): SecretScanResult {
    if (data === null || data === undefined) {
      return { clean: true, matches: [], findings: [], scannedCount: 0 };
    }

    const allMatches: SecretScanMatch[] = [];
    const allFindings: Array<{ type: string; location: string; matchedPattern: string }> = [];
    let count = 0;

    const traverse = (item: any, currentPath: string) => {
      count++;
      if (typeof item === 'string') {
        const res = this.scanText(item, currentPath);
        if (!res.clean) {
          allMatches.push(...res.matches);
          if (res.findings) allFindings.push(...res.findings);
        }
      } else if (Array.isArray(item)) {
        item.forEach((elem, idx) => traverse(elem, `${currentPath}[${idx}]`));
      } else if (typeof item === 'object') {
        for (const [key, val] of Object.entries(item)) {
          traverse(val, `${currentPath}.${key}`);
        }
      }
    };

    traverse(data, location);

    return {
      clean: allMatches.length === 0,
      matches: allMatches,
      findings: allFindings,
      scannedCount: count
    };
  }

  scanObject(data: any): SecretScanResult {
    return this.scanData(data, 'object');
  }

  redact(text: string): string {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const rule of SENSITIVE_PATTERNS) {
      rule.pattern.lastIndex = 0;
      result = result.replace(rule.pattern, `[REDACTED_${rule.name}]`);
    }
    for (const secret of this.customSecrets) {
      result = result.split(secret).join('[REDACTED_SECRET]');
    }
    return result;
  }

  async scanDirectory(dirPath: string): Promise<SecretScanResult> {
    const allMatches: SecretScanMatch[] = [];
    const allFindings: Array<{ type: string; location: string; matchedPattern: string }> = [];
    let scannedCount = 0;

    const scanDirRecursive = async (currDir: string) => {
      try {
        const entries = await fs.readdir(currDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currDir, entry.name);
          if (entry.isDirectory()) {
            await scanDirRecursive(fullPath);
          } else if (entry.isFile()) {
            scannedCount++;
            const fileRes = await this.scanFile(fullPath);
            if (!fileRes.clean) {
              allMatches.push(...fileRes.matches);
              if (fileRes.findings) allFindings.push(...fileRes.findings);
            }
          }
        }
      } catch {
        // ignore unreadable dirs
      }
    };

    await scanDirRecursive(dirPath);

    return {
      clean: allMatches.length === 0,
      matches: allMatches,
      findings: allFindings,
      scannedCount
    };
  }
}
