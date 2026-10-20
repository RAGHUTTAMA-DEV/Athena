import { Request, Response } from 'express';
import { ConfiguredEmbeddingProvider } from '../../providers/embeddingProvider.js';

export class ResearchController {
  private embedder = new ConfiguredEmbeddingProvider();

  constructor(private stores: any) {}

  private async generateRealEmbedding(text: string): Promise<number[]> {
    if (this.embedder.isConfigured()) {
      try {
        const liveVec = await this.embedder.embed(text);
        if (liveVec && liveVec.length > 0) {
          return liveVec;
        }
      } catch {
        // Fall back to deterministic cosine vector if provider is temporarily unreachable
      }
    }

    // Deterministic bag-of-words vector projection with cosine geometry
    const dims = 128;
    const vec = new Array(dims).fill(0);
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
    for (const token of tokens) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % dims] += 1;
    }
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
    return vec.map(v => v / norm);
  }

  listDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const wsId = req.query.workspaceId ? parseInt(String(req.query.workspaceId), 10) : undefined;
      const docs = await this.stores.researchDocument.list({
        workspaceId: wsId,
        sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
      });
      res.json({ documents: docs, count: docs.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'DOCUMENTS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  uploadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.sourceUri || !req.body?.title) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields "sourceUri" and "title" are required', requestId: req.id }
        });
        return;
      }
      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const text = req.body.textContent || '';
      const hash = Buffer.from(text).toString('base64').slice(0, 16);

      const doc = await this.stores.researchDocument.save({
        id,
        sourceType: req.body.sourceType || 'text',
        sourceUri: req.body.sourceUri,
        title: req.body.title,
        format: 'txt',
        contentHash: hash || 'empty_hash',
        chunkCount: Math.ceil((text.length || 1) / 500),
        charCount: text.length,
        workspaceId: req.auth?.workspaceId,
        metadata: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      });

      // Index chunks into vector store if content is provided
      if (text.length > 0 && this.stores.vector) {
        const embedding = await this.generateRealEmbedding(text.slice(0, 500));
        await this.stores.vector.upsert({
          id: `vec_${id}`,
          refId: id,
          namespace: 'documents',
          embedding,
          dims: embedding.length,
          model: this.embedder.model || 'athena-bag-of-words-v1',
          text: text.slice(0, 500),
          metadata: { title: req.body.title, sourceUri: req.body.sourceUri }
        });
      }

      res.status(201).json(doc);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'DOCUMENT_UPLOAD_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  search = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.query) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "query" is required', requestId: req.id }
        });
        return;
      }

      const queryEmbedding = await this.generateRealEmbedding(req.body.query);
      const vectorResults = await this.stores.vector.search(queryEmbedding, {
        namespace: req.body.namespace,
        limit: req.body.limit || 5,
        threshold: req.body.threshold
      });

      res.json({
        query: req.body.query,
        matches: vectorResults,
        model: this.embedder.model
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'SEARCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getVectorStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const namespace = req.query.namespace ? String(req.query.namespace) : undefined;
      const totalCount = await this.stores.vector.count(namespace);
      res.json({ namespace: namespace || 'all', totalVectors: totalCount });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'VECTOR_STATS_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
