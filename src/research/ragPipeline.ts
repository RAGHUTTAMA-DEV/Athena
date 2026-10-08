import crypto from 'crypto';
import { ChunkOptions, chunkText } from './chunker.js';
import { DocumentParser } from './documentParser.js';
import { IngestResult, RagQueryResult, DocumentFormat } from './researchTypes.js';
import { CapabilityRegistry } from '../tools/capabilityRegistry.js';
import { EmbeddingProvider } from '../providers/embeddingProvider.js';
import { LocalCrossEncoderReranker, Reranker } from '../providers/localReranker.js';
import { ResearchDocumentStore, VectorStore } from '../storage/stores/types.js';

/**
 * P4B RAG pipeline: ingest → parse → chunk → embed → retrieve → rerank →
 * (synthesize/verify happen at the tool/orchestration layer).
 *
 * Hard rule (spec section 24): the rerank stage uses a real cross-encoder
 * scoring (query, passage) pairs. When the reranker cannot load, the stage
 * is skipped and reported as `unsupported` — never replaced by token
 * overlap or cosine similarity masquerading as a reranker.
 */

export interface RagEngineDeps {
  vectorStore: VectorStore;
  documentStore: ResearchDocumentStore;
  embedder: EmbeddingProvider;
  reranker?: Reranker;
  capabilities?: CapabilityRegistry;
  parser?: DocumentParser;
}

export interface RagEngineOptions {
  /** Vector namespace for ingested documents (default "documents"). */
  namespace?: string;
  chunkOptions?: ChunkOptions;
  /** Candidates fetched from the vector store before reranking. */
  retrievalMultiplier?: number;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

export class RagEngine {
  private readonly namespace: string;
  private readonly chunkOptions: ChunkOptions;
  private readonly retrievalMultiplier: number;
  private readonly capabilities: CapabilityRegistry;

  constructor(private deps: RagEngineDeps, options: RagEngineOptions = {}) {
    this.namespace = options.namespace || 'documents';
    this.chunkOptions = options.chunkOptions || {};
    this.retrievalMultiplier = options.retrievalMultiplier || 4;
    this.capabilities = deps.capabilities || CapabilityRegistry.getInstance();
  }

  get embeddingModel(): string {
    return this.deps.embedder.model;
  }

  /** Ingest a local file. */
  async ingestFile(filePath: string, options: { workspaceId?: number } = {}): Promise<IngestResult> {
    const parsed = await this.getParser().parseFile(filePath);
    return this.ingestParsed(parsed, 'file', filePath, options.workspaceId);
  }

  /** Ingest raw bytes (e.g. a downloaded page or upload). */
  async ingestBuffer(
    buffer: Buffer,
    format: DocumentFormat,
    sourceUri: string,
    options: { workspaceId?: number; sourceType?: 'file' | 'url' | 'text' } = {}
  ): Promise<IngestResult> {
    const parsed = await this.getParser().parseBuffer(buffer, format, { source: sourceUri });
    return this.ingestParsed(parsed, options.sourceType || 'file', sourceUri, options.workspaceId);
  }

  /** Ingest plain text (no parsing stage needed). */
  async ingestText(
    text: string,
    format: DocumentFormat,
    sourceUri: string,
    options: { workspaceId?: number } = {}
  ): Promise<IngestResult> {
    return this.ingestParsed({ format, text }, 'text', sourceUri, options.workspaceId);
  }

  private ingestParsed(
    parsed: { format: DocumentFormat; text: string; pageCount?: number; metadata?: Record<string, any> },
    sourceType: 'file' | 'url' | 'text',
    sourceUri: string,
    workspaceId?: number
  ): Promise<IngestResult> {
    return this.ingestInternal(parsed, sourceType, sourceUri, workspaceId);
  }

  private async ingestInternal(
    parsed: { format: DocumentFormat; text: string; pageCount?: number; metadata?: Record<string, any> },
    sourceType: 'file' | 'url' | 'text',
    sourceUri: string,
    workspaceId?: number
  ): Promise<IngestResult> {
    if (!this.deps.embedder.isConfigured()) {
      const reason =
        'RAG ingest is unsupported: no embedding provider configured (set GEMINI_API_KEY, OPENAI_API_KEY, or NVIDIA_API_KEY).';
      this.capabilities.setStatus('rag.ingest', 'unsupported', reason);
      throw new Error(reason);
    }
    this.capabilities.setStatus('rag.ingest', 'real');

    const contentHash = sha256(parsed.text);

    // Deduplicate identical content.
    const existingByHash = await this.deps.documentStore.findByHash(contentHash);
    if (existingByHash) {
      return {
        documentId: existingByHash.id,
        sourceType: existingByHash.sourceType as 'file' | 'url' | 'text',
        sourceUri: existingByHash.sourceUri,
        format: existingByHash.format as DocumentFormat,
        chunkCount: existingByHash.chunkCount,
        charCount: existingByHash.charCount,
        deduplicated: true
      };
    }

    // Re-ingesting a changed source replaces its previous chunks.
    const existingByUri = await this.deps.documentStore.findBySourceUri(sourceUri);
    if (existingByUri) {
      await this.deps.vectorStore.deleteByRef(existingByUri.id);
      await this.deps.documentStore.delete(existingByUri.id);
    }

    const documentId = `doc_${crypto.randomUUID()}`;
    const chunks = chunkText(parsed.text, this.chunkOptions);

    for (const chunk of chunks) {
      const embedding = await this.deps.embedder.embed(chunk.text);
      if (!embedding) {
        throw new Error('Embedding provider returned no vector during ingest.');
      }
      await this.deps.vectorStore.upsert({
        id: `${documentId}:chunk:${chunk.index}`,
        namespace: this.namespace,
        refId: documentId,
        text: chunk.text,
        embedding,
        dims: embedding.length,
        model: this.deps.embedder.model,
        metadata: {
          chunkIndex: chunk.index,
          section: chunk.section,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd
        }
      });
    }

    await this.deps.documentStore.save({
      id: documentId,
      sourceType,
      sourceUri,
      title: sourceUri.split('/').pop() || sourceUri,
      format: parsed.format,
      contentHash,
      chunkCount: chunks.length,
      charCount: parsed.text.length,
      workspaceId: workspaceId ?? null,
      metadata: { pageCount: parsed.pageCount, ...parsed.metadata }
    });

    return {
      documentId,
      sourceType,
      sourceUri,
      format: parsed.format,
      chunkCount: chunks.length,
      charCount: parsed.text.length,
      pageCount: parsed.pageCount,
      deduplicated: false
    };
  }

  /**
   * Retrieve → rerank for a query. Reranking runs only when the real
   * cross-encoder is available; otherwise the result honestly reports
   * `reranked: false` with the skip reason.
   */
  async query(query: string, options: { topK?: number; namespace?: string } = {}): Promise<RagQueryResult> {
    const topK = options.topK || 5;
    const namespace = options.namespace || this.namespace;

    const queryEmbedding = await this.deps.embedder.embed(query);
    if (!queryEmbedding) {
      const reason = 'RAG query is unsupported: no embedding provider configured.';
      this.capabilities.setStatus('rag.ingest', 'unsupported', reason);
      throw new Error(reason);
    }

    const candidates = await this.deps.vectorStore.search(queryEmbedding, {
      namespace,
      limit: Math.max(topK * this.retrievalMultiplier, topK)
    });

    // Map chunk ids back to their source documents for citations.
    const documentIds = new Set(candidates.map((c) => c.refId).filter(Boolean));
    const documentsById = new Map<string, { id: string; sourceUri: string }>();
    for (const docId of documentIds) {
      const doc = await this.deps.documentStore.get(docId!);
      if (doc) documentsById.set(doc.id, { id: doc.id, sourceUri: doc.sourceUri });
    }

    const base = candidates.map((c) => ({
      id: c.id,
      documentId: c.refId,
      text: c.text,
      retrievalScore: c.score,
      rank: 0,
      sourceUri: c.refId ? documentsById.get(c.refId)?.sourceUri : undefined
    }));

    if (!this.deps.reranker) {
      return {
        query,
        results: rankTop(base, topK),
        reranked: false,
        rerankSkippedReason: 'No reranker configured for this RAG engine.'
      };
    }

    if (!this.deps.reranker.isLoaded() && !(await this.deps.reranker.load())) {
      const entry = this.capabilities.get('rag.rerank');
      return {
        query,
        results: rankTop(base, topK),
        reranked: false,
        rerankSkippedReason:
          entry?.reason ||
          `Reranker ${this.deps.reranker.name} is unsupported; retrieval-only ordering used.`
      };
    }

    const rerankInput = base.map((c) => ({ id: c.id, text: c.text, metadata: { ...c } }));
    const reranked = await this.deps.reranker.rerank(query, rerankInput);
    if (!reranked) {
      return {
        query,
        results: rankTop(base, topK),
        reranked: false,
        rerankSkippedReason: 'Cross-encoder reranker failed to score; retrieval-only ordering used.'
      };
    }

    const byId = new Map(base.map((b) => [b.id, b]));
    const results = reranked.slice(0, topK).map((r) => {
      const b = byId.get(r.id)!;
      return { ...b, rerankScore: r.score, rank: r.rank };
    });

    return { query, results, reranked: true, rerankerModel: this.deps.reranker.modelId };
  }

  private getParser(): DocumentParser {
    if (!this.deps.parser) {
      this.deps.parser = new DocumentParser(this.capabilities);
    }
    return this.deps.parser;
  }
}

function rankTop<T extends { retrievalScore: number }>(items: T[], topK: number): T[] {
  return items
    .slice()
    .sort((a, b) => b.retrievalScore - a.retrievalScore)
    .slice(0, topK)
    .map((item, idx) => ({ ...item, rank: idx + 1 }));
}

/**
 * Convenience factory for the standard local configuration:
 * SQLite stores + configured embedding provider + local cross-encoder.
 */
export function createRagEngine(deps: RagEngineDeps, options?: RagEngineOptions): RagEngine {
  return new RagEngine(
    {
      ...deps,
      reranker: deps.reranker || new LocalCrossEncoderReranker()
    },
    options
  );
}
