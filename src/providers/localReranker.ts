import { AutoTokenizer, AutoModelForSequenceClassification, PreTrainedTokenizer, PreTrainedModel } from '@huggingface/transformers';
import { CapabilityRegistry } from '../tools/capabilityRegistry.js';

/**
 * P4B Local Cross-Encoder Reranker.
 *
 * Hard rule (spec section 24 / build plan P4B): the reranker is a REAL
 * cross-encoder model scoring (query, passage) pairs in-process — never a
 * token-overlap / TF-IDF / cosine-similarity substitute. If the model cannot
 * be loaded (offline, missing weights, wrong model id), the capability is
 * marked `unsupported` in the capability registry and rerank() returns null;
 * callers then skip the rerank stage instead of faking it.
 *
 * Default model: Xenova/ms-marco-MiniLM-L-6-v2 — an ONNX-exported
 * cross-encoder fine-tuned on MS MARCO for relevance ranking. The model is
 * downloaded from the Hugging Face Hub on first use and cached locally.
 */

export interface RerankCandidate {
  id: string;
  text: string;
  metadata?: Record<string, any>;
}

export interface RerankResult {
  id: string;
  score: number;
  rank: number;
  metadata?: Record<string, any>;
}

export interface RerankOptions {
  /** Max pairs scored per batch (memory bound). */
  batchSize?: number;
}

export interface Reranker {
  readonly name: string;
  readonly kind: 'cross-encoder';
  readonly modelId: string;
  /** Loads the model (idempotent). Returns false (and marks the capability unsupported) when loading fails. */
  load(): Promise<boolean>;
  isLoaded(): boolean;
  /**
   * Scores every (query, candidate.text) pair with the cross-encoder and
   * returns candidates sorted by relevance descending. Returns null when the
   * reranker is unsupported (model not loadable) — never a lexical fallback.
   */
  rerank(query: string, candidates: RerankCandidate[], options?: RerankOptions): Promise<RerankResult[] | null>;
}

interface LoadState {
  loaded: boolean;
  failedReason?: string;
  tokenizer?: PreTrainedTokenizer;
  model?: PreTrainedModel;
  pending?: Promise<boolean>;
}

export class LocalCrossEncoderReranker implements Reranker {
  readonly name = 'local-cross-encoder-reranker';
  readonly kind = 'cross-encoder' as const;

  private state: LoadState = { loaded: false };
  private capabilityId = 'rag.rerank';

  constructor(
    public readonly modelId: string = process.env.RERANKER_MODEL || 'Xenova/ms-marco-MiniLM-L-6-v2',
    private capabilities: CapabilityRegistry = CapabilityRegistry.getInstance()
  ) {}

  isLoaded(): boolean {
    return this.state.loaded;
  }

  async load(): Promise<boolean> {
    if (this.state.loaded) {
      // Re-assert the honest status: a working cross-encoder is available.
      this.capabilities.setStatus(this.capabilityId, 'real');
      return true;
    }
    if (this.state.pending) return this.state.pending;

    this.state.pending = this.doLoad();
    const ok = await this.state.pending;
    this.state.pending = undefined;
    return ok;
  }

  private async doLoad(): Promise<boolean> {
    try {
      const tokenizer = await AutoTokenizer.from_pretrained(this.modelId);
      const model = await AutoModelForSequenceClassification.from_pretrained(this.modelId);
      this.state = { loaded: true, tokenizer, model };
      this.capabilities.setStatus(this.capabilityId, 'real');
      return true;
    } catch (err: any) {
      const reason = `Cross-encoder model "${this.modelId}" could not be loaded: ${err?.message || String(err)}`;
      this.state = { loaded: false, failedReason: reason };
      this.capabilities.setStatus(this.capabilityId, 'unsupported', reason);
      return false;
    }
  }

  async rerank(query: string, candidates: RerankCandidate[], options: RerankOptions = {}): Promise<RerankResult[] | null> {
    if (!this.state.loaded) {
      const ok = await this.load();
      if (!ok) return null;
    }
    if (candidates.length === 0) return [];

    const batchSize = options.batchSize || 16;
    const scores: number[] = [];

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      // transformers.js tokenizes (query, passage) cross-encoder pairs when
      // given an array of [query, passage] tuples; padding/truncation batch
      // the pairs into one model input.
      const tokenize = this.state.tokenizer as any;
      const inputs = tokenize(
        batch.map((c) => [query, c.text]),
        { padding: true, truncation: true }
      );
      const output = await (this.state.model as any)(inputs);
      const logits: any = output.logits;
      // logits: [batch, numLabels]. ms-marco cross-encoders are relevance
      // classifiers; take the probability of the positive class (softmax over
      // 2 labels, sigmoid for a single logit).
      for (let j = 0; j < batch.length; j++) {
        scores.push(positiveProbability(logits, j));
      }
    }

    const ranked: RerankResult[] = candidates.map((c, idx) => ({
      id: c.id,
      score: scores[idx],
      rank: 0,
      metadata: c.metadata
    }));
    ranked.sort((a, b) => b.score - a.score);
    ranked.forEach((r, idx) => {
      r.rank = idx + 1;
    });
    return ranked;
  }
}

function positiveProbability(logits: any, batchIndex: number): number {
  const row = logits[batchIndex];
  const values: number[] = row?.data ? Array.from(row.data as number[]) : Array.from(row as number[]);
  if (values.length === 1) {
    return sigmoid(values[0]);
  }
  // softmax over [irrelevant, relevant]
  const max = Math.max(...values);
  const exps = values.map((v: number) => Math.exp(v - max));
  const sum = exps.reduce((a: number, b: number) => a + b, 0);
  return exps[exps.length - 1] / sum;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}
