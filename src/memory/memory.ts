import { Database } from 'sqlite';
import { openDatabase } from '../storage/database.js';
import { createSqliteStores, SqliteStores } from '../storage/stores/sqlite/index.js';
import { Message } from '../runtime/types.js';
import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { RunState } from '../runtime/runState.js';
import { AgentEvent } from '../runtime/events.js';
import { MemoryScope, MemoryLifecycle, MemoryProvenance, ScopedMemoryItem, SkillRegistryEntry, MemoryType } from './memoryTypes.js';
import { MemoryWritePipeline, MemoryWriteRequest, MemoryWriteResult } from './memoryPipeline.js';
import { SessionSearchEngine } from './sessionSearch.js';
import { MemoryStore, SessionSearchStore, ResearchDocumentStore, VectorStore, BrowserProfileStore, RoutineStore, LearnedWorkflowStore, SkillStore, AgentMessageStore, AgentTeamStore, DurableAgentEventStore, WebhookStore, HeartbeatStore, CommunicationStore, CalendarStore, MultimodalStore } from '../storage/stores/types.js';
import { ConfiguredEmbeddingProvider } from '../providers/embeddingProvider.js';
import { LocalCrossEncoderReranker } from '../providers/localReranker.js';
import { CapabilityRegistry, seedP4BCapabilities, seedP4CCapabilities, seedP4DCapabilities, seedP5Capabilities, seedP6Capabilities, seedP7Capabilities, seedP8Capabilities, seedP9Capabilities } from '../tools/capabilityRegistry.js';
import { RagEngine } from '../research/ragPipeline.js';
import { ResearchEngine } from '../research/researchPipeline.js';
import { BrowserEngine } from '../browser/browserEngine.js';
import { ComputerController } from '../computer/computerController.js';
import { ProgressiveSkillManager, RoutineEngine, WorkflowLearner } from '../learning/index.js';
import { AgentMailbox, HandoffEngine, TeamManager, DelegationContractEngine } from '../multiagent/index.js';
import { EventPipeline, HeartbeatEngine, WebhookEngine, StalledGoalDetector } from '../proactive/index.js';
import { CalendarEngine } from '../communication/calendarEngine.js';
import { ChannelGatewayManager } from '../gateway/channelGatewayManager.js';
import { MultiModalEngine } from '../multimodal/index.js';

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
  private stores: SqliteStores | null = null;
  private pipeline: MemoryWritePipeline | null = null;
  private sessionSearchEngine: SessionSearchEngine | null = null;
  private ai: GoogleGenAI | null = null;
  private openAIClient: OpenAI | null = null;
  private apiKey?: string;
  private hasWarnedNoEmbeddingKey: boolean = false;
  /** P4B: shared embedding provider (Gemini → OpenAI/NVIDIA fallback chain). */
  private embeddingProvider: ConfiguredEmbeddingProvider | null = null;
  private ragEngines: Map<string, RagEngine> = new Map();
  private researchEngine: ResearchEngine | null = null;

  private static instance: EpisodicMemory | null = null;

  constructor(dbPath: string, apiKey?: string) {
    this.dbPath = dbPath;
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
    EpisodicMemory.instance = this;
  }

  static getInstance(dbPath: string = process.env.DATABASE_PATH || './state.db'): EpisodicMemory {
    if (!EpisodicMemory.instance) {
      EpisodicMemory.instance = new EpisodicMemory(dbPath);
    }
    return EpisodicMemory.instance;
  }

  static setInstance(instance: EpisodicMemory | null): void {
    EpisodicMemory.instance = instance;
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

  public async generateEmbedding(text: string): Promise<number[] | null> {
    // P4B: delegates to the shared ConfiguredEmbeddingProvider. The fallback
    // chain (Gemini embedContent → OpenAI-compatible endpoint, optionally
    // NVIDIA) is identical to the previous inline implementation.
    if (!this.embeddingProvider) {
      this.embeddingProvider = new ConfiguredEmbeddingProvider(this.apiKey);
    }
    return this.embeddingProvider.embed(text);
  }

  async init(): Promise<void> {
    if (this.db) return;

    // V2: shared database layer opens the connection (absolute path),
    // enables foreign keys, and runs all versioned schema migrations
    // (see src/storage/migrations/index.ts). The V1 baseline DDL that used
    // to live here is now migration "v1_baseline".
    this.db = await openDatabase(this.dbPath);
    this.stores = createSqliteStores(this.db);
    this.pipeline = new MemoryWritePipeline(this.stores.memory);
    this.sessionSearchEngine = new SessionSearchEngine(this.stores.sessionSearch);
    // P4B, P4C, P4D, P5 & P6: seed honest capability registry.
    seedP4BCapabilities(CapabilityRegistry.getInstance());
    seedP4CCapabilities(CapabilityRegistry.getInstance());
    seedP4DCapabilities(CapabilityRegistry.getInstance());
    seedP5Capabilities(CapabilityRegistry.getInstance());
    seedP6Capabilities(CapabilityRegistry.getInstance());
    if (this.stores.browserProfile) {
      BrowserEngine.getInstance().getProfileManager().setStore(this.stores.browserProfile);
    }
    this.embeddingProvider = new ConfiguredEmbeddingProvider(this.apiKey);
  }

  getAgentStore(): SqliteStores['agent'] | null {
    return this.stores ? this.stores.agent : null;
  }

  getUserStore(): SqliteStores['user'] | null {
    return this.stores ? this.stores.user : null;
  }

  getWorkspaceStore(): SqliteStores['workspace'] | null {
    return this.stores ? this.stores.workspace : null;
  }

  getProjectStore(): SqliteStores['project'] | null {
    return this.stores ? this.stores.project : null;
  }

  getRunStore(): SqliteStores['run'] | null {
    return this.stores ? this.stores.run : null;
  }

  getEventStore(): SqliteStores['event'] | null {
    return this.stores ? this.stores.event : null;
  }

  getGoalStore(): SqliteStores['goal'] | null {
    return this.stores ? this.stores.goal : null;
  }

  getTaskStore(): SqliteStores['task'] | null {
    return this.stores ? this.stores.task : null;
  }

  getRunWaitStore(): SqliteStores['runWait'] | null {
    return this.stores ? this.stores.runWait : null;
  }

  getMemoryStore(): MemoryStore | null {
    return this.stores ? this.stores.memory : null;
  }

  getSessionSearchStore(): SessionSearchStore | null {
    return this.stores ? this.stores.sessionSearch : null;
  }

  getMemoryPipeline(): MemoryWritePipeline | null {
    return this.pipeline;
  }

  getSessionSearchEngine(): SessionSearchEngine | null {
    return this.sessionSearchEngine;
  }

  // --- P4B: Web Research, RAG, and Document Intelligence ---

  getVectorStore(): VectorStore | null {
    return this.stores ? this.stores.vector : null;
  }

  getResearchDocumentStore(): ResearchDocumentStore | null {
    return this.stores ? this.stores.researchDocument : null;
  }

  getEmbeddingProvider(): ConfiguredEmbeddingProvider | null {
    return this.embeddingProvider;
  }

  /**
   * RAG engine for a namespace (default "documents"). Lazily constructed
   * with the SQLite vector/document stores, the shared embedding provider,
   * and the local cross-encoder reranker (capability-honest: reports
   * unsupported when the model cannot load).
   */
  getRagEngine(namespace?: string): RagEngine {
    if (!this.stores || !this.embeddingProvider) {
      throw new Error('Database not initialized. Call init() first.');
    }
    const ns = namespace || 'documents';
    let engine = this.ragEngines.get(ns);
    if (!engine) {
      engine = new RagEngine(
        {
          vectorStore: this.stores.vector,
          documentStore: this.stores.researchDocument,
          embedder: this.embeddingProvider,
          reranker: new LocalCrossEncoderReranker()
        },
        { namespace: ns }
      );
      this.ragEngines.set(ns, engine);
    }
    return engine;
  }

  /** Research pipeline (search → retrieve → extract → cross-check → synthesize → cite). */
  getResearchEngine(): ResearchEngine {
    if (!this.researchEngine) {
      this.researchEngine = new ResearchEngine();
    }
    return this.researchEngine;
  }

  // --- P4C: Browser as First-Class Environment ---

  getBrowserProfileStore(): BrowserProfileStore | null {
    return this.stores ? this.stores.browserProfile : null;
  }

  getBrowserEngine(): BrowserEngine {
    return BrowserEngine.getInstance();
  }

  // --- P4D: Computer Use and Application Control ---

  getComputerController(): ComputerController {
    return ComputerController.getInstance();
  }

  // --- P5: Learning (Skills, Progressive Disclosure, Routines, Workflows) ---

  private skillManager?: ProgressiveSkillManager;
  private routineEngine?: RoutineEngine;
  private workflowLearner?: WorkflowLearner;

  getRoutineStore(): RoutineStore | null {
    return this.stores ? this.stores.routine : null;
  }

  getLearnedWorkflowStore(): LearnedWorkflowStore | null {
    return this.stores ? this.stores.learnedWorkflow : null;
  }

  getSkillStore(): SkillStore | null {
    return this.stores ? this.stores.skill : null;
  }

  getProgressiveSkillManager(skillsDir = './skills'): ProgressiveSkillManager {
    if (!this.skillManager) {
      this.skillManager = new ProgressiveSkillManager(skillsDir, this.getSkillStore() || undefined);
    }
    return this.skillManager;
  }

  getRoutineEngine(): RoutineEngine {
    if (!this.routineEngine) {
      const routineStore = this.getRoutineStore();
      if (!routineStore) throw new Error('Database not initialized.');
      this.routineEngine = new RoutineEngine(routineStore);
    }
    return this.routineEngine;
  }

  getWorkflowLearner(skillsDir = './skills'): WorkflowLearner {
    if (!this.workflowLearner) {
      const wfStore = this.getLearnedWorkflowStore();
      if (!wfStore) throw new Error('Database not initialized.');
      const skillMgr = this.getProgressiveSkillManager(skillsDir);
      const routineEng = this.getRoutineEngine();
      this.workflowLearner = new WorkflowLearner(wfStore, skillMgr, routineEng);
    }
    return this.workflowLearner;
  }

  // --- P6: Multi-Agent Subsystem (Spec Sections 32, 33, 34) ---

  private agentMailbox?: AgentMailbox;
  private handoffEngine?: HandoffEngine;
  private teamManager?: TeamManager;
  private delegationEngine?: DelegationContractEngine;

  getAgentMessageStore(): AgentMessageStore | null {
    return this.stores ? this.stores.agentMessage : null;
  }

  getAgentTeamStore(): AgentTeamStore | null {
    return this.stores ? this.stores.agentTeam : null;
  }

  getDelegationContractEngine(): DelegationContractEngine {
    if (!this.delegationEngine) {
      this.delegationEngine = new DelegationContractEngine();
    }
    return this.delegationEngine;
  }

  getAgentMailbox(): AgentMailbox {
    if (!this.agentMailbox) {
      const store = this.getAgentMessageStore();
      if (!store) throw new Error('Database not initialized.');
      this.agentMailbox = new AgentMailbox(store);
    }
    return this.agentMailbox;
  }

  getHandoffEngine(): HandoffEngine {
    if (!this.handoffEngine) {
      const mailbox = this.getAgentMailbox();
      const delegationEngine = this.getDelegationContractEngine();
      this.handoffEngine = new HandoffEngine(mailbox, delegationEngine, this.getTaskStore() || undefined);
    }
    return this.handoffEngine;
  }

  getTeamManager(): TeamManager {
    if (!this.teamManager) {
      const store = this.getAgentTeamStore();
      if (!store) throw new Error('Database not initialized.');
      this.teamManager = new TeamManager(store);
    }
    return this.teamManager;
  }

  // --- P7: Proactive Agent Subsystem (Spec Sections 35, 36, 37, 38, 66) ---

  private eventPipeline?: EventPipeline;
  private heartbeatEngine?: HeartbeatEngine;
  private webhookEngine?: WebhookEngine;
  private stalledGoalDetector?: StalledGoalDetector;

  getDurableAgentEventStore(): DurableAgentEventStore | null {
    return this.stores ? this.stores.durableEvent : null;
  }

  getWebhookStore(): WebhookStore | null {
    return this.stores ? this.stores.webhook : null;
  }

  getHeartbeatStore(): HeartbeatStore | null {
    return this.stores ? this.stores.heartbeat : null;
  }

  getEventPipeline(): EventPipeline {
    if (!this.eventPipeline) {
      const store = this.getDurableAgentEventStore();
      if (!store) throw new Error('Database not initialized.');
      this.eventPipeline = new EventPipeline(store);
    }
    return this.eventPipeline;
  }

  getHeartbeatEngine(): HeartbeatEngine {
    if (!this.heartbeatEngine) {
      const hbStore = this.getHeartbeatStore();
      if (!hbStore) throw new Error('Database not initialized.');
      this.heartbeatEngine = new HeartbeatEngine(
        {
          goal: this.getGoalStore() || undefined,
          runWait: this.getRunWaitStore() || undefined,
          agentMessage: this.getAgentMessageStore() || undefined,
          heartbeat: hbStore
        },
        undefined,
        this.getEventPipeline()
      );
    }
    return this.heartbeatEngine;
  }

  getWebhookEngine(): WebhookEngine {
    if (!this.webhookEngine) {
      const whStore = this.getWebhookStore();
      const evStore = this.getDurableAgentEventStore();
      if (!whStore || !evStore) throw new Error('Database not initialized.');
      this.webhookEngine = new WebhookEngine(whStore, evStore, this.getEventPipeline());
    }
    return this.webhookEngine;
  }

  getStalledGoalDetector(stallThresholdMs?: number): StalledGoalDetector {
    if (!this.stalledGoalDetector) {
      const gStore = this.getGoalStore();
      if (!gStore) throw new Error('Database not initialized.');
      this.stalledGoalDetector = new StalledGoalDetector(gStore, this.getEventPipeline(), stallThresholdMs);
    }
    return this.stalledGoalDetector;
  }

  // --- P8: Communication Subsystem (Spec Sections 26, 27, 28, 58) ---

  private calendarEngine?: CalendarEngine;
  private channelGatewayManager?: ChannelGatewayManager;

  getCommunicationStore(): CommunicationStore | null {
    return this.stores ? this.stores.communication : null;
  }

  getCalendarStore(): CalendarStore | null {
    return this.stores ? this.stores.calendar : null;
  }

  getCalendarEngine(): CalendarEngine {
    if (!this.calendarEngine) {
      const calStore = this.getCalendarStore();
      if (!calStore) throw new Error('Database not initialized.');
      this.calendarEngine = new CalendarEngine(calStore, (this as any).eventBus, this.getEventPipeline());
    }
    return this.calendarEngine;
  }

  getChannelGatewayManager(agent?: any): ChannelGatewayManager {
    if (!this.channelGatewayManager) {
      const commStore = this.getCommunicationStore();
      if (!commStore) throw new Error('Database not initialized.');
      this.channelGatewayManager = new ChannelGatewayManager(commStore, agent);
    } else if (agent) {
      this.channelGatewayManager.setAgent(agent);
    }
    return this.channelGatewayManager;
  }

  // --- P9: Multimodal Subsystem (Spec Sections 46, 47) ---

  private multimodalEngine?: MultiModalEngine;

  getMultimodalStore(): MultimodalStore | null {
    return this.stores ? this.stores.multimodal : null;
  }

  getMultimodalEngine(): MultiModalEngine {
    if (!this.multimodalEngine) {
      const store = this.getMultimodalStore();
      this.multimodalEngine = new MultiModalEngine({ store: store || undefined });
    }
    return this.multimodalEngine;
  }

  private requireRunStore(): SqliteStores['run'] {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    return this.stores.run;
  }

  private requireEventStore(): SqliteStores['event'] {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    return this.stores.event;
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

    if (this.sessionSearchEngine) {
      const textPart = Array.isArray(parts) ? parts.map((p: any) => p?.text || JSON.stringify(p)).join(' ') : String(parts);
      await this.sessionSearchEngine.indexMessage({
        sessionId,
        role,
        text: textPart
      }).catch(() => {});
    }
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

  // --- RunState Persistence (delegated to RunStore / EventStore since V2 P1) ---

  async saveRunState(state: RunState): Promise<void> {
    await this.requireRunStore().save(state);
  }

  async getRunState(runId: string): Promise<RunState | null> {
    return this.requireRunStore().get(runId);
  }

  async updateRunState(runId: string, updates: Partial<RunState>): Promise<void> {
    await this.requireRunStore().update(runId, updates);
  }

  async saveRunEvent(event: AgentEvent): Promise<void> {
    await this.requireEventStore().saveRunEvent(event);

    if (this.sessionSearchEngine) {
      try {
        if (event.type === 'tool_call') {
          const tc = event as any;
          await this.sessionSearchEngine.indexToolCall({
            runId: tc.runId,
            toolName: tc.toolName,
            args: tc.args || {}
          });
        } else if (event.type === 'tool_result') {
          const tr = event as any;
          await this.sessionSearchEngine.indexToolOutput({
            runId: tr.runId,
            toolName: tr.toolName,
            output: typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)
          });
        } else if (event.type === 'thought') {
          const th = event as any;
          await this.sessionSearchEngine.indexThought({
            runId: th.runId,
            thoughtText: th.text
          });
        } else if (event.type === 'plan_created') {
          const pc = event as any;
          await this.sessionSearchEngine.indexPlan({
            runId: pc.runId,
            planText: JSON.stringify(pc.plan)
          });
        } else if (event.type === 'error') {
          const er = event as any;
          await this.sessionSearchEngine.indexError({
            runId: er.runId,
            errorText: JSON.stringify(er.error)
          });
        }
      } catch {
        // Non-blocking telemetry indexing
      }
    }
  }

  async getRunEvents(runId: string): Promise<AgentEvent[]> {
    return this.requireEventStore().getRunEvents(runId);
  }

  async listRuns(sessionId?: string, limit: number = 50): Promise<RunState[]> {
    return this.requireRunStore().list(sessionId, limit);
  }

  // --- Phase 2 & 3: Scoped Memory & Secure Write Pipeline ---

  async saveScopedMemory(params: {
    scope: MemoryScope;
    fact: string;
    tags?: string[];
    confidence?: number;
    lifecycle?: MemoryLifecycle;
    type?: MemoryType;
    provenance: MemoryProvenance;
    embedding?: number[];
    workspaceId?: number | null;
    projectId?: number | null;
    agentId?: string | null;
    goalId?: string | null;
  }): Promise<number> {
    if (!this.db || !this.pipeline) {
      throw new Error('Database not initialized. Call init() first.');
    }

    const res = await this.pipeline.processAndStore({
      fact: params.fact,
      scope: params.scope,
      tags: params.tags,
      type: params.type || 'fact',
      confidence: params.confidence,
      lifecycle: params.lifecycle,
      provenance: params.provenance,
      workspaceId: params.workspaceId ?? undefined,
      projectId: params.projectId ?? undefined,
      agentId: params.agentId ?? undefined,
      goalId: params.goalId ?? undefined,
      embedding: params.embedding
    }, (text) => this.generateEmbedding(text));

    return res.id;
  }

  async writeSecureMemory(request: MemoryWriteRequest): Promise<MemoryWriteResult> {
    if (!this.db || !this.pipeline) {
      throw new Error('Database not initialized. Call init() first.');
    }
    return this.pipeline.processAndStore(request, (text) => this.generateEmbedding(text));
  }

  async searchScopedMemory(params: {
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
  }): Promise<ScopedMemoryItem[]> {
    if (!this.db || !this.stores) {
      throw new Error('Database not initialized. Call init() first.');
    }

    let queryEmbedding: number[] | null = null;
    try {
      queryEmbedding = await this.generateEmbedding(params.query);
    } catch {
      // Soft fallback
    }

    return this.stores.memory.search({
      ...params,
      queryEmbedding
    });
  }

  async getScopedMemory(id: number): Promise<ScopedMemoryItem | null> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    return this.stores.memory.get(id);
  }

  async updateMemoryLifecycle(id: number, lifecycle: MemoryLifecycle, supersededBy?: number): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.updateLifecycle(id, lifecycle, supersededBy);
  }

  /**
   * Promote a candidate fact to active. This is the explicit validation
   * path; model writes never do this themselves.
   */
  async validateMemory(id: number, evidence?: string): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.validate(id, evidence);
  }

  async reinforceMemory(id: number, delta: number = 0.1): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.reinforce(id, delta);
  }

  async contradictMemory(id: number, evidence?: string): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.contradict(id, evidence);
  }

  async quarantineMemory(id: number, reason: string): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.quarantine(id, reason);
  }

  async resolveContradiction(existingId: number, newFact: string, provenance: MemoryProvenance): Promise<number> {
    if (!this.db || !this.stores) throw new Error('Database not initialized. Call init() first.');
    const existing = await this.getScopedMemory(existingId);
    if (!existing) throw new Error(`Memory fact ${existingId} not found.`);

    // 1. Save new fact
    const newId = await this.saveScopedMemory({
      scope: existing.scope,
      fact: newFact,
      tags: existing.tags,
      confidence: 1.0,
      provenance,
      workspaceId: existing.workspaceId ?? null,
      projectId: existing.projectId ?? null,
      agentId: existing.agentId ?? null,
      goalId: existing.goalId ?? null
    });

    // 2. Mark older fact as superseded
    await this.updateMemoryLifecycle(existingId, 'superseded', newId);
    return newId;
  }

  async deleteScopedMemory(id: number): Promise<void> {
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    await this.stores.memory.delete(id);
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
    if (!this.stores) throw new Error('Database not initialized. Call init() first.');
    return this.stores.memory.inspect(query, scope, limit);
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

