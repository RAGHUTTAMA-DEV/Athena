import { Request, Response } from 'express';
import { ConfiguredEmbeddingProvider } from '../../providers/embeddingProvider.js';
import { AttachmentService } from '../services/attachmentService.js';

export class ResearchController {
  private embedder = new ConfiguredEmbeddingProvider();
  private attachmentService: AttachmentService;

  constructor(private stores: any) {
    this.attachmentService = new AttachmentService(stores);
  }

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
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
    for (const token of tokens) {
      let h = 2166136261;
      for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      vec[Math.abs(h) % dims] += 1;
    }
    const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  listDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const wsId = req.query.workspaceId ? parseInt(String(req.query.workspaceId), 10) : undefined;
      const sessionIdFilter = req.query.sessionId ? String(req.query.sessionId) : undefined;
      let docs = await this.stores.researchDocument.list({
        workspaceId: wsId,
        sourceType: req.query.sourceType ? String(req.query.sourceType) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
      });
      if (sessionIdFilter) {
        docs = docs.filter(
          (d: any) =>
            d.metadata?.sessionId === sessionIdFilter ||
            (Array.isArray(d.metadata?.sessionIds) && d.metadata.sessionIds.includes(sessionIdFilter))
        );
      }
      res.json({ documents: docs, count: docs.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'DOCUMENTS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  /**
   * Unified intelligent upload handler for both Knowledge Base documents and
   * binary file attachments (PDF, DOCX, XLSX, CSV, HTML, Markdown, Images).
   */
  uploadAttachment = async (req: Request, res: Response): Promise<void> => {
    try {
      const fileName = req.body?.name || req.body?.fileName || req.body?.title;
      const contentBase64 = req.body?.contentBase64;
      const textContent = req.body?.textContent ?? req.body?.content;

      if (!fileName || (!contentBase64 && typeof textContent !== 'string')) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Fields "name" (or "title") and "contentBase64" or "textContent" are required.',
            requestId: req.id
          }
        });
        return;
      }

      const result = await this.attachmentService.ingestUpload({
        fileName: String(fileName),
        mimeType: req.body?.mimeType ? String(req.body.mimeType) : undefined,
        contentBase64: contentBase64 ? String(contentBase64) : undefined,
        textContent: typeof textContent === 'string' ? textContent : undefined,
        sessionId: req.body?.sessionId ? String(req.body.sessionId) : undefined,
        workspaceId: req.auth?.workspaceId,
        sourceUri: req.body?.sourceUri ? String(req.body.sourceUri) : undefined,
        sourceType: req.body?.sourceType,
        namespace: req.body?.namespace ? String(req.body.namespace) : undefined
      });

      res.status(201).json(result);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'ATTACHMENT_UPLOAD_FAILED', message: err.message, requestId: req.id }
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

      const result = await this.attachmentService.ingestUpload({
        fileName: String(req.body.title),
        mimeType: req.body.mimeType ? String(req.body.mimeType) : undefined,
        contentBase64: req.body.contentBase64 ? String(req.body.contentBase64) : undefined,
        textContent: typeof req.body.textContent === 'string' ? req.body.textContent : '',
        workspaceId: req.auth?.workspaceId,
        sourceUri: String(req.body.sourceUri),
        sourceType: req.body.sourceType || 'text',
        namespace: req.body.namespace ? String(req.body.namespace) : undefined
      });

      const doc = result.documentId ? await this.stores.researchDocument.get(result.documentId) : null;
      res.status(201).json(doc || result);
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
      const docIds: string[] | undefined = Array.isArray(req.body.documentIds)
        ? req.body.documentIds.map(String)
        : undefined;
      const limit = req.body.limit || 5;

      let vectorResults = await this.stores.vector.search(queryEmbedding, {
        namespace: req.body.namespace,
        limit: docIds && docIds.length > 0 ? Math.max(limit * 5, 30) : limit,
        threshold: req.body.threshold
      });

      if (docIds && docIds.length > 0) {
        const allow = new Set(docIds);
        vectorResults = vectorResults.filter((r: any) => r.refId && allow.has(r.refId)).slice(0, limit);
      }

      res.json({
        query: req.body.query,
        results: vectorResults,
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
