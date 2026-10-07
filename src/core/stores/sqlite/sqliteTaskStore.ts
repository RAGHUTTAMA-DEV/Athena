import { Database } from 'sqlite';
import { Task, TaskStatus, GoalPriority } from '../../goalTypes.js';
import { TaskStore } from '../types.js';

function rowToTask(row: any): Task {
  return {
    id: row.id,
    goalId: row.goal_id,
    parentTaskId: row.parent_task_id || null,
    title: row.title,
    description: row.description || undefined,
    status: row.status as TaskStatus,
    priority: (row.priority || 'normal') as GoalPriority,
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : [],
    assignedAgentId: row.assigned_agent_id || null,
    attempts: row.attempts !== undefined ? row.attempts : 0,
    maxAttempts: row.max_attempts !== undefined ? row.max_attempts : 3,
    result: row.result || null,
    error: row.error || null,
    recurring: row.recurring || null,
    delegated: Boolean(row.delegated),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteTaskStore implements TaskStore {
  constructor(private db: Database) {}

  async get(id: string): Promise<Task | null> {
    const row = await this.db.get(`SELECT * FROM tasks WHERE id = ?`, id);
    return row ? rowToTask(row) : null;
  }

  async save(task: Task): Promise<Task> {
    const now = Date.now();
    const createdAt = task.createdAt || now;
    const updatedAt = now;
    const savedTask: Task = {
      ...task,
      createdAt,
      updatedAt
    };

    await this.db.run(
      `INSERT OR REPLACE INTO tasks (
        id, goal_id, parent_task_id, title, description, status,
        priority, dependencies, assigned_agent_id, attempts,
        max_attempts, result, error, recurring, delegated,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      savedTask.id,
      savedTask.goalId,
      savedTask.parentTaskId || null,
      savedTask.title,
      savedTask.description || null,
      savedTask.status,
      savedTask.priority,
      JSON.stringify(savedTask.dependencies || []),
      savedTask.assignedAgentId || null,
      savedTask.attempts,
      savedTask.maxAttempts,
      savedTask.result || null,
      savedTask.error || null,
      savedTask.recurring || null,
      savedTask.delegated ? 1 : 0,
      savedTask.createdAt,
      savedTask.updatedAt
    );

    return savedTask;
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Cannot update non-existent task "${id}"`);
    }
    const merged: Task = {
      ...existing,
      ...updates,
      id: existing.id,
      goalId: existing.goalId,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    return this.save(merged);
  }

  async listByGoal(goalId: string): Promise<Task[]> {
    const rows = await this.db.all(
      `SELECT * FROM tasks WHERE goal_id = ? ORDER BY created_at ASC`,
      goalId
    );
    return rows.map(rowToTask);
  }

  async getReadyTasks(goalId: string): Promise<Task[]> {
    const allTasks = await this.listByGoal(goalId);
    const completedIds = new Set(
      allTasks.filter(t => t.status === 'completed').map(t => t.id)
    );

    return allTasks.filter(task => {
      if (task.status !== 'pending') return false;
      if (!task.dependencies || task.dependencies.length === 0) return true;
      return task.dependencies.every(depId => completedIds.has(depId));
    });
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM tasks WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
