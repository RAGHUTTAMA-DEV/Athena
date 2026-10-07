export type TrustLevel = 'trusted_system' | 'trusted_user' | 'untrusted_data';

export interface UntrustedContentMetadata {
  source: 'web' | 'file' | 'email' | 'mcp' | 'subagent';
  origin?: string;
  timestamp?: number;
}

export interface InjectionDetectionResult {
  hasInjection: boolean;
  confidence: number;
  threats: string[];
  sanitizedContent: string;
}

export class PromptDefense {
  private static instance: PromptDefense;

  // Patterns frequently observed in adversarial prompt injection attacks
  private injectionPatterns: Array<{ name: string; pattern: RegExp; severity: number }> = [
    {
      name: 'INSTRUCTION_OVERRIDE',
      pattern: /(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|system)\s+(instructions|directives|prompts|rules)/i,
      severity: 0.95
    },
    {
      name: 'JAILBREAK_ROLEPLAY',
      pattern: /\b(DAN\s+mode|jailbreak|developer\s+mode\s+enabled|always\s+comply|do\s+anything\s+now)\b/i,
      severity: 0.9
    },
    {
      name: 'SYSTEM_DELIMITER_SPOOF',
      pattern: /(<\|im_start\|>|<\|im_end\|>|\[INST\]|\[\/INST\]|<system>|<\/system>|<admin>)/i,
      severity: 0.85
    },
    {
      name: 'PROMPT_LEAK_REQUEST',
      pattern: /(repeat|output|show|print|reveal)\s+(your|the)?\s*(system\s+prompt|initial\s+instructions|secret\s+instructions)/i,
      severity: 0.8
    },
    {
      name: 'DELIMITER_EVASION',
      pattern: /<\/?untrusted_content[^>]*>/i,
      severity: 0.9
    }
  ];

  public static getInstance(): PromptDefense {
    if (!PromptDefense.instance) {
      PromptDefense.instance = new PromptDefense();
    }
    return PromptDefense.instance;
  }

  /**
   * Scans content for prompt injection heuristics and disarms detected patterns.
   */
  public analyzeAndSanitize(content: string): InjectionDetectionResult {
    if (!content || typeof content !== 'string') {
      return {
        hasInjection: false,
        confidence: 0,
        threats: [],
        sanitizedContent: content || ''
      };
    }

    const threats: string[] = [];
    let maxSeverity = 0;
    let sanitized = content;

    for (const item of this.injectionPatterns) {
      if (item.pattern.test(sanitized)) {
        threats.push(item.name);
        maxSeverity = Math.max(maxSeverity, item.severity);

        // Disarm matching pattern by neutralizing actionable imperative words
        sanitized = sanitized.replace(item.pattern, (match) => `[DISARMED_INJECTION: ${match.slice(0, 30)}...]`);
      }
    }

    // Disarm any remaining boundary tag evasion attempts by neutralising closing or opening fake tags
    sanitized = sanitized.replace(/<\/?untrusted_content([^>]*)>/gi, '[UNTRUSTED_TAG_DEFUSED]');


    return {
      hasInjection: threats.length > 0,
      confidence: maxSeverity,
      threats,
      sanitizedContent: sanitized
    };
  }

  /**
   * Wraps untrusted external data (web scraping, external files, search queries) in a strict boundary
   * that instructs the model to treat the content strictly as data, never as system instructions.
   */
  public wrapUntrustedData(content: string, metadata: UntrustedContentMetadata): string {
    const analysis = this.analyzeAndSanitize(content);
    const originAttr = metadata.origin ? ` origin="${metadata.origin.replace(/"/g, '&quot;')}"` : '';
    const sourceAttr = ` source="${metadata.source}"`;

    let warningPrefix = '';
    if (analysis.hasInjection) {
      warningPrefix = `\n<!-- SECURITY NOTICE: Potential instruction injection neutralized (${analysis.threats.join(', ')}) -->\n`;
    }

    return `<untrusted_content${sourceAttr}${originAttr} trust_level="untrusted">${warningPrefix}\n${analysis.sanitizedContent}\n</untrusted_content>`;
  }

  /**
   * Checks whether a given string appears to contain unescaped adversarial delimiters.
   */
  public isInjectionDetected(content: string): boolean {
    return this.analyzeAndSanitize(content).hasInjection;
  }
}
