import * as path from 'path';
import * as fs from 'fs/promises';
import { BrowserProfile } from './browserTypes.js';
import { BrowserProfileStore } from '../storage/stores/types.js';

export class BrowserProfileManager {
  private baseDir: string;
  private store?: BrowserProfileStore;
  private memoryProfiles: Map<string, BrowserProfile> = new Map();

  constructor(options?: { baseDir?: string; store?: BrowserProfileStore }) {
    this.baseDir = options?.baseDir
      ? path.resolve(options.baseDir)
      : path.resolve(process.cwd(), 'scratch', 'browser_profiles');
    this.store = options?.store;
  }

  setStore(store: BrowserProfileStore): void {
    this.store = store;
  }

  /**
   * Derive a deterministic profile ID based on agent, task, or explicit name.
   * By default, two different agents (e.g. "researcher" and "coder") or tasks
   * receive isolated profiles unless they explicitly specify the same name.
   */
  resolveProfileId(options?: {
    profileId?: string;
    name?: string;
    agentId?: string;
    taskId?: string;
  }): string {
    if (options?.profileId) {
      return options.profileId.replace(/[^a-zA-Z0-9_-]/g, '_');
    }
    if (options?.name) {
      return `named_${options.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }
    if (options?.agentId) {
      return `agent_${options.agentId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }
    if (options?.taskId) {
      return `task_${options.taskId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    }
    return 'default';
  }

  getProfileDir(profileId: string): string {
    return path.join(this.baseDir, profileId);
  }

  async getOrCreateProfile(options?: {
    profileId?: string;
    name?: string;
    agentId?: string;
    taskId?: string;
    metadata?: Record<string, any>;
  }): Promise<BrowserProfile> {
    const id = this.resolveProfileId(options);
    const dir = this.getProfileDir(id);

    // Check store or in-memory cache
    let existing: BrowserProfile | null = null;
    if (this.store) {
      const record = await this.store.get(id);
      if (record) {
        existing = {
          id: record.id,
          name: record.name,
          agentId: record.agentId,
          taskId: record.taskId,
          userDataDir: record.userDataDir,
          metadata: record.metadata,
          createdAt: record.createdAt || Date.now()
        };
      }
    } else {
      existing = this.memoryProfiles.get(id) || null;
    }

    if (!existing) {
      // Ensure user data directory exists
      await fs.mkdir(dir, { recursive: true });

      const name = options?.name || options?.agentId || options?.taskId || id;
      existing = {
        id,
        name,
        agentId: options?.agentId || null,
        taskId: options?.taskId || null,
        userDataDir: dir,
        createdAt: Date.now(),
        metadata: options?.metadata
      };

      if (this.store) {
        await this.store.save({
          id: existing.id,
          name: existing.name,
          agentId: existing.agentId,
          taskId: existing.taskId,
          userDataDir: existing.userDataDir,
          metadata: existing.metadata,
          createdAt: existing.createdAt
        });
      }
      this.memoryProfiles.set(id, existing);
    } else {
      await fs.mkdir(existing.userDataDir, { recursive: true });
    }

    return existing;
  }

  async listProfiles(): Promise<BrowserProfile[]> {
    if (this.store) {
      const records = await this.store.list();
      return records.map(r => ({
        id: r.id,
        name: r.name,
        agentId: r.agentId,
        taskId: r.taskId,
        userDataDir: r.userDataDir,
        metadata: r.metadata,
        createdAt: r.createdAt || Date.now()
      }));
    }
    return Array.from(this.memoryProfiles.values());
  }

  async deleteProfile(profileId: string): Promise<boolean> {
    const dir = this.getProfileDir(profileId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore if directory doesn't exist
    }

    this.memoryProfiles.delete(profileId);
    if (this.store) {
      return await this.store.delete(profileId);
    }
    return true;
  }

  async clearProfileData(profileId: string): Promise<void> {
    const dir = this.getProfileDir(profileId);
    try {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Ignore
    }
  }
}
