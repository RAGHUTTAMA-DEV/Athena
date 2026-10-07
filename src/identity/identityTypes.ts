import { MemoryScope } from '../memory/memoryTypes.js';

/**
 * Athena V2 — P1 Agent Foundation types.
 *
 * Identity model:
 *  - AgentProfile: persistent, versioned record of who Athena is.
 *    SOUL.md seeds the primary profile's identity text.
 *  - UserAccount: the human owner, separate from generic memory.
 *    Model-inferred user facts live in scoped_memory as lifecycle
 *    'candidate' until validated. They never silently become permanent.
 *  - Workspace / Project: real entities that bound memory and filesystem
 *    access. NULL bindings on scoped_memory are cross-workspace
 *    (V1 visibility semantics preserved).
 *
 * Permission model (primary, data-driven layer in PolicyEngine;
 * V1 hardcoded regex rules remain the secondary layer):
 *  - agent permissions (AgentProfile.permissions)
 *  - user permissions (UserAccount.permissions)
 *  - tool permissions (match a tool name, a ToolPermission category, or '*')
 */

export type WorkspaceKind = 'personal' | 'college' | 'company' | 'research' | 'dev' | 'other';

export interface Workspace {
  id: number;
  name: string;
  kind: WorkspaceKind;
  /** Absolute filesystem root. PolicyEngine uses this as the write boundary. */
  rootPath: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: number;
  workspaceId: number;
  name: string;
  rootPath: string | null;
  createdAt: number;
  updatedAt: number;
}

export type PermissionEffect = 'allow' | 'deny' | 'require_confirmation';

export interface ToolPermissionRule {
  /**
   * A tool name ('executeCommand'), a tool permission category
   * ('fs:write', 'cmd:exec', 'browser', 'memory', 'system', 'net:http', 'fs:read'),
   * or '*'.
   */
  pattern: string;
  effect: PermissionEffect;
  reason?: string;
}

export type PermissionRiskLevel = 'safe' | 'confirm' | 'destructive';

export interface PermissionModel {
  /** Ordered rules; first match wins. Empty model = fall through to V1 rules. */
  toolPermissions: ToolPermissionRule[];
  /** Extra absolute filesystem roots this principal may write to. */
  fileWriteRoots?: string[];
  maxRiskLevel?: PermissionRiskLevel;
}

export interface WorkingHours {
  /** 'HH:MM' local time. */
  start?: string;
  end?: string;
  /** 0 (Sunday) .. 6 (Saturday). */
  days?: number[];
}

export interface NotificationPreferences {
  channels?: string[];
  quietHours?: { start?: string; end?: string };
}

export interface ApprovalPreferences {
  mode?: 'auto' | 'confirm_high_risk' | 'confirm_all';
  expiresAfterHours?: number;
}

export interface UserPreferences {
  communicationStyle?: string;
  /** IANA timezone, e.g. 'Asia/Kolkata'. */
  timezone?: string;
  workingHours?: WorkingHours;
  notifications?: NotificationPreferences;
  approvals?: ApprovalPreferences;
  /** Model routing preferences. Structured by ModelPolicy in P10. */
  models?: Record<string, any>;
  tools?: Record<string, any>;
  projects?: Record<string, any>;
}

export interface UserAccount {
  id: string;
  name: string;
  preferences: UserPreferences;
  permissions: PermissionModel;
  relationships: Record<string, string>;
  /** Routine names. The Routine entity itself is built in P5. */
  routines: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentStatusType = 'active' | 'inactive' | 'suspended';
export type ProfileMemoryScope = MemoryScope | 'all';

export interface AgentProfile {
  id: string;
  name: string;
  /** Monotonic. Bumped on every save. History is append-only. */
  version: number;
  /** Free-text identity. Seeded from SOUL.md for the primary profile. */
  identity: string;
  role: string;
  personality: string;
  capabilities: string[];
  permissions: PermissionModel;
  preferences: Record<string, any>;
  /** Active workspace. null = cross-workspace (V1 behavior). */
  workspaceId: number | null;
  memoryScope: ProfileMemoryScope;
  skills: string[];
  routines: string[];
  /** Goal ids. The Goal entity is built in P2. */
  goals: string[];
  /** Free-form until ModelPolicy lands in P10. */
  modelPolicy: Record<string, any>;
  status: AgentStatusType;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProfileVersion {
  profileId: string;
  version: number;
  snapshot: AgentProfile;
  changedBy: string;
  createdAt: number;
}
