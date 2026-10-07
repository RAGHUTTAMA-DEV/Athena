import { Database } from 'sqlite';
import { MemoryStore } from '../types.js';
import {
  ScopedMemoryItem,
  MemoryScope,
  MemoryLifecycle,
  MemoryType
} from '../../../memory/memoryTypes.js';

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

export class SqliteMemoryStore implements MemoryStore {
  constructor(private db: Database) {}

  async save(item: Omit<ScopedMemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const now = Date.now();
    const tagsStr = item.tags && item.tags.length > 0 ? item.tags.join(',') : null;
    const confidence = item.confidence !== undefined ? Math.max(0.0, Math.min(1.0, item.confidence)) : 1.0;
    const embeddingStr = item.embedding ? JSON.stringify(item.embedding) : null;
    const memoryType = item.type || 'fact';
    const securityStatus = item.securityStatus || 'clean';

    const result = await this.db.run(
      `INSERT INTO scoped_memory (
        scope, fact, tags, confidence, lifecycle, source, timestamp,
        run_id, session_id, evidence, embedding, created_at, updated_at,
        workspace_id, project_id, agent_id, memory_type, goal_id,
        security_status, quarantine_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      item.scope,
      item.fact,
      tagsStr,
      confidence,
      item.lifecycle,
      item.provenance.source,
      item.provenance.timestamp || now,
      item.provenance.runId || null,
      item.provenance.sessionId || null,
      item.provenance.evidence || null,
      embeddingStr,
      now,
      now,
      item.workspaceId ?? null,
      item.projectId ?? null,
      item.agentId ?? null,
      memoryType,
      item.goalId ?? null,
      securityStatus,
      item.quarantineReason || null
    );

    return result.lastID!;
  }

  async get(id: number): Promise<ScopedMemoryItem | null> {
    const row = await this.db.get(`SELECT * FROM scoped_memory WHERE id = ?`, id);
    if (!row) return null;
    return this.mapRow(row);
  }

  async updateLifecycle(id: number, lifecycle: MemoryLifecycle, supersededBy?: number): Promise<void> {
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = ?, superseded_by = ?, updated_at = ? WHERE id = ?`,
      lifecycle,
      supersededBy || null,
      Date.now(),
      id
    );
  }

  async validate(id: number, evidence?: string): Promise<void> {
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = 'active', evidence = COALESCE(?, evidence), updated_at = ? WHERE id = ?`,
      evidence || null,
      Date.now(),
      id
    );
  }

  async reinforce(id: number, delta: number = 0.1): Promise<void> {
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

  async contradict(id: number, evidence?: string): Promise<void> {
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = 'contradicted', confidence = MAX(0.0, confidence - 0.5), evidence = COALESCE(?, evidence), updated_at = ? WHERE id = ?`,
      evidence || null,
      Date.now(),
      id
    );
  }

  async quarantine(id: number, reason: string): Promise<void> {
    await this.db.run(
      `UPDATE scoped_memory SET lifecycle = 'quarantined', security_status = 'quarantined', quarantine_reason = ?, updated_at = ? WHERE id = ?`,
      reason,
      Date.now(),
      id
    );
  }

  async search(params: {
    query: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryType | MemoryType[];
    limit?: number;
    threshold?: number;
    minConfidence?: number;
    lifecycles?: MemoryLifecycle[];
    sessionId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
    goalId?: string;
    includeQuarantined?: boolean;
    queryEmbedding?: number[] | null;
  }): Promise<ScopedMemoryItem[]> {
    const lifecycles = params.lifecycles || ['active', 'confirmed'];
    const minConfidence = params.minConfidence ?? 0.0;
    const limit = params.limit ?? 5;
    const threshold = params.threshold ?? 0.40;

    let querySql = `SELECT * FROM scoped_memory WHERE confidence >= ?`;
    const sqlParams: any[] = [minConfidence];

    // Filter by lifecycles
    const lifecyclePlaceholders = lifecycles.map(() => '?').join(',');
    querySql += ` AND lifecycle IN (${lifecyclePlaceholders})`;
    sqlParams.push(...lifecycles);

    // Unless explicitly requested, NEVER return quarantined items
    if (!params.includeQuarantined) {
      querySql += ` AND security_status != 'quarantined' AND lifecycle != 'quarantined'`;
    }

    // Filter by scope
    if (params.scope) {
      const scopes = Array.isArray(params.scope) ? params.scope : [params.scope];
      const scopePlaceholders = scopes.map(() => '?').join(',');
      querySql += ` AND scope IN (${scopePlaceholders})`;
      sqlParams.push(...scopes);
    }

    // Filter by type
    if (params.type) {
      const types = Array.isArray(params.type) ? params.type : [params.type];
      const typePlaceholders = types.map(() => '?').join(',');
      querySql += ` AND memory_type IN (${typePlaceholders})`;
      sqlParams.push(...types);
    }

    // Filter by session if applicable
    if (params.sessionId) {
      querySql += ` AND (session_id IS NULL OR session_id = ?)`;
      sqlParams.push(params.sessionId);
    }

    // Bindings (NULL is cross-workspace / visible everywhere)
    if (params.workspaceId !== undefined) {
      querySql += ` AND (workspace_id IS NULL OR workspace_id = ?)`;
      sqlParams.push(params.workspaceId);
    }
    if (params.projectId !== undefined) {
      querySql += ` AND (project_id IS NULL OR project_id = ?)`;
      sqlParams.push(params.projectId);
    }
    if (params.agentId !== undefined) {
      querySql += ` AND (agent_id IS NULL OR agent_id = ?)`;
      sqlParams.push(params.agentId);
    }
    if (params.goalId !== undefined) {
      querySql += ` AND (goal_id IS NULL OR goal_id = ?)`;
      sqlParams.push(params.goalId);
    }

    const rows = await this.db.all(querySql, ...sqlParams);
    if (rows.length === 0) return [];

    const results: ScopedMemoryItem[] = [];
    const queryTokens = params.query.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);

    for (const row of rows) {
      let score = 0;
      if (params.queryEmbedding && row.embedding) {
        try {
          const dbEmb = JSON.parse(row.embedding) as number[];
          score = cosineSimilarity(params.queryEmbedding, dbEmb);
        } catch {
          score = 0;
        }
      } else {
        const factLower = row.fact.toLowerCase();
        const matches = queryTokens.filter(t => factLower.includes(t));
        score = queryTokens.length > 0 ? (matches.length / queryTokens.length) * 0.8 : 0.5;
      }

      if (score >= threshold) {
        const item = this.mapRow(row);
        item.score = score;
        results.push(item);
      }
    }

    return results
      .sort((a, b) => (b.score! * b.confidence) - (a.score! * a.confidence))
      .slice(0, limit);
  }

  async inspect(query?: string, scope?: MemoryScope, limit: number = 30): Promise<ScopedMemoryItem[]> {
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
    return rows.map((r) => this.mapRow(r));
  }

  async delete(id: number): Promise<void> {
    await this.db.run(`UPDATE scoped_memory SET lifecycle = 'deleted', updated_at = ? WHERE id = ?`, Date.now(), id);
  }

  private mapRow(row: any): ScopedMemoryItem {
    let embedding: number[] | undefined;
    if (row.embedding) {
      try {
        embedding = JSON.parse(row.embedding);
      } catch {}
    }

    return {
      id: row.id,
      scope: row.scope as MemoryScope,
      fact: row.fact,
      tags: row.tags ? row.tags.split(',') : [],
      confidence: row.confidence,
      lifecycle: row.lifecycle as MemoryLifecycle,
      type: (row.memory_type as MemoryType) || 'fact',
      provenance: {
        source: row.source,
        timestamp: row.timestamp,
        runId: row.run_id || undefined,
        sessionId: row.session_id || undefined,
        evidence: row.evidence || undefined
      },
      supersededBy: row.superseded_by || undefined,
      workspaceId: row.workspace_id ?? undefined,
      projectId: row.project_id ?? undefined,
      agentId: row.agent_id || undefined,
      goalId: row.goal_id || undefined,
      securityStatus: row.security_status || 'clean',
      quarantineReason: row.quarantine_reason || undefined,
      embedding,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
