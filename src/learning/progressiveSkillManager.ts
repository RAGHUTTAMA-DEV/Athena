import * as fs from 'fs/promises';
import * as path from 'path';
import { SkillMetadata, SkillWithContent, SkillLifecycleStatus } from './learningTypes.js';
import { SkillStore, SkillRecord } from '../storage/stores/types.js';
import { parseFrontmatter } from '../memory/procedural.js';

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'her', 'here',
  'how', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'its', 'just', 'like', 'me', 'more',
  'most', 'my', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

export class ProgressiveSkillManager {
  private skillsDir: string;
  private store?: SkillStore;
  private metadataCache: Map<string, SkillMetadata> = new Map();
  private initialized = false;

  constructor(skillsDir: string, store?: SkillStore) {
    this.skillsDir = path.resolve(skillsDir);
    this.store = store;
  }

  public setStore(store: SkillStore) {
    this.store = store;
  }

  /**
   * Initializes the lightweight metadata cache for all skills.
   * Progressive disclosure: Only metadata (title, description, tags, status) is kept in memory.
   * Full markdown body is loaded strictly on-demand.
   */
  async init(): Promise<void> {
    this.metadataCache.clear();
    try {
      await fs.mkdir(this.skillsDir, { recursive: true });
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(this.skillsDir, entry.name);
          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const { data } = parseFrontmatter(raw);
            const name = data.name || path.basename(entry.name, '.md');
            const id = `skill_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

            let record: SkillRecord | null = null;
            if (this.store) {
              record = await this.store.findByName(name);
            }

            const meta: SkillMetadata = {
              id: record?.id || id,
              name,
              version: data.version || record?.version || '1.0.0',
              description: data.description || record?.description || '',
              tags: Array.isArray(data.tags) ? data.tags : (record?.tags || []),
              dependencies: data.dependencies ? (Array.isArray(data.dependencies) ? data.dependencies : [data.dependencies]) : record?.dependencies,
              permissions: data.permissions ? (Array.isArray(data.permissions) ? data.permissions : [data.permissions]) : record?.permissions,
              triggers: data.triggers ? (Array.isArray(data.triggers) ? data.triggers : [data.triggers]) : record?.triggers,
              filePath,
              status: record?.status || (data.status as SkillLifecycleStatus) || 'active',
              invocations: record?.invocations || 0,
              successCount: record?.successCount || 0,
              failureCount: record?.failureCount || 0,
              successRate: record?.successRate !== undefined ? record.successRate : 1.0,
              lastUsedAt: record?.lastUsedAt || null,
              createdAt: record?.createdAt || Date.now(),
              updatedAt: record?.updatedAt || Date.now()
            };

            this.metadataCache.set(name.toLowerCase(), meta);

            if (this.store && !record) {
              await this.store.save(meta);
            }
          } catch (e: any) {
            console.warn(`[ProgressiveSkillManager] Error indexing ${entry.name}: ${e.message}`);
          }
        }
      }

      // Also index any store-persisted skills that might not have flat files yet
      if (this.store) {
        const storeSkills = await this.store.list();
        for (const s of storeSkills) {
          if (!this.metadataCache.has(s.name.toLowerCase())) {
            this.metadataCache.set(s.name.toLowerCase(), {
              ...s,
              description: s.description || '',
              tags: s.tags || [],
              createdAt: s.createdAt || Date.now(),
              updatedAt: s.updatedAt || Date.now()
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[ProgressiveSkillManager] Failed to read skills directory: ${err.message}`);
    }

    this.initialized = true;
  }

  public getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadataCache.values());
  }

  public getMetadata(nameOrId: string): SkillMetadata | null {
    const key = nameOrId.toLowerCase();
    for (const [k, meta] of this.metadataCache.entries()) {
      if (k === key || meta.id.toLowerCase() === key) {
        return meta;
      }
    }
    return null;
  }

  /**
   * On-demand body retrieval (Progressive Disclosure Phase 2).
   * Reads and parses full markdown instructions only when needed.
   */
  async loadSkillBody(nameOrId: string): Promise<SkillWithContent | null> {
    const meta = this.getMetadata(nameOrId);
    if (!meta) return null;

    let content = '';
    if (meta.filePath) {
      try {
        const raw = await fs.readFile(meta.filePath, 'utf-8');
        const parsed = parseFrontmatter(raw);
        content = parsed.content.trim();
      } catch (err: any) {
        console.warn(`[ProgressiveSkillManager] Failed to read body from ${meta.filePath}: ${err.message}`);
      }
    }

    return {
      ...meta,
      content
    };
  }

  /**
   * Progressive disclosure search:
   * Matches query against lightweight metadata (tags, name, description).
   * Only returns the full instruction content for matched, active skills within limit.
   */
  async searchSkills(query: string, limit: number = 3, allowProposed: boolean = false): Promise<SkillWithContent[]> {
    if (!this.initialized) await this.init();

    const clean = query.toLowerCase();
    const tokens = clean.split(/\W+/).filter(t => t.length > 1 && !STOP_WORDS.has(t));
    if (tokens.length === 0) return [];

    const candidates = Array.from(this.metadataCache.values()).filter(s => {
      if (!allowProposed && s.status !== 'active') return false;
      return true;
    });

    const scored = candidates.map(skill => {
      let score = 0;
      const nameLower = skill.name.toLowerCase();
      const descLower = skill.description.toLowerCase();
      const tagsLower = skill.tags.map(t => t.toLowerCase());

      for (const token of tokens) {
        if (nameLower.includes(token)) score += 5;
        if (tagsLower.some(t => t.includes(token))) score += 4;
        if (descLower.includes(token)) score += 2;
      }

      // Prioritize higher historical success rate
      score += (skill.successRate || 1.0) * 1.5;

      return { skill, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const topScored = scored.filter(s => s.score > 2.0).slice(0, limit);

    // Load body ONLY for the top matched skills
    const results: SkillWithContent[] = [];
    for (const item of topScored) {
      const full = await this.loadSkillBody(item.skill.name);
      if (full) {
        results.push(full);
      }
    }

    return results;
  }

  /**
   * Proposes a new skill (e.g. from a learned workflow).
   * Starts in 'proposed' state requiring review before auto-execution.
   */
  async proposeSkill(params: {
    name: string;
    description: string;
    tags: string[];
    content: string;
    dependencies?: string[];
    permissions?: string[];
    triggers?: string[];
  }): Promise<SkillMetadata> {
    const name = params.name.trim();
    const id = `skill_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
    const filename = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.md`;
    const filePath = path.join(this.skillsDir, filename);

    const frontmatter = [
      '---',
      `name: "${name}"`,
      `version: "1.0.0"`,
      `description: "${params.description}"`,
      `status: "proposed"`,
      `tags: ${JSON.stringify(params.tags)}`,
      params.permissions ? `permissions: ${JSON.stringify(params.permissions)}` : null,
      params.triggers ? `triggers: ${JSON.stringify(params.triggers)}` : null,
      '---',
      params.content
    ].filter(Boolean).join('\n');

    await fs.writeFile(filePath, frontmatter, 'utf-8');

    const meta: SkillMetadata = {
      id,
      name,
      version: '1.0.0',
      description: params.description,
      tags: params.tags,
      dependencies: params.dependencies,
      permissions: params.permissions,
      triggers: params.triggers,
      filePath,
      status: 'proposed',
      invocations: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.metadataCache.set(name.toLowerCase(), meta);
    if (this.store) {
      await this.store.save(meta);
    }

    return meta;
  }

  /**
   * Review and transition skill lifecycle status ('reviewed', 'active', 'deprecated', etc.).
   */
  async reviewSkill(nameOrId: string, status: SkillLifecycleStatus): Promise<SkillMetadata> {
    const meta = this.getMetadata(nameOrId);
    if (!meta) {
      throw new Error(`Skill "${nameOrId}" not found.`);
    }

    meta.status = status;
    meta.updatedAt = Date.now();
    this.metadataCache.set(meta.name.toLowerCase(), meta);

    if (this.store) {
      await this.store.updateStatus(meta.id, status);
    }

    // Also update file frontmatter if exists
    if (meta.filePath) {
      try {
        const raw = await fs.readFile(meta.filePath, 'utf-8');
        const parsed = parseFrontmatter(raw);
        parsed.data.status = status;

        const updatedLines = [
          '---',
          `name: "${meta.name}"`,
          `version: "${meta.version}"`,
          `description: "${meta.description}"`,
          `status: "${status}"`,
          `tags: ${JSON.stringify(meta.tags)}`,
          '---',
          parsed.content
        ];
        await fs.writeFile(meta.filePath, updatedLines.join('\n'), 'utf-8');
      } catch (err: any) {
        console.warn(`[ProgressiveSkillManager] Failed to rewrite file ${meta.filePath}: ${err.message}`);
      }
    }

    return meta;
  }

  /**
   * Telemetry tracking for skill execution.
   */
  async recordOutcome(nameOrId: string, success: boolean): Promise<void> {
    const meta = this.getMetadata(nameOrId);
    if (!meta) return;

    meta.invocations += 1;
    if (success) {
      meta.successCount += 1;
    } else {
      meta.failureCount += 1;
    }
    meta.successRate = meta.invocations > 0 ? meta.successCount / meta.invocations : 1.0;
    meta.lastUsedAt = Date.now();
    meta.updatedAt = Date.now();

    this.metadataCache.set(meta.name.toLowerCase(), meta);
    if (this.store) {
      await this.store.recordOutcome(meta.id, success);
    }
  }
}
