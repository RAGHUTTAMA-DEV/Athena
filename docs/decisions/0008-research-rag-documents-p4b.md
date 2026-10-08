# ADR-0008: Web Research, RAG, and Document Intelligence (P4B)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P4B (Web Research, RAG, Documents — spec sections 23, 24, 25, 54)

## Context

Athena V1 could search the web (`searchWeb`, DuckDuckGo/Yahoo scraping) and fetch pages (`browseUrl`), but had no document parsing (readFile/grep refused PDF/DOCX/XLSX/images), no vector store, no chunking, no reranker, and no research pipeline that separates what sources *state* from what the agent *infers*. The build plan imposes one hard rule: **the reranker must be a real cross-encoder scoring `(query, passage)` pairs — never token-overlap/TF-IDF/cosine — and if no reranker backend is available the capability is `unsupported`, not faked.**

## Decision

1. **Migration 5 `v2_p4b_research_rag_documents`** (`src/storage/migrations/index.ts`):
   - `vector_embeddings` — id, namespace, ref_id (owning document), text, embedding (JSON array, V1 representation), dims, model, metadata.
   - `research_documents` — id, source_type (file/url/text), source_uri, title, format, content_hash (dedupe), chunk_count, char_count, workspace_id, metadata.

2. **`VectorStore` interface + `SqliteVectorStore`** (`src/storage/stores/types.ts`, `sqlite/sqliteVectorStore.ts`): upsert/get/delete/deleteByRef/deleteByNamespace/search/count with cosine scoring and namespace/ref/threshold filters. Follows ADR-0001: the pgvector adapter lands in P12 behind the same interface; callers never change.

3. **`EmbeddingProvider` extraction** (`src/providers/embeddingProvider.ts`): the V1 Gemini → OpenAI-compatible (optionally NVIDIA) fallback chain moved verbatim out of `EpisodicMemory.generateEmbedding`, which now delegates. Behavior is identical; RAG reuses the same backend.

4. **Real local cross-encoder reranker** (`src/providers/localReranker.ts`): `LocalCrossEncoderReranker` runs `Xenova/ms-marco-MiniLM-L-6-v2` (ONNX) in-process via `@huggingface/transformers`; model id overridable with `RERANKER_MODEL`. The evaluator (TEST 6) pins a fixed dataset where the lexical TF baseline ranks a keyword-stuffed distractor above the answering passage, and verifies the cross-encoder ranks the answering passage first (gain: gold rank 2 → 1). **When the model cannot load, `load()` marks `rag.rerank` `unsupported` with a reason, `rerank()` returns `null`, and the RAG pipeline skips the stage and reports `reranked: false` + skip reason — retrieval-only ordering is never relabeled as reranking.**

5. **Capability registry (first in the codebase)** (`src/tools/capabilityRegistry.ts`): `real | experimental | unsupported` (+ reason) per spec section 71. Seeded at `EpisodicMemory.init()` with 11 P4B capabilities; OCR is `experimental`, `rag.rerank` reflects true backend state.

6. **Document intelligence** (`src/research/documentParser.ts`): real extractors — PDF (pdf-parse v2/pdf.js), DOCX (mammoth), XLSX (sheetjs, per-sheet CSV rendering), CSV (papaparse), HTML (script/style-stripping), Markdown/text. Images/scanned docs go through tesseract.js OCR, registered `experimental`. No format is silently approximated; unparseable input throws instead of returning fabricated text.

7. **Structure-aware chunker** (`src/research/chunker.ts`): heading → paragraph → sentence boundaries, overlap, coverage guarantee. Large documents are reduced to chunks here and never enter context wholesale (spec section 25).

8. **RAG pipeline** (`src/research/ragPipeline.ts`): ingest (parse → chunk → embed → store, SHA-256 dedupe, changed-source replacement) → retrieve (vector search, top-K×4 candidates) → rerank (cross-encoder, capability-gated) → cited results with `retrievalScore` + `rerankScore`. Missing embedding provider ⇒ capability `unsupported` + typed error (ingest/query fail loudly rather than degrade silently).

9. **Research pipeline** (`src/research/researchPipeline.ts`): search → retrieve → extract → reason → cross-check → synthesize → cite. Every finding is labeled `source` (extractive, cited), `inference` (pipeline-derived cross-source statement), or `uncertainty` (single-source or conflicting values), with 1-based citations and confidence. All retrieved content passes `PromptDefense.analyzeAndSanitize` before extraction; neutralized injections are reported in `notes` and can never appear as finding content. Search/fetch functions are injectable (tests supply fixtures; production defaults to the V1 `searchWeb` tool + bounded fetch).

10. **Tools** (`researchWeb`, `ingestDocument`, `searchDocuments`, `readDocument`): registered through the P4A registry with manifests (`net:http`/`fs:read`/`memory` permissions, risk `safe`), discovery capability keywords extended with `research`. `readDocument` enforces the context budget: small docs return full text, large docs return a bounded excerpt + RAG-retrieved chunks for a focus query. Engines are exposed through the `EpisodicMemory` facade (`getVectorStore/getRagEngine/getResearchEngine`) — the established ADR-0001 pattern.

## Consequences

- **No fakes**: the reranker is a genuine cross-encoder with measured gain; unsupported states are typed, surfaced, and skipped — never backfilled with a heuristic.
- **Honest capabilities**: `CapabilityRegistry` is the first formal instance of the spec-71 convention; P4D's per-OS status will extend it.
- **Local-first**: the cross-encoder and OCR run in-process; only embeddings need an API key, and their absence is an explicit `unsupported`, not silent lexical search.
- **P12 seam**: `VectorStore` and `ResearchDocumentStore` are interfaces with SQLite implementations; pgvector and PostgreSQL full-text arrive as adapters.
- **Dependencies added**: `@huggingface/transformers`, `pdf-parse`, `mammoth`, `xlsx`, `papaparse`, `tesseract.js`, `jszip` (test fixture builder).
- **Zero regressions**: P4B suite 9/9; full V2 (P1 9/9, P2 11/11, P3 9/9, P4A 6/6) and V1 suites green; adversarial eval 10/12 (improved from recorded 8/12).
