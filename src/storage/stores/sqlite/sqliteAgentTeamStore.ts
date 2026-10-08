import { Database } from 'sqlite';
import { AgentTeam, AgentTeamStore } from '../types.js';

function rowToTeam(row: any): AgentTeam {
  return {
    id: row.id,
    name: row.name,
    justification: row.justification,
    leadAgentId: row.lead_agent_id,
    memberAgentIds: row.member_agent_ids ? JSON.parse(row.member_agent_ids) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteAgentTeamStore implements AgentTeamStore {
  constructor(private db: Database) {}

  async save(team: AgentTeam): Promise<AgentTeam> {
    if (!team.justification || team.justification.trim().length === 0) {
      throw new Error('Team creation rejected: Multi-agent teams require a recorded specialization justification.');
    }

    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO agent_teams (
        id, name, justification, lead_agent_id, member_agent_ids,
        metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM agent_teams WHERE id = ?), ?), ?)`,
      team.id,
      team.name,
      team.justification,
      team.leadAgentId,
      JSON.stringify(team.memberAgentIds || []),
      team.metadata ? JSON.stringify(team.metadata) : null,
      team.id,
      team.createdAt || now,
      now
    );

    return (await this.get(team.id))!;
  }

  async get(id: string): Promise<AgentTeam | null> {
    const row = await this.db.get(`SELECT * FROM agent_teams WHERE id = ?`, id);
    return row ? rowToTeam(row) : null;
  }

  async list(): Promise<AgentTeam[]> {
    const rows = await this.db.all(`SELECT * FROM agent_teams ORDER BY updated_at DESC`);
    return rows.map(rowToTeam);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM agent_teams WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
