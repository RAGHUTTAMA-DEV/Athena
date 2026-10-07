import { Database } from 'sqlite';
import {
  SessionSearchStore,
  SessionSearchEntry,
  SessionSearchFilter,
  SessionSearchResult
} from '../types.js';

function sanitizeFtsQuery(query: string): string {
  // Strip special FTS5 operators to prevent syntax errors
  const cleaned = query
    .replace(/['"*():^~]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => `"${t}"`)
    .join(' OR ');

  return cleaned || `""`;
}

export class SqliteSessionSearchStore implements SessionSearchStore {
  constructor(private db: Database) {}

  async indexEntry(entry: SessionSearchEntry): Promise<void> {
    const metadataStr = entry.metadata ? JSON.stringify(entry.metadata) : null;
    await this.db.run(
      `INSERT OR REPLACE INTO session_search_entries (
        id, category, content_text, session_id, run_id, goal_id, task_id,
        workspace_id, project_id, agent_id, metadata, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.id,
      entry.category,
      entry.contentText,
      entry.sessionId || null,
      entry.runId || null,
      entry.goalId || null,
      entry.taskId || null,
      entry.workspaceId ?? null,
      entry.projectId ?? null,
      entry.agentId || null,
      metadataStr,
      entry.timestamp || Date.now()
    );
  }

  async search(filter: SessionSearchFilter): Promise<SessionSearchResult[]> {
    const limit = filter.limit ?? 10;
    const ftsQuery = sanitizeFtsQuery(filter.query);

    // If query is empty, return empty
    if (!filter.query || filter.query.trim().length === 0) {
      return [];
    }

    try {
      let sql = `
        SELECT
          e.id,
          e.category,
          e.content_text,
          e.session_id,
          e.run_id,
          e.goal_id,
          e.task_id,
          e.workspace_id,
          e.project_id,
          e.agent_id,
          e.metadata,
          e.timestamp,
          bm25(session_search_fts) AS rank
        FROM session_search_fts f
        JOIN session_search_entries e ON f.entry_id = e.id
        WHERE session_search_fts MATCH ?
      `;
      const params: any[] = [ftsQuery];

      if (filter.categories && filter.categories.length > 0) {
        const placeholders = filter.categories.map(() => '?').join(',');
        sql += ` AND e.category IN (${placeholders})`;
        params.push(...filter.categories);
      }

      if (filter.sessionId) {
        sql += ` AND e.session_id = ?`;
        params.push(filter.sessionId);
      }

      if (filter.runId) {
        sql += ` AND e.run_id = ?`;
        params.push(filter.runId);
      }

      if (filter.goalId) {
        sql += ` AND e.goal_id = ?`;
        params.push(filter.goalId);
      }

      if (filter.taskId) {
        sql += ` AND e.task_id = ?`;
        params.push(filter.taskId);
      }

      if (filter.workspaceId !== undefined) {
        sql += ` AND (e.workspace_id IS NULL OR e.workspace_id = ?)`;
        params.push(filter.workspaceId);
      }

      if (filter.projectId !== undefined) {
        sql += ` AND (e.project_id IS NULL OR e.project_id = ?)`;
        params.push(filter.projectId);
      }

      if (filter.agentId !== undefined) {
        sql += ` AND (e.agent_id IS NULL OR e.agent_id = ?)`;
        params.push(filter.agentId);
      }

      if (filter.timeRange) {
        if (filter.timeRange.start !== undefined) {
          sql += ` AND e.timestamp >= ?`;
          params.push(filter.timeRange.start);
        }
        if (filter.timeRange.end !== undefined) {
          sql += ` AND e.timestamp <= ?`;
          params.push(filter.timeRange.end);
        }
      }

      sql += ` ORDER BY rank ASC, e.timestamp DESC LIMIT ?`;
      params.push(limit);

      const rows = await this.db.all(sql, ...params);
      return rows.map((r) => this.mapRow(r));
    } catch {
      // Fallback to LIKE search if FTS5 syntax fails
      return this.searchLikeFallback(filter);
    }
  }

  private async searchLikeFallback(filter: SessionSearchFilter): Promise<SessionSearchResult[]> {
    const limit = filter.limit ?? 10;
    let sql = `SELECT * FROM session_search_entries WHERE content_text LIKE ?`;
    const params: any[] = [`%${filter.query}%`];

    if (filter.categories && filter.categories.length > 0) {
      const placeholders = filter.categories.map(() => '?').join(',');
      sql += ` AND category IN (${placeholders})`;
      params.push(...filter.categories);
    }

    if (filter.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(filter.sessionId);
    }

    if (filter.runId) {
      sql += ` AND run_id = ?`;
      params.push(filter.runId);
    }

    if (filter.goalId) {
      sql += ` AND goal_id = ?`;
      params.push(filter.goalId);
    }

    if (filter.taskId) {
      sql += ` AND task_id = ?`;
      params.push(filter.taskId);
    }

    if (filter.workspaceId !== undefined) {
      sql += ` AND (workspace_id IS NULL OR workspace_id = ?)`;
      params.push(filter.workspaceId);
    }

    if (filter.projectId !== undefined) {
      sql += ` AND (project_id IS NULL OR project_id = ?)`;
      params.push(filter.projectId);
    }

    if (filter.agentId !== undefined) {
      sql += ` AND (agent_id IS NULL OR agent_id = ?)`;
      params.push(filter.agentId);
    }

    if (filter.timeRange) {
      if (filter.timeRange.start !== undefined) {
        sql += ` AND timestamp >= ?`;
        params.push(filter.timeRange.start);
      }
      if (filter.timeRange.end !== undefined) {
        sql += ` AND timestamp <= ?`;
        params.push(filter.timeRange.end);
      }
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, ...params);
    return rows.map((r) => this.mapRow(r));
  }

  async deleteByRun(runId: string): Promise<void> {
    await this.db.run(`DELETE FROM session_search_entries WHERE run_id = ?`, runId);
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.run(`DELETE FROM session_search_entries WHERE session_id = ?`, sessionId);
  }

  private mapRow(row: any): SessionSearchResult {
    let metadata: Record<string, any> | undefined;
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {}
    }

    return {
      id: row.id,
      category: row.category,
      contentText: row.content_text,
      sessionId: row.session_id || undefined,
      runId: row.run_id || undefined,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      workspaceId: row.workspace_id ?? undefined,
      projectId: row.project_id ?? undefined,
      agentId: row.agent_id || undefined,
      metadata,
      timestamp: row.timestamp,
      rank: row.rank !== undefined ? Number(row.rank) : undefined
    };
  }
}
