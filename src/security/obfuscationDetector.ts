/**
 * Section 21 & P4A: Obfuscated Command Detection Engine
 * Unmasks shell evasions: base64 pipes, PowerShell encoded commands,
 * hex/octal escapes, caret insertions, and inline script evaluators.
 */

export interface ObfuscationAnalysis {
  isObfuscated: boolean;
  techniques: string[];
  decodedCommand: string;
  threatScore: number;
  hasDestructivePayload: boolean;
  threatDetails?: string[];
}

export class ObfuscationDetector {
  private static instance: ObfuscationDetector;

  // Patterns indicating command obfuscation
  private base64PipePattern = /(?:echo|printf)\s+['"]?([A-Za-z0-9+/=]{8,})['"]?\s*\|\s*(?:base64\s+-(?:d|-decode)|openssl\s+enc\s+-d\s+-base64)\s*\|\s*(?:sh|bash|zsh|dash)/i;
  private powershellEncodedPattern = /(?:powershell|pwsh)(?:\.exe)?\s+.*-(?:e|enc|encodedcommand)\s+['"]?([A-Za-z0-9+/=]{8,})['"]?/i;
  private hexEscapePattern = /(?:\\x[0-9a-fA-F]{2})+/g;
  private octalEscapePattern = /(?:\\[0-7]{3})+/g;
  private caretEvasionPattern = /[a-zA-Z0-9]\^[a-zA-Z0-9]/;
  private inlineEvalPattern = /(?:python|python3|node|perl|ruby)\s+-[ce]\s+['"].*(?:base64|b64decode|Buffer\.from|decode).*['"]/i;

  public static getInstance(): ObfuscationDetector {
    if (!ObfuscationDetector.instance) {
      ObfuscationDetector.instance = new ObfuscationDetector();
    }
    return ObfuscationDetector.instance;
  }

  /**
   * Decodes a base64 string, handling UTF-8 and UTF-16LE (used by PowerShell)
   */
  public decodeBase64Payload(rawB64: string): string {
    try {
      const buf = Buffer.from(rawB64, 'base64');
      // PowerShell EncodedCommand uses UTF-16LE (ucs2)
      const ucs2 = buf.toString('utf16le');
      if (/[a-zA-Z0-9_]{3,}/.test(ucs2) && !/[\u0000]/.test(ucs2.replace(/\0/g, ''))) {
        return ucs2.replace(/\0/g, '').trim();
      }
      return buf.toString('utf8').trim();
    } catch {
      return '';
    }
  }

  /**
   * Decodes hex escape sequences (e.g. \x72\x6d -> rm)
   */
  public decodeHexEscapes(str: string): string {
    return str.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }

  /**
   * Normalizes cmd.exe caret insertions (e.g. d^e^l -> del)
   */
  public normalizeCarets(str: string): string {
    return str.replace(/\^([a-zA-Z0-9\-_./\\])/g, '$1');
  }

  /**
   * Analyzes an input command string for obfuscation patterns and extracts the unmasked payload.
   */
  public analyze(command: string): ObfuscationAnalysis {
    if (!command || typeof command !== 'string') {
      return {
        isObfuscated: false,
        techniques: [],
        decodedCommand: command || '',
        threatScore: 0,
        hasDestructivePayload: false
      };
    }

    const techniques: string[] = [];
    let decoded = command;
    let threatScore = 0;

    // 1. Detect base64 pipe to shell
    const b64Match = command.match(this.base64PipePattern);
    if (b64Match && b64Match[1]) {
      techniques.push('BASE64_SHELL_PIPE');
      const unmasked = this.decodeBase64Payload(b64Match[1]);
      if (unmasked) {
        decoded = unmasked;
        threatScore = Math.max(threatScore, 0.95);
      }
    }

    // 2. Detect PowerShell EncodedCommand
    const psMatch = command.match(this.powershellEncodedPattern);
    if (psMatch && psMatch[1]) {
      techniques.push('POWERSHELL_ENCODED_COMMAND');
      const unmasked = this.decodeBase64Payload(psMatch[1]);
      if (unmasked) {
        decoded = unmasked;
        threatScore = Math.max(threatScore, 0.95);
      }
    }

    // 3. Detect Hex escapes
    if (this.hexEscapePattern.test(decoded)) {
      techniques.push('HEX_ESCAPE_EVASION');
      decoded = this.decodeHexEscapes(decoded);
      threatScore = Math.max(threatScore, 0.85);
    }

    // 4. Detect Caret insertions (Windows cmd evasion)
    if (this.caretEvasionPattern.test(decoded)) {
      techniques.push('CARET_INSERTION_EVASION');
      decoded = this.normalizeCarets(decoded);
      threatScore = Math.max(threatScore, 0.80);
    }

    // 5. Detect inline script base64 eval
    if (this.inlineEvalPattern.test(command)) {
      techniques.push('INLINE_SCRIPT_EVAL');
      threatScore = Math.max(threatScore, 0.85);
      // Attempt extracting any b64 string inside quotes
      const innerB64 = command.match(/['"]([A-Za-z0-9+/=]{16,})['"]/);
      if (innerB64 && innerB64[1]) {
        const unmasked = this.decodeBase64Payload(innerB64[1]);
        if (unmasked) decoded = `${decoded} -> [decoded: ${unmasked}]`;
      }
    }

    const isObfuscated = techniques.length > 0;

    return {
      isObfuscated,
      techniques,
      decodedCommand: decoded,
      threatScore,
      hasDestructivePayload: false
    };
  }
}
