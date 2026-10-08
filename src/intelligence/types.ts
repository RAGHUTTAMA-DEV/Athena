import { ProviderType } from '../runtime/types.js';

export type ModelCategory =
  | 'fast'
  | 'normal'
  | 'reasoning'
  | 'coding'
  | 'vision'
  | 'cheap'
  | 'high_accuracy';

export interface ModelPolicy {
  category: ModelCategory;
  preferredModel: string;
  fallbackModel?: string;
  preferredProvider: ProviderType;
  requiredCapabilities?: string[]; // e.g. ['tool_use', 'vision', 'coding']
  maxCostPerCallUsd?: number;
  latencyTargetMs?: number;
}

export interface RouterDecision {
  category: ModelCategory;
  selectedModel: string;
  selectedProvider: ProviderType;
  model: string;
  provider: ProviderType;
  reason: string;
  estimatedCostUsd?: number;
}

export interface CredentialKeyRecord {
  id: string;
  provider: ProviderType;
  key: string;
  status: 'active' | 'cooling_down' | 'exhausted';
  cooldownUntil: number;
  failureCount: number;
  successCount: number;
  lastUsedAt: number;
}

export interface SecretScanMatch {
  rule: string;
  location: string;
  maskedSnippet: string;
}

export interface SecretScanResult {
  clean: boolean;
  matches: SecretScanMatch[];
  scannedCount: number;
  findings?: Array<{ type: string; location: string; matchedPattern: string }>;
}
