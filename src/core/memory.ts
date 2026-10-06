import { Database } from 'sqlite';
import { openDatabase } from './database.js';
import { Message } from './types.js';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { RunState } from './runState.js';
import { AgentEvent } from './events.js';
import { MemoryScope, MemoryLifecycle, MemoryProvenance, ScopedMemoryItem, SkillRegistryEntry } from './memoryTypes.js';

export interface SemanticFact {
  id?: number;
  fact: string;
  tags?: string[];
  timestamp: number;
  score?: number;
}

export class EpisodicMemory {
  private db: Database | null = null;
  private dbPath: string;
  private ai: GoogleGenAI | null = null;
  private openAIClient: OpenAI | null = null;
  private apiKey?: string;
  private hasWarnedNoEmbeddingKey: boolean = false;

  constructor(dbPath: string, apiKey?: string) {
    this.dbPath = dbPath;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
  }

  getDb(): Database | null {
    return this.db;
  }

  private getAI(): GoogleGenAI {
    if (!this.ai) {
      const key = this.apiKey || process.env.GEMINI_API_KEY;
      if (!key) {
        throw new Error('GEMINI_API_KEY is not defined in the environment variables.');
      }
      this.ai = new GoogleGenAI({ apiKey: key });
    }
    return this.ai;
  }

  private async generateEmbedding(text: string): Promise<number[] | null> {
    const geminiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      const ai = this.getAI();
      const response = await ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
        contents: text
      });
      if (response.embeddings && response.embeddings[0]?.values) {
        return response.embeddings[0].values;
      }
      throw new Error('Gemini embedding values missing from response');
    }

    const openaiKey = process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY;
    if (openaiKey) {
      if (!this.openAIClient) {
        const baseURL = process.env.OPENAI_BASE_URL || (process.env.NVIDIA_API_KEY && !process.env.OPENAI_API_KEY ? (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1') : undefined);
        this.openAIClient = new OpenAI({ apiKey: openaiKey, baseURL });
      }
      const model = process.env.EMBEDDING_MODEL || (process.env.OPENAI_API_KEY ? 'text-embedding-3-small' : 'nvidia/nv-embedqa-e5-v5');
      const response = await this.openAIClient.embeddings.create({
        model,
        input: text
      });
      if (response.data && response.data[0]?.embedding) {
        return response.data[0].embedding;
      }
      throw new Error('OpenAI embedding values missing from response');
    }

    return null;
  }

  async init(): Promise<void> {
    if (this.db) return;

    // V2: shared database layer opens the connection (absolute path),
    // enables foreign keys, and runs all versioned schema migrations
    // (see src/core/migrations/index.ts). The V1 baseline DDL that used
    // to live here is now migration "v1_baseline".
    this.db = await openDatabase(this.dbPath);
  }

  async saveMessage(sessionId: string, role: 'user' | 'model', parts: any[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    await this.db.run(
      `INSERT INTO episodic_memory (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)`,
      sessionId,
      role,
      JSON.stringify(parts),
      Date.now()
    );
  }

  async loadHistory(
    sessionId: string,
    limit: number = 40,
    options?: { includeTimestamps?: boolean }
  ): Promise<Message[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const rows = await this.db.all(
      `SELECT role, content, timestamp FROM episodic_memory 
       WHERE session_id = ? 
       ORDER BY timestamp DESC, id DESC 
       LIMIT ?`,
      sessionId,
      limit
    );

    // Rows are retrieved newest first, reverse them to restore chronological order
    return rows.reverse().map((row: any) => rowToMessage(row, options?.includeTimestamps === true));
  }

  async getMessagesInRange(
    startMs: number,
    endMs: number,
    limit: number = 40
  ): Promise<{ sessionId: string; role: 'user' | 'model'; parts: any[]; timestamp: number }[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const rows = await this.db.all(
      `SELECT session_id as sessionId, role, content, timestamp FROM episodic_memory
       WHERE timestamp >= ? AND timestamp < ?
       ORDER BY timestamp ASC, id ASC
       LIMIT ?`,
      startMs,
      endMs,
      limit
    );

    return rows.map((row: any) => ({
      sessionId: row.sessionId as string,
      role: row.role as 'user' | 'model',
      parts: JSON.parse(row.content),
      timestamp: row.timestamp as number
    }));
  }

  async clearHistory(sessionId: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    await this.db.run(`DELETE FROM episodic_memory WHERE session_id = ?`, sessionId);
  }

  async getSessionsList(): Promise<{ sessionId: string; messageCount: number; lastActive: number }[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return this.db.all(`
      SELECT session_id as sessionId, count(*) as messageCount, max(timestamp) as lastActive
      FROM episodic_memory
      GROUP BY session_id
      ORDER BY lastActive DESC
    `);
  }

  async renameSession(oldSessionId: string, newSessionId: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    await this.db.run(
      `UPDATE episodic_memory SET session_id = ? WHERE session_id = ?`,
      newSessionId,
      oldSessionId
    );

    await this.db.run(
      `UPDATE scheduled_jobs SET session_id = ? WHERE session_id = ?`,
      newSessionId,
      oldSessionId
    );
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  // Exposed for indexing or search capability
  async search(query: string): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    try {
      return await this.db.all(
        `SELECT rowid as id, session_id, role, content FROM episodic_fts 
         WHERE episodic_fts MATCH ?
         LIMIT 20`,
        ftsQuery
      );
    } catch {
      return [];
    }
  }

  // --- Semantic Memory Methods (RAG) ---

  async saveSemanticFact(fact: string, tags?: string[]): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    let embedding: number[] | null = null;
    try {
      embedding = await this.generateEmbedding(fact);
    } catch (err: any) {
      throw new Error(`Failed to generate embedding for fact: ${err.message}`);
    }

    if (!embedding) {
      throw new Error('No embedding API key configured (set GEMINI_API_KEY, OPENAI_API_KEY, or NVIDIA_API_KEY).');
    }

    const tagsStr = tags && tags.length > 0 ? tags.join(',') : null;
    const now = Date.now();
    const result = await this.db.run(
      `INSERT INTO semantic_memory (fact, embedding, tags, timestamp) VALUES (?, ?, ?, ?)`,
      fact,
      JSON.stringify(embedding),
      tagsStr,
      now
    );

    // Also mirror to scoped_memory for Phase 2 ContextEngine
    try {
      await this.db.run(
        `INSERT INTO scoped_memory (
          scope, fact, tags, confidence, lifecycle, source, timestamp, created_at, updated_at, embedding
        ) VALUES ('user', ?, ?, 0.95, 'active', 'user', ?, ?, ?, ?)`,
        fact,
        tagsStr,
        now,
        now,
        now,
        JSON.stringify(embedding)
      );
    } catch (e) {
      // Ignore if table does not exist yet
    }

    return result.lastID!;
  }

  async searchSemanticFacts(query: string, limit: number = 3, threshold: number = 0.65): Promise<SemanticFact[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.generateEmbedding(query);
    } catch (err: any) {
      console.warn(`[Semantic Memory Warning] Embedding generation failed: ${err.message}`);
      return [];
    }

    if (!queryEmbedding) {
      if (!this.hasWarnedNoEmbeddingKey) {
        console.warn('[Semantic Memory] No embedding provider configured. Semantic search disabled.');
        this.hasWarnedNoEmbeddingKey = true;
      }
      return [];
    }

    // Retrieve all facts from database
    const rows = await this.db.all(`SELECT id, fact, embedding, tags, timestamp FROM semantic_memory`);
    const results: SemanticFact[] = [];

    for (const row of rows) {
      const dbEmbedding = JSON.parse(row.embedding) as number[];
      const score = cosineSimilarity(queryEmbedding, dbEmbedding);
      if (score >= threshold) {
        results.push({
          id: row.id,
          fact: row.fact,
          tags: row.tags ? row.tags.split(',') : [],
          timestamp: row.timestamp,
          score
        });
      }
    }

    // Sort by score descending and return limit
    return results.sort((a, b) => b.score! - a.score!).slice(0, limit);
  }

  async deleteSemanticFact(id: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(`DELETE FROM semantic_memory WHERE id = ?`, id);
  }

  // --- Consolidation helpers ---

  async getUnconsolidatedCount(): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const row = await this.db.get(`SELECT COUNT(*) as count FROM episodic_memory WHERE consolidated = 0`);
    return row?.count || 0;
  }

  async getUnconsolidatedMessages(limit: number = 20): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db.all(
      `SELECT id, session_id, role, content, timestamp FROM episodic_memory 
       WHERE consolidated = 0 
       ORDER BY timestamp ASC, id ASC 
       LIMIT ?`,
      limit
    );
  }

  async markAsConsolidated(ids: number[]): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.db.run(
      `UPDATE episodic_memory SET consolidated = 1 WHERE id IN (${placeholders})`,
      ...ids
    );
  }

  // --- Scheduled Jobs helpers ---

  async saveScheduledJob(job: {
    id: string;
    prompt: string;
    schedule: string;
    sessionId: string;
    lastRun: number | null;
    nextRun: number;
    active: number;
    timezone?: string;
    lockedBy?: string | null;
    lockedAt?: number | null;
    leaseTimeoutMs?: number;
    priority?: string;
  }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `INSERT OR REPLACE INTO scheduled_jobs (id, prompt, schedule, session_id, last_run, next_run, active, timezone, locked_by, locked_at, lease_timeout_ms, priority)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      job.id,
      job.prompt,
      job.schedule,
      job.sessionId,
      job.lastRun,
      job.nextRun,
      job.active,
      job.timezone || 'UTC',
      job.lockedBy || null,
      job.lockedAt || null,
      job.leaseTimeoutMs ?? 60000,
      job.priority || 'normal'
    );
  }

  async getScheduledJobs(): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db.all(`SELECT id, prompt, schedule, session_id as sessionId, last_run as lastRun, next_run as nextRun, active, timezone, locked_by as lockedBy, locked_at as lockedAt, lease_timeout_ms as leaseTimeoutMs, priority FROM scheduled_jobs`);
  }

  async deleteScheduledJob(id: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(`DELETE FROM scheduled_jobs WHERE id = ?`, id);
  }

  async updateScheduledJobRun(id: string, lastRun: number | null, nextRun: number): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `UPDATE scheduled_jobs SET last_run = ?, next_run = ? WHERE id = ?`,
      lastRun,
      nextRun,
      id
    );
  }

  // --- Job Leases / Distributed Locks (Phase 6) ---

  async acquireJobLease(jobId: string, workerId: string, leaseTimeoutMs: number = 60000): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const now = Date.now();
    const result = await this.db.run(
      `UPDATE scheduled_jobs
       SET locked_by = ?, locked_at = ?, lease_timeout_ms = ?
       WHERE id = ? AND (
         locked_by IS NULL 
         OR locked_at IS NULL 
         OR (locked_at + COALESCE(lease_timeout_ms, 60000)) < ?
         OR locked_by = ?
       )`,
      workerId,
      now,
      leaseTimeoutMs,
      jobId,
      now,
      workerId
    );
    return (result.changes ?? 0) > 0;
  }

  async renewJobLease(jobId: string, workerId: string, leaseTimeoutMs: number = 60000): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const now = Date.now();
    const result = await this.db.run(
      `UPDATE scheduled_jobs
       SET locked_at = ?, lease_timeout_ms = ?
       WHERE id = ? AND locked_by = ?`,
      now,
      leaseTimeoutMs,
      jobId,
      workerId
    );
    return (result.changes ?? 0) > 0;
  }

  async releaseJobLease(jobId: string, workerId: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `UPDATE scheduled_jobs
       SET locked_by = NULL, locked_at = NULL
       WHERE id = ? AND locked_by = ?`,
      jobId,
      workerId
    );
  }

  // --- Event Log & Deduplication (Phase 6) ---

  async recordEventLog(event: {
    id: string;
    topic: string;
    idempotencyKey?: string;
    payload?: string;
    status?: string;
    source?: string;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.run(
      `INSERT OR REPLACE INTO event_log (id, topic, idempotency_key, payload, status, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.topic,
      event.idempotencyKey || null,
      event.payload || null,
      event.status || 'processed',
      event.source || 'system',
      Date.now()
    );
  }

  async getEventByIdempotencyKey(key: string, windowMs?: number): Promise<any | null> {
    if (!this.db) return null;
    if (windowMs) {
      const minTimestamp = Date.now() - windowMs;
      return this.db.get(
        `SELECT * FROM event_log WHERE idempotency_key = ? AND created_at >= ? LIMIT 1`,
        key,
        minTimestamp
      );
    }
    return this.db.get(
      `SELECT * FROM event_log WHERE idempotency_key = ? LIMIT 1`,
      key
    );
  }

  // --- RunState Persistence (Phase 1) ---

  async saveRunState(state: RunState): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `INSERT OR REPLACE INTO runs (
        run_id, parent_run_id, root_run_id, session_id, task, status,
        current_turn, budget, usage, idempotency_keys, termination_reason,
        error, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      state.runId,
      state.parentRunId || null,
      state.rootRunId,
      state.sessionId,
      state.task,
      state.status,
      state.currentTurn,
      JSON.stringify(state.budget),
      JSON.stringify(state.usage),
      JSON.stringify(state.idempotencyKeys),
      state.terminationReason || null,
      state.error ? JSON.stringify(state.error) : null,
      state.result || null,
      state.createdAt,
      state.updatedAt
    );
  }

  async getRunState(runId: string): Promise<RunState | null> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const row = await this.db.get(`SELECT * FROM runs WHERE run_id = ?`, runId);
    if (!row) return null;

    return {
      runId: row.run_id,
      parentRunId: row.parent_run_id || undefined,
      rootRunId: row.root_run_id,
      sessionId: row.session_id,
      task: row.task,
      status: row.status,
      currentTurn: row.current_turn,
      budget: row.budget ? JSON.parse(row.budget) : {},
      usage: row.usage ? JSON.parse(row.usage) : { elapsedTimeMs: 0, tokens: { input: 0, output: 0, total: 0 }, costUsd: 0, toolCallsCount: 0, turnsCount: 0 },
      idempotencyKeys: row.idempotency_keys ? JSON.parse(row.idempotency_keys) : [],
      terminationReason: row.termination_reason || undefined,
      error: row.error ? JSON.parse(row.error) : undefined,
      result: row.result || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateRunState(runId: string, updates: Partial<RunState>): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const existing = await this.getRunState(runId);
    if (!existing) {
      throw new Error(`Cannot update non-existent run "${runId}"`);
    }

    const merged: RunState = {
      ...existing,
      ...updates,
      updatedAt: Date.now()
    };
    await this.saveRunState(merged);
  }

  async saveRunEvent(event: AgentEvent): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `INSERT INTO run_events (run_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)`,
      event.runId,
      event.type,
      JSON.stringify(event),
      event.timestamp
    );
  }

  async getRunEvents(runId: string): Promise<AgentEvent[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const rows = await this.db.all(
      `SELECT payload FROM run_events WHERE run_id = ? ORDER BY id ASC`,
      runId
    );
    return rows.map((r: any) => JSON.parse(r.payload));
  }

  async listRuns(sessionId?: string, limit: number = 50): Promise<RunState[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    let query = `SELECT * FROM runs`;
    const params: any[] = [];
    if (sessionId) {
      query += ` WHERE session_id = ?`;
      params.push(sessionId);
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(query, ...params);
    return rows.map((row: any) => ({
      runId: row.run_id,
      parentRunId: row.parent_run_id || undefined,
      rootRunId: row.root_run_id,
      sessionId: row.session_id,
      task: row.task,
      status: row.status,
      currentTurn: row.current_turn,
      budget: row.budget ? JSON.parse(row.budget) : {},
      usage: row.usage ? JSON.parse(row.usage) : { elapsedTimeMs: 0, tokens: { input: 0, output: 0, total: 0 }, costUsd: 0, toolCallsCount: 0, turnsCount: 0 },
      idempotencyKeys: row.idempotency_keys ? JSON.parse(row.idempotency_keys) : [],
      terminationReason: row.termination_reason || undefined,
      error: row.error ? JSON.parse(row.error) : undefined,
      result: row.result || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  // --- Phase 2: Scoped Memory Methods ---

  async saveScopedMemory(params: {
    scope: MemoryScope;
    fact: string;
    tags?: string[];
    confidence?: number;
    provenance: MemoryProvenance;
    embedding?: number[];
  }): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    let embedding = params.embedding || null;
    if (!embedding) {
      try {
        embedding = await this.generateEmbedding(params.fact);
      } catch (err: any) {
        // Soft fallback if embedding API key is absent in local unit test
      }
    }

    const now = Date.now();
    const tagsStr = params.tags && params.tags.length > 0 ? params.tags.join(',') : null;
    const confidence = params.confidence !== undefined ? Math.max(0.0, Math.min(1.0, params.confidence)) : 1.0;

    const result = await this.db.run(
      `INSERT INTO scoped_memory (
        scope, fact, tags, confidence, lifecycle, source, timestamp,
        run_id, session_id, evidence, embedding, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
      params.scope,
      params.fact,
      tagsStr,
      confidence,
      params.provenance.source,
      params.provenance.timestamp || now,
      params.provenance.runId || null,
      params.provenance.sessionId || null,
      params.provenance.evidence || null,
      embedding ? JSON.stringify(embedding) : null,
      now,
      now
    );

    return result.lastID!;
  }

  async searchScopedMemory(params: {
    query: string;
    scope?: MemoryScope | MemoryScope[];
    limit?: number;
    threshold?: number;
    minConfidence?: number;
    lifecycles?: MemoryLifecycle[];
    sessionId?: string;
  }): Promise<ScopedMemoryItem[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const lifecycles = params.lifecycles || ['active', 'confirmed'];
    const minConfidence = params.minConfidence ?? 0.0;
    const limit = params.limit ?? 5;
    const threshold = params.threshold ?? 0.50;

    let querySql = `SELECT * FROM scoped_memory WHERE confidence >= ?`;
    const sqlParams: any[] = [minConfidence];

    // Filter by lifecycles
    const lifecyclePlaceholders = lifecycles.map(() => '?').join(',');
    querySql += ` AND lifecycle IN (${lifecyclePlaceholders})`;
    sqlParams.push(...lifecycles);

    // Filter by scope
    if (params.scope) {
      const scopes = Array.isArray(params.scope) ? params.scope : [params.scope];
      const scopePlaceholders = scopes.map(() => '?').join(',');
      querySql += ` AND scope IN (${scopePlaceholders})`;
      sqlParams.push(...scopes);
    }

    // Filter by session if task or session scoped
    if (params.sessionId) {
      querySql += ` AND (session_id IS NULL OR session_id = ?)`;
      sqlParams.push(params.sessionId);
    }

    const rows = await this.db.all(querySql, ...sqlParams);
    if (rows.length === 0) return [];

    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.generateEmbedding(params.query);
    } catch (e) {}

    const results: ScopedMemoryItem[] = [];
    const queryTokens = params.query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

    for (const row of rows) {
      let score = 0;
      if (queryEmbedding && row.embedding) {
        const dbEmb = JSON.parse(row.embedding) as number[];
        score = cosineSimilarity(queryEmbedding, dbEmb);
      } else {
        // Fallback token match
        const factLower = row.fact.toLowerCase();
        const matches = queryTokens.filter(t => factLower.includes(t));
        score = queryTokens.length > 0 ? (matches.length / queryTokens.length) * 0.8 : 0.5;
      }

      if (score >= threshold) {
        results.push({
          id: row.id,
          scope: row.scope as MemoryScope,
          fact: row.fact,
          tags: row.tags ? row.tags.split(',') : [],
          confidence: row.confidence,
          lifecycle: row.lifecycle as MemoryLifecycle,
          provenance: {
            source: row.source,
            timestamp: row.timestamp,
            runId: row.run_id || undefined,
            sessionId: row.session_id || undefined,
            evidence: row.evidence || undefined
          },
          supersededBy: row.superseded_by || undefined,
          score,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        });
      }
    }

    // Sort by confidence-weighted relevance: (score * confidence)
    return results.sort((a, b) => (b.score! * b.confidence) - (a.score! * a.confidence)).slice(0, limit);
  }

  async getScopedMemory(id: number): Promise<ScopedMemoryItem | null> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const row = await this.db.get(`SELECT * FROM scoped_memory WHERE id = ?`, id);
    if (!row) return null;
    return {
      id: row.id,
      scope: row.scope as MemoryScope,
      fact: row.fact,
      tags: row.tags ? row.tags.split(',') : [],
      confidence: row.confidence,
      lifecycle: row.lifecycle as MemoryLifecycle,
      provenance: {
        source: row.source,
        timestamp: row.timestamp,
        runId: row.run_id || undefined,
        sessionId: row.session_id || undefined,
        evidence: row.evidence || undefined
      },
      supersededBy: row.superseded_by || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async updateMemoryLifecycle(id: number, lifecycle: MemoryLifecycle, supersededBy?: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = ?, superseded_by = ?, updated_at = ? WHERE id = ?`,
      lifecycle,
      supersededBy || null,
      Date.now(),
      id
    );
  }

  async reinforceMemory(id: number, delta: number = 0.1): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const row = await this.db.get(`SELECT confidence FROM scoped_memory WHERE id = ?`, id);
    if (!row) return;
    const newConf = Math.min(1.0, row.confidence + delta);
    await this.db.run(
      `UPDATE scoped_memory SET confidence = ?, lifecycle = 'confirmed', updated_at = ? WHERE id = ?`,
      newConf,
      Date.now(),
      id
    );
  }

  async contradictMemory(id: number, evidence?: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = 'contradicted', confidence = MAX(0.0, confidence - 0.5), evidence = COALESCE(?, evidence), updated_at = ? WHERE id = ?`,
      evidence || null,
      Date.now(),
      id
    );
  }

  async resolveContradiction(existingId: number, newFact: string, provenance: MemoryProvenance): Promise<number> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const existing = await this.getScopedMemory(existingId);
    if (!existing) throw new Error(`Memory fact ${existingId} not found.`);

    // 1. Save new fact
    const newId = await this.saveScopedMemory({
      scope: existing.scope,
      fact: newFact,
      tags: existing.tags,
      confidence: 1.0,
      provenance
    });

    // 2. Mark older fact as superseded
    await this.updateMemoryLifecycle(existingId, 'superseded', newId);
    return newId;
  }

  async deleteScopedMemory(id: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    await this.db.run(`UPDATE scoped_memory SET lifecycle = 'deleted', updated_at = ? WHERE id = ?`, Date.now(), id);
  }

  async purgeScope(scope: MemoryScope, sessionId?: string): Promise<number> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    let query = `DELETE FROM scoped_memory WHERE scope = ?`;
    const params: any[] = [scope];
    if (sessionId) {
      query += ` AND session_id = ?`;
      params.push(sessionId);
    }
    const result = await this.db.run(query, ...params);
    return result.changes || 0;
  }

  async inspectMemory(query?: string, scope?: MemoryScope, limit: number = 30): Promise<ScopedMemoryItem[]> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    let sql = `SELECT * FROM scoped_memory WHERE lifecycle != 'deleted'`;
    const params: any[] = [];
    if (scope) {
      sql += ` AND scope = ?`;
      params.push(scope);
    }
    if (query) {
      sql += ` AND fact LIKE ?`;
      params.push(`%${query}%`);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, ...params);
    return rows.map((row: any) => ({
      id: row.id,
      scope: row.scope as MemoryScope,
      fact: row.fact,
      tags: row.tags ? row.tags.split(',') : [],
      confidence: row.confidence,
      lifecycle: row.lifecycle as MemoryLifecycle,
      provenance: {
        source: row.source,
        timestamp: row.timestamp,
        runId: row.run_id || undefined,
        sessionId: row.session_id || undefined,
        evidence: row.evidence || undefined
      },
      supersededBy: row.superseded_by || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  // --- Phase 2: Skill Registry Tracking Methods ---

  async registerSkillMetadata(skill: {
    name: string;
    version?: string;
    description?: string;
    tags?: string[];
    dependencies?: string[];
  }): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO skill_registry (
        name, version, description, tags, dependencies, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM skill_registry WHERE name = ?), ?), ?)`,
      skill.name,
      skill.version || '1.0.0',
      skill.description || '',
      skill.tags ? skill.tags.join(',') : '',
      skill.dependencies ? JSON.stringify(skill.dependencies) : '[]',
      skill.name,
      now,
      now
    );
  }

  async recordSkillInvocation(name: string, success: boolean): Promise<void> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const now = Date.now();
    await this.db.run(
      `UPDATE skill_registry SET
        invocations = invocations + 1,
        successes = successes + ?,
        failures = failures + ?,
        last_invoked = ?,
        updated_at = ?
      WHERE name = ?`,
      success ? 1 : 0,
      success ? 0 : 1,
      now,
      now,
      name
    );
  }

  async getSkillRegistry(): Promise<SkillRegistryEntry[]> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const rows = await this.db.all(`SELECT * FROM skill_registry ORDER BY invocations DESC`);
    return rows.map((r: any) => ({
      name: r.name,
      version: r.version,
      description: r.description,
      tags: r.tags ? r.tags.split(',') : [],
      dependencies: r.dependencies ? JSON.parse(r.dependencies) : [],
      invocations: r.invocations,
      successes: r.successes,
      failures: r.failures,
      successRate: r.invocations > 0 ? r.successes / r.invocations : 1.0,
      lastInvoked: r.last_invoked || undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }));
  }

  async getSkillEntry(name: string): Promise<SkillRegistryEntry | null> {
    if (!this.db) throw new Error('Database not initialized. Call init() first.');
    const row = await this.db.get(`SELECT * FROM skill_registry WHERE name = ?`, name);
    if (!row) return null;
    return {
      name: row.name,
      version: row.version,
      description: row.description,
      tags: row.tags ? row.tags.split(',') : [],
      dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
      invocations: row.invocations,
      successes: row.successes,
      failures: row.failures,
      successRate: row.invocations > 0 ? row.successes / row.invocations : 1.0,
      lastInvoked: row.last_invoked || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

function rowToMessage(row: { role: string; content: string; timestamp?: number }, includeTimestamps: boolean): Message {
  const parts = JSON.parse(row.content);
  if (includeTimestamps && row.timestamp && Array.isArray(parts)) {
    const stamp = new Date(row.timestamp).toISOString();
    const firstText = parts.find((p: any) => p && typeof p.text === 'string');
    if (firstText) {
      firstText.text = `[${stamp}] ${firstText.text}`;
    }
  }
  return {
    role: row.role as 'user' | 'model',
    parts
  };
}

const FTS_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'what', 'did', 'does',
  'was', 'were', 'have', 'has', 'had', 'this', 'that', 'with', 'from', 'they',
  'how', 'when', 'where', 'who', 'why', 'our', 'yesterday', 'today', 'previous',
  'session', 'sessions', 'last', 'time', 'remember', 'about', 'just', 'been'
]);

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .replace(/['"*():^]+/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !FTS_STOPWORDS.has(t));
  if (tokens.length === 0) {
    return null;
  }
  return [...new Set(tokens)].slice(0, 8).join(' OR ');
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

