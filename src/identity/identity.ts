import {
  AgentProfile,
  PermissionModel,
  ToolPermissionRule,
  UserAccount,
  Workspace
} from './identityTypes.js';

/**
 * Athena V2 — P1 identity helpers.
 *
 * The primary AgentProfile is seeded from SOUL.md. Rendering is a pure
 * function of the profile, so the assembled identity is identical across
 * restarts, model switches, and tool changes.
 */

export const DEFAULT_PROFILE_ID = 'athena-primary';
export const DEFAULT_USER_ID = 'user-primary';
export const DEFAULT_WORKSPACE_NAME = 'default';

export function seedAgentProfileFromSoul(soul: string, workspaceId: number | null = null): AgentProfile {
  const now = Date.now();
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Athena',
    version: 1,
    identity: soul.trim(),
    // Empty so a freshly seeded profile renders byte-identical to SOUL.md.
    role: '',
    personality: '',
    capabilities: [],
    permissions: { toolPermissions: [] },
    preferences: {},
    workspaceId,
    memoryScope: 'all',
    skills: [],
    routines: [],
    goals: [],
    modelPolicy: {},
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
}

/** Deterministic. Same profile in, same text out. Empty sections are omitted. */
export function renderProfileSoul(profile: AgentProfile): string {
  const lines: string[] = [profile.identity.trim()];
  if (profile.role) lines.push(`Role: ${profile.role}`);
  if (profile.personality) lines.push(`Personality: ${profile.personality}`);
  return lines.join('\n\n');
}

export function createDefaultUser(): UserAccount {
  const now = Date.now();
  return {
    id: DEFAULT_USER_ID,
    name: 'Owner',
    preferences: {},
    permissions: { toolPermissions: [] },
    relationships: { [`agent:${DEFAULT_PROFILE_ID}`]: 'owner-assistant' },
    routines: [],
    createdAt: now,
    updatedAt: now
  };
}

export function createDefaultWorkspace(rootPath: string): Workspace {
  const now = Date.now();
  return {
    id: 0,
    name: DEFAULT_WORKSPACE_NAME,
    kind: 'personal',
    rootPath,
    createdAt: now,
    updatedAt: now
  };
}

/**
 * User denies always outrank agent allows. Evaluation is first-match, so
 * the composed order is: user denies, agent denies, user confirmations,
 * agent confirmations, user allows, agent allows.
 */
export function composePermissionModels(
  agent: PermissionModel,
  user?: PermissionModel | null
): PermissionModel {
  const empty: PermissionModel = { toolPermissions: [] };
  const u = user || empty;
  const a = agent || empty;

  const isDeny = (r: ToolPermissionRule) => r.effect === 'deny';
  const isConfirm = (r: ToolPermissionRule) => r.effect === 'require_confirmation';
  const isAllow = (r: ToolPermissionRule) => r.effect === 'allow';

  const toolPermissions: ToolPermissionRule[] = [
    ...u.toolPermissions.filter(isDeny),
    ...a.toolPermissions.filter(isDeny),
    ...u.toolPermissions.filter(isConfirm),
    ...a.toolPermissions.filter(isConfirm),
    ...u.toolPermissions.filter(isAllow),
    ...a.toolPermissions.filter(isAllow)
  ];

  const fileWriteRoots = [...(a.fileWriteRoots || []), ...(u.fileWriteRoots || [])];

  const riskOrder: Record<string, number> = { safe: 0, confirm: 1, destructive: 2 };
  const maxRiskLevel = [a.maxRiskLevel, u.maxRiskLevel]
    .filter((r): r is NonNullable<typeof r> => r !== undefined)
    .sort((x, y) => riskOrder[x] - riskOrder[y])[0];

  const composed: PermissionModel = { toolPermissions };
  if (fileWriteRoots.length > 0) composed.fileWriteRoots = fileWriteRoots;
  if (maxRiskLevel) composed.maxRiskLevel = maxRiskLevel;
  return composed;
}

/** True when the model adds no constraint beyond V1 default-allow. */
export function isEmptyPermissionModel(model: PermissionModel | null | undefined): boolean {
  if (!model) return true;
  return model.toolPermissions.length === 0
    && (!model.fileWriteRoots || model.fileWriteRoots.length === 0)
    && !model.maxRiskLevel;
}
