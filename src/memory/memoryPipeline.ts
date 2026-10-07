import { PromptDefense } from '../security/promptDefense.js';
import { CredentialManager } from '../security/credentialManager.js';
import { MemoryStore } from '../storage/stores/types.js';
import {
  MemoryScope,
  MemoryType,
  MemoryLifecycle,
  MemoryProvenance,
  ScopedMemoryItem
} from './memoryTypes.js';

export interface MemoryWriteRequest {
  fact: string;
  scope: MemoryScope;
  tags?: string[];
  type?: MemoryType;
  confidence?: number;
  lifecycle?: MemoryLifecycle;
  provenance: MemoryProvenance;
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  goalId?: string;
  embedding?: number[];
}

export interface MemoryWriteResult {
  id: number;
  status: 'stored' | 'quarantined' | 'blocked';
  sanitizedFact: string;
  lifecycle: MemoryLifecycle;
  confidence: number;
  quarantineReason?: string;
  threatsDetected?: string[];
  secretsRedacted?: boolean;
}

export class MemoryWritePipeline {
  private promptDefense: PromptDefense;
  private credentialManager: CredentialManager;

  constructor(
    private memoryStore: MemoryStore,
    promptDefense?: PromptDefense,
    credentialManager?: CredentialManager
  ) {
    this.promptDefense = promptDefense || PromptDefense.getInstance();
    this.credentialManager = credentialManager || CredentialManager.getInstance();
  }

  /**
   * Section 65: Memory Write Pipeline
   * sanitize -> security check -> secret detection -> provenance -> confidence -> store
   *
   * Hard Rule: Memory can never override system policy.
   * Injection payloads written to memory are blocked or quarantined.
   */
  async processAndStore(
    request: MemoryWriteRequest,
    generateEmbeddingFn?: (text: string) => Promise<number[] | null>
  ): Promise<MemoryWriteResult> {
    // Stage 1: Sanitize
    let sanitized = this.stageSanitize(request.fact);

    // Stage 2: Security Check (Prompt Injection Detection)
    const securityCheck = this.stageSecurityCheck(sanitized);

    // Stage 3: Secret Detection & Redaction
    const secretRedaction = this.stageSecretDetection(securityCheck.sanitizedFact);
    sanitized = secretRedaction.redactedText;

    // Stage 4: Provenance Validation
    const provenance = this.stageProvenance(request.provenance);

    // Stage 5: Confidence & Lifecycle Calibration
    let lifecycle: MemoryLifecycle = request.lifecycle || 'active';
    let confidence = request.confidence !== undefined ? request.confidence : 1.0;
    let status: 'stored' | 'quarantined' | 'blocked' = 'stored';
    let quarantineReason: string | undefined = undefined;

    if (securityCheck.hasInjection) {
      status = 'quarantined';
      lifecycle = 'quarantined';
      confidence = 0.0;
      quarantineReason = `Adversarial prompt injection detected: [${securityCheck.threats.join(', ')}]`;
    } else {
      // Model-inferred facts about user stay candidate per V2 P1 rule
      const isModelInferred =
        provenance.source === 'agent_reflection' || provenance.source === 'subagent';
      if (request.scope === 'user' && isModelInferred && request.lifecycle !== 'active') {
        lifecycle = 'candidate';
        confidence = Math.min(confidence, 0.65);
      } else if (provenance.source === 'user_input') {
        confidence = Math.max(confidence, 0.95);
      }
    }

    // Optional embedding generation (skip if quarantined to avoid wasting compute)
    let embedding = request.embedding;
    if (!embedding && !securityCheck.hasInjection && generateEmbeddingFn) {
      try {
        const emb = await generateEmbeddingFn(sanitized);
        if (emb) embedding = emb;
      } catch {
        // Soft fallback
      }
    }

    // Stage 6: Store
    const memoryItemToStore: Omit<ScopedMemoryItem, 'id' | 'createdAt' | 'updatedAt'> = {
      scope: request.scope,
      fact: sanitized,
      tags: request.tags || [],
      confidence,
      lifecycle,
      type: request.type || 'fact',
      provenance,
      embedding,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      agentId: request.agentId,
      goalId: request.goalId,
      securityStatus: securityCheck.hasInjection ? 'quarantined' : 'clean',
      quarantineReason
    };

    const id = await this.memoryStore.save(memoryItemToStore);

    return {
      id,
      status,
      sanitizedFact: sanitized,
      lifecycle,
      confidence,
      quarantineReason,
      threatsDetected: securityCheck.threats,
      secretsRedacted: secretRedaction.wasRedacted
    };
  }

  private stageSanitize(text: string): string {
    if (!text || typeof text !== 'string') return '';
    // Strip null bytes and non-printable control characters except newline and tab
    let cleaned = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // Neutralize pseudo-tags that attempt to mimic memory boundaries
    cleaned = cleaned.replace(/<\/?(system|instructions|policy|admin|untrusted_content)[^>]*>/gi, '[DEFUSED_TAG]');
    return cleaned.trim();
  }

  private stageSecurityCheck(text: string): {
    hasInjection: boolean;
    threats: string[];
    sanitizedFact: string;
  } {
    const analysis = this.promptDefense.analyzeAndSanitize(text);
    return {
      hasInjection: analysis.hasInjection,
      threats: analysis.threats,
      sanitizedFact: analysis.sanitizedContent
    };
  }

  private stageSecretDetection(text: string): {
    redactedText: string;
    wasRedacted: boolean;
  } {
    const redacted = this.credentialManager.redactString(text);
    return {
      redactedText: redacted,
      wasRedacted: redacted !== text
    };
  }

  private stageProvenance(provenance: MemoryProvenance): MemoryProvenance {
    return {
      source: provenance.source || 'user_input',
      timestamp: provenance.timestamp || Date.now(),
      runId: provenance.runId,
      sessionId: provenance.sessionId,
      evidence: provenance.evidence
    };
  }
}
