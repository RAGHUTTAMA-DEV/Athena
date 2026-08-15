import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Message } from './types.js';
import { GoogleGenAI } from '@google/genai';

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
  private apiKey?: string;

  constructor(dbPath: string, apiKey?: string) {
    this.dbPath = dbPath;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
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

  async init(): Promise<void> {
    if (this.db) return;

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    // 1. Create standard episodic memory table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL, -- JSON serialized parts array
        timestamp INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_memory(session_id);
    `);

    // 2. Create FTS5 external content table
    await this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
        session_id,
        role,
        content,
        content='episodic_memory',
        content_rowid='id'
      );
    `);

    // 3. Create triggers to keep FTS index synced with the base table
    await this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS episodic_ai AFTER INSERT ON episodic_memory BEGIN
        INSERT INTO episodic_fts(rowid, session_id, role, content) 
        VALUES (new.id, new.session_id, new.role, new.content);
      END;
      
      CREATE TRIGGER IF NOT EXISTS episodic_ad AFTER DELETE ON episodic_memory BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, session_id, role, content) 
        VALUES ('delete', old.id, old.session_id, old.role, old.content);
      END;
      
      CREATE TRIGGER IF NOT EXISTS episodic_au AFTER UPDATE ON episodic_memory BEGIN
        INSERT INTO episodic_fts(episodic_fts, rowid, session_id, role, content) 
        VALUES ('delete', old.id, old.session_id, old.role, old.content);
        INSERT INTO episodic_fts(rowid, session_id, role, content) 
        VALUES (new.id, new.session_id, new.role, new.content);
      END;
    `);

    // 4. Create semantic memory table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS semantic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fact TEXT NOT NULL,
        embedding TEXT NOT NULL, -- JSON string representing a number[]
        tags TEXT,              -- comma-separated tags
        timestamp INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_semantic_timestamp ON semantic_memory(timestamp);
    `);

    // 5. Upgrade episodic_memory table with consolidated column if not exists
    try {
      await this.db.exec(`ALTER TABLE episodic_memory ADD COLUMN consolidated INTEGER DEFAULT 0`);
    } catch (e) {
      // Column already exists
    }

    // 6. Create scheduled_jobs table
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        prompt TEXT NOT NULL,
        schedule TEXT NOT NULL,
        session_id TEXT NOT NULL,
        last_run INTEGER,
        next_run INTEGER NOT NULL,
        active INTEGER DEFAULT 1
      );
    `);
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

  async loadHistory(sessionId: string, limit: number = 20): Promise<Message[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const rows = await this.db.all(
      `SELECT role, content FROM episodic_memory 
       WHERE session_id = ? 
       ORDER BY timestamp DESC, id DESC 
       LIMIT ?`,
      sessionId,
      limit
    );

    // Rows are retrieved newest first, reverse them to restore chronological order
    return rows.reverse().map((row: any) => ({
      role: row.role as 'user' | 'model',
      parts: JSON.parse(row.content)
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

    // Query episodic_fts virtual table for matching content
    return this.db.all(
      `SELECT rowid as id, session_id, role, content FROM episodic_fts 
       WHERE episodic_fts MATCH ?`,
      query
    );
  }

  // --- Semantic Memory Methods (RAG) ---

  async saveSemanticFact(fact: string, tags?: string[]): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const ai = this.getAI();
    let embedding: number[] = [];
    try {
      const response = await ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
        contents: fact
      });
      if (response.embeddings && response.embeddings[0]?.values) {
        embedding = response.embeddings[0].values;
      } else {
        throw new Error('Embedding values missing from response');
      }
    } catch (err: any) {
      throw new Error(`Failed to generate embedding for fact: ${err.message}`);
    }

    const tagsStr = tags && tags.length > 0 ? tags.join(',') : null;
    const result = await this.db.run(
      `INSERT INTO semantic_memory (fact, embedding, tags, timestamp) VALUES (?, ?, ?, ?)`,
      fact,
      JSON.stringify(embedding),
      tagsStr,
      Date.now()
    );

    return result.lastID!;
  }

  async searchSemanticFacts(query: string, limit: number = 3, threshold: number = 0.65): Promise<SemanticFact[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const ai = this.getAI();
    let queryEmbedding: number[] = [];
    try {
      const response = await ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
        contents: query
      });
      if (response.embeddings && response.embeddings[0]?.values) {
        queryEmbedding = response.embeddings[0].values;
      } else {
        throw new Error('Embedding values missing from response');
      }
    } catch (err: any) {
      throw new Error(`Failed to generate embedding for query: ${err.message}`);
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
  }): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    await this.db.run(
      `INSERT OR REPLACE INTO scheduled_jobs (id, prompt, schedule, session_id, last_run, next_run, active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      job.id,
      job.prompt,
      job.schedule,
      job.sessionId,
      job.lastRun,
      job.nextRun,
      job.active
    );
  }

  async getScheduledJobs(): Promise<any[]> {
    if (!this.db) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.db.all(`SELECT id, prompt, schedule, session_id as sessionId, last_run as lastRun, next_run as nextRun, active FROM scheduled_jobs`);
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

