import { Database } from 'sqlite';
import { Goal, GoalStatus, createInitialGoalUsage } from '../../../autonomy/goalTypes.js';
import { GoalStore } from '../types.js';

function rowToGoal(row: any): Goal {
  return {
    id: row.id,
    workspaceId: row.workspace_id !== null ? row.workspace_id : null,
    projectId: row.project_id !== null ? row.project_id : null,
    title: row.title,
    description: row.description || undefined,
    status: row.status as GoalStatus,
    priority: row.priority || 'normal',
    deadline: row.deadline !== null ? row.deadline : null,
    progress: row.progress !== null ? row.progress : 0.0,
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    artifacts: row.artifacts ? JSON.parse(row.artifacts) : [],
    budget: row.budget ? JSON.parse(row.budget) : {},
    usage: row.usage ? JSON.parse(row.usage) : createInitialGoalUsage(),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteGoalStore implements GoalStore {
  constructor(private db: Database) {}

  async get(id: string): Promise<Goal | null> {
    const row = await this.db.get(`SELECT * FROM goals WHERE id = ?`, id);
    return row ? rowToGoal(row) : null;
  }

  async save(goal: Goal): Promise<Goal> {
    const now = Date.now();
    const createdAt = goal.createdAt || now;
    const updatedAt = now;
    const savedGoal: Goal = {
      ...goal,
      createdAt,
      updatedAt
    };

    await this.db.run(
      `INSERT OR REPLACE INTO goals (
        id, workspace_id, project_id, title, description, status,
        priority, deadline, progress, dependencies, artifacts, budget,
        usage, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      savedGoal.id,
      savedGoal.workspaceId !== undefined ? savedGoal.workspaceId : null,
      savedGoal.projectId !== undefined ? savedGoal.projectId : null,
      savedGoal.title,
      savedGoal.description || null,
      savedGoal.status,
      savedGoal.priority,
      savedGoal.deadline !== undefined ? savedGoal.deadline : null,
      savedGoal.progress,
      JSON.stringify(savedGoal.dependencies || []),
      JSON.stringify(savedGoal.artifacts || []),
      JSON.stringify(savedGoal.budget || {}),
      JSON.stringify(savedGoal.usage || createInitialGoalUsage()),
      savedGoal.metadata ? JSON.stringify(savedGoal.metadata) : null,
      savedGoal.createdAt,
      savedGoal.updatedAt
    );

    return savedGoal;
  }

  async update(id: string, updates: Partial<Goal>): Promise<Goal> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Cannot update non-existent goal "${id}"`);
    }
    const merged: Goal = {
      ...existing,
      ...updates,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    return this.save(merged);
  }

  async list(filter?: { workspaceId?: number; status?: GoalStatus; limit?: number }): Promise<Goal[]> {
    let query = `SELECT * FROM goals`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.workspaceId !== undefined) {
      conditions.push(`workspace_id = ?`);
      params.push(filter.workspaceId);
    }
    if (filter?.status !== undefined) {
      conditions.push(`status = ?`);
      params.push(filter.status);
    }
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY created_at DESC`;
    if (filter?.limit) {
      query += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const rows = await this.db.all(query, ...params);
    return rows.map(rowToGoal);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM goals WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
