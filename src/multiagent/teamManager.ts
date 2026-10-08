import { AgentTeam, AgentTeamStore } from '../storage/stores/types.js';

export class TeamManager {
  constructor(private store: AgentTeamStore) {}

  /**
   * Create a team with mandatory specialization justification (Spec Section 32).
   */
  async createTeam(params: {
    id?: string;
    name: string;
    justification: string;
    leadAgentId: string;
    memberAgentIds: string[];
    metadata?: Record<string, any>;
  }): Promise<AgentTeam> {
    const trimmedJustification = params.justification ? params.justification.trim() : '';
    if (trimmedJustification.length < 15) {
      throw new Error(
        'Team creation rejected: Multi-agent teams require a substantive specialization justification explaining the distinct roles and benefits.'
      );
    }

    if (!Array.isArray(params.memberAgentIds) || params.memberAgentIds.length < 2) {
      throw new Error('Team creation rejected: A multi-agent team must consist of at least two specialized member agents.');
    }

    const teamId = params.id || `team_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const team: AgentTeam = {
      id: teamId,
      name: params.name,
      justification: trimmedJustification,
      leadAgentId: params.leadAgentId,
      memberAgentIds: params.memberAgentIds,
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return await this.store.save(team);
  }

  async getTeam(id: string): Promise<AgentTeam | null> {
    return await this.store.get(id);
  }

  async listTeams(): Promise<AgentTeam[]> {
    return await this.store.list();
  }

  async disbandTeam(id: string): Promise<boolean> {
    return await this.store.delete(id);
  }
}
