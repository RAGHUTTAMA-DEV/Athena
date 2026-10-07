import { Database } from 'sqlite';
import {
  AgentProfile,
  AgentProfileVersion,
  AgentStatusType,
  PermissionModel,
  ProfileMemoryScope
} from '../../identityTypes.js';
import { AgentStore } from '../types.js';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function rowToProfile(row: any): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    identity: row.identity,
    role: row.role || '',
    personality: row.personality || '',
    capabilities: parseJson<string[]>(row.capabilities, []),
    permissions: parseJson<PermissionModel>(row.permissions, { toolPermissions: [] }),
    preferences: parseJson<Record<string, any>>(row.preferences, {}),
    workspaceId: row.workspace_id ?? null,
    memoryScope: (row.memory_scope || 'all') as ProfileMemoryScope,
    skills: parseJson<string[]>(row.skills, []),
    routines: parseJson<string[]>(row.routines, []),
    goals: parseJson<string[]>(row.goals, []),
    modelPolicy: parseJson<Record<string, any>>(row.model_policy, {}),
    status: (row.status || 'active') as AgentStatusType,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteAgentStore implements AgentStore {
  constructor(private db: Database) {}

  async get(id: string): Promise<AgentProfile | null> {
    const row = await this.db.get(`SELECT * FROM agent_profiles WHERE id = ?`, id);
    return row ? rowToProfile(row) : null;
  }

  async getByName(name: string): Promise<AgentProfile | null> {
    const row = await this.db.get(`SELECT * FROM agent_profiles WHERE name = ?`, name);
    return row ? rowToProfile(row) : null;
  }

  async list(): Promise<AgentProfile[]> {
    const rows = await this.db.all(`SELECT * FROM agent_profiles ORDER BY created_at ASC`);
    return rows.map(rowToProfile);
  }

  async save(profile: AgentProfile, changedBy: string = 'system'): Promise<AgentProfile> {
    const existing = await this.get(profile.id);
    const now = Date.now();
    const stored: AgentProfile = {
      ...profile,
      version: existing ? existing.version + 1 : 1,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    await this.db.run(
      `INSERT INTO agent_profiles (
        id, name, version, identity, role, personality, capabilities, permissions,
        preferences, workspace_id, memory_scope, skills, routines, goals, model_policy,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        identity = excluded.identity,
        role = excluded.role,
        personality = excluded.personality,
        capabilities = excluded.capabilities,
        permissions = excluded.permissions,
        preferences = excluded.preferences,
        workspace_id = excluded.workspace_id,
        memory_scope = excluded.memory_scope,
        skills = excluded.skills,
        routines = excluded.routines,
        goals = excluded.goals,
        model_policy = excluded.model_policy,
        status = excluded.status,
        updated_at = excluded.updated_at`,
      stored.id,
      stored.name,
      stored.version,
      stored.identity,
      stored.role,
      stored.personality,
      JSON.stringify(stored.capabilities),
      JSON.stringify(stored.permissions),
      JSON.stringify(stored.preferences),
      stored.workspaceId,
      stored.memoryScope,
      JSON.stringify(stored.skills),
      JSON.stringify(stored.routines),
      JSON.stringify(stored.goals),
      JSON.stringify(stored.modelPolicy),
      stored.status,
      stored.createdAt,
      stored.updatedAt
    );

    await this.db.run(
      `INSERT INTO agent_profile_versions (profile_id, version, snapshot, changed_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      stored.id,
      stored.version,
      JSON.stringify(stored),
      changedBy,
      now
    );

    return stored;
  }

  async getVersionHistory(profileId: string): Promise<AgentProfileVersion[]> {
    const rows = await this.db.all(
      `SELECT profile_id, version, snapshot, changed_by, created_at
       FROM agent_profile_versions WHERE profile_id = ? ORDER BY version ASC`,
      profileId
    );
    return rows.map((r: any) => ({
      profileId: r.profile_id,
      version: r.version,
      snapshot: parseJson<AgentProfile>(r.snapshot, null as any),
      changedBy: r.changed_by,
      createdAt: r.created_at
    }));
  }

  async setActiveWorkspace(profileId: string, workspaceId: number | null, changedBy: string = 'system'): Promise<AgentProfile> {
    const profile = await this.get(profileId);
    if (!profile) {
      throw new Error(`Agent profile "${profileId}" not found.`);
    }
    return this.save({ ...profile, workspaceId }, changedBy);
  }
}
