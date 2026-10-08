/**
 * P4B shared research/RAG types.
 *
 * Spec sections 23 (web research), 24 (RAG), 25 (documents). The central
 * honesty rule: every synthesized statement carries an explicit epistemic
 * label — `source` (directly stated by a cited source), `inference`
 * (cross-source reasoning performed by the pipeline), or `uncertainty`
 * (conflicting or single-source claims that could not be corroborated).
 */

export type StatementLabel = 'source' | 'inference' | 'uncertainty';

/** A citation target inside a research report. */
export interface SourceRecord {
  index: number;
  title: string;
  url: string;
  retrievedAt: number;
  /** Raw character count of the retrieved page. */
  contentChars: number;
}

/** One labeled statement in a synthesized research report. */
export interface ResearchFinding {
  statement: string;
  label: StatementLabel;
  /** 1-based source indexes backing the statement. */
  citations: number[];
  /** [0,1] — corroboration-derived confidence. */
  confidence: number;
}

export interface ResearchReport {
  query: string;
  sources: SourceRecord[];
  findings: ResearchFinding[];
  /** True when at least one finding is backed by 2+ independent sources. */
  crossChecked: boolean;
  generatedAt: number;
  /** Pipeline stages that actually ran (honest execution trace). */
  stages: string[];
  /** Non-fatal notes (e.g. sources that failed to fetch). */
  notes: string[];
}

/** Parsed document representation before chunking. */
export interface ParsedDocument {
  format: DocumentFormat;
  text: string;
  pageCount?: number;
  sheets?: string[];
  rows?: number;
  /** Populated by OCR; experimental capability. */
  ocr?: boolean;
  metadata?: Record<string, any>;
}

export type DocumentFormat =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'html'
  | 'markdown'
  | 'text'
  | 'image';

/** A text chunk produced by the chunker. */
export interface Chunk {
  index: number;
  text: string;
  /** Heading/section context when available. */
  section?: string;
  charStart: number;
  charEnd: number;
}

export interface IngestResult {
  documentId: string;
  sourceType: 'file' | 'url' | 'text';
  sourceUri: string;
  format: DocumentFormat;
  chunkCount: number;
  charCount: number;
  pageCount?: number;
  /** True when the document was already ingested with identical content. */
  deduplicated: boolean;
}

export interface RagQueryResult {
  query: string;
  results: {
    id: string;
    documentId?: string;
    text: string;
    /** Bi-encoder cosine similarity from vector retrieval. */
    retrievalScore: number;
    /** Cross-encoder relevance when the reranker ran; null otherwise. */
    rerankScore?: number;
    rank: number;
    sourceUri?: string;
  }[];
  reranked: boolean;
  rerankerModel?: string;
  /** Populated when reranking was skipped — honest unsupported state. */
  rerankSkippedReason?: string;
}
