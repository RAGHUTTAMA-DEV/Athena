import { Database } from 'sqlite';
import { Workspace, WorkspaceKind, Project } from '../../../identity/identityTypes.js';
import { WorkspaceStore, ProjectStore } from '../types.js';

function rowToWorkspace(row: any): Workspace {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as WorkspaceKind,
    rootPath: row.root_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    rootPath: row.root_path ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteWorkspaceStore implements WorkspaceStore {
  constructor(private db: Database) {}

  async get(id: number): Promise<Workspace | null> {
    const row = await this.db.get(`SELECT * FROM workspaces WHERE id = ?`, id);
    return row ? rowToWorkspace(row) : null;
  }

  async getByName(name: string): Promise<Workspace | null> {
    const row = await this.db.get(`SELECT * FROM workspaces WHERE name = ?`, name);
    return row ? rowToWorkspace(row) : null;
  }

  async list(): Promise<Workspace[]> {
    const rows = await this.db.all(`SELECT * FROM workspaces ORDER BY created_at ASC`);
    return rows.map(rowToWorkspace);
  }

  async save(workspace: Workspace): Promise<Workspace> {
    const now = Date.now();
    if (!workspace.id) {
      const result = await this.db.run(
        `INSERT INTO workspaces (name, kind, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        workspace.name,
        workspace.kind,
        workspace.rootPath,
        now,
        now
      );
      return { ...workspace, id: result.lastID!, createdAt: now, updatedAt: now };
    }
    await this.db.run(
      `UPDATE workspaces SET name = ?, kind = ?, root_path = ?, updated_at = ? WHERE id = ?`,
      workspace.name,
      workspace.kind,
      workspace.rootPath,
      now,
      workspace.id
    );
    return { ...workspace, updatedAt: now };
  }

  async delete(id: number): Promise<boolean> {
    try {
      const result = await this.db.run(`DELETE FROM workspaces WHERE id = ?`, id);
      return (result.changes ?? 0) > 0;
    } catch (err: any) {
      const projects = await this.db.get(`SELECT COUNT(*) as count FROM projects WHERE workspace_id = ?`, id);
      if (projects && projects.count > 0) {
        throw new Error(`Workspace ${id} still has ${projects.count} project(s) and cannot be deleted.`);
      }
      throw err;
    }
  }
}

export class SqliteProjectStore implements ProjectStore {
  constructor(private db: Database) {}

  async get(id: number): Promise<Project | null> {
    const row = await this.db.get(`SELECT * FROM projects WHERE id = ?`, id);
    return row ? rowToProject(row) : null;
  }

  async list(workspaceId?: number): Promise<Project[]> {
    if (workspaceId !== undefined) {
      const rows = await this.db.all(
        `SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at ASC`,
        workspaceId
      );
      return rows.map(rowToProject);
    }
    const rows = await this.db.all(`SELECT * FROM projects ORDER BY created_at ASC`);
    return rows.map(rowToProject);
  }

  async save(project: Project): Promise<Project> {
    const now = Date.now();
    if (!project.id) {
      const result = await this.db.run(
        `INSERT INTO projects (workspace_id, name, root_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        project.workspaceId,
        project.name,
        project.rootPath,
        now,
        now
      );
      return { ...project, id: result.lastID!, createdAt: now, updatedAt: now };
    }
    await this.db.run(
      `UPDATE projects SET workspace_id = ?, name = ?, root_path = ?, updated_at = ? WHERE id = ?`,
      project.workspaceId,
      project.name,
      project.rootPath,
      now,
      project.id
    );
    return { ...project, updatedAt: now };
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.run(`DELETE FROM projects WHERE id = ?`, id);
    return (result.changes ?? 0) > 0;
  }
}
