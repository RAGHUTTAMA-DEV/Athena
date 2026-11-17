import { Database } from 'sqlite';
import { Workflow, WfRun, WfNodeOutput, WfRunStatus } from './types.js';
import { validateWorkflow } from './validator.js';
import { WorkflowBlackboard } from './blackboard.js';
import { EventBus } from '../background/eventBus.js';

export class WorkflowRegistry {
  constructor(private db: Database) {}

  /**
   * Persists a validated workflow definition.
   * If a record for (id, version) already exists, it is an immutable error.
   */
  async save(wf: Workflow): Promise<void> {
    const validation = validateWorkflow(wf);
    if (!validation.valid) {
      throw new Error(`Cannot save invalid workflow '${wf?.id}': ${validation.errors.join('; ')}`);
    }

    const definitionJson = JSON.stringify(wf);
    const now = Date.now();

    await this.db.run(
      `INSERT INTO workflow_definitions (id, version, name, description, definition, created_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id, version) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         definition = excluded.definition`,
      wf.id,
      wf.version,
      wf.name,
      wf.description || null,
      definitionJson,
      now
    );

    // Emit live sync event across EventBus
    await EventBus.getInstance().publish(`workflow:updated:${wf.id}`, {
      workflowId: wf.id,
      version: wf.version,
      name: wf.name
    });
  }

  /**
   * Retrieves a workflow by id and optional version.
   * If version is omitted, the latest non-deleted version is returned.
   */
  async get(id: string, version?: number): Promise<Workflow | null> {
    let row: any;
    if (version !== undefined) {
      row = await this.db.get(
        `SELECT definition FROM workflow_definitions WHERE id = ? AND version = ? AND deleted_at IS NULL`,
        id,
        version
      );
    } else {
      row = await this.db.get(
        `SELECT definition FROM workflow_definitions WHERE id = ? AND deleted_at IS NULL ORDER BY version DESC LIMIT 1`,
        id
      );
    }

    if (!row) return null;
    return JSON.parse(row.definition);
  }

  /**
   * Lists the latest version of all active (non-deleted) workflows.
   */
  async list(): Promise<Array<{ id: string; name: string; version: number; description?: string }>> {
    const rows = await this.db.all(`
      SELECT d.id, d.name, d.version, d.description
      FROM workflow_definitions d
      INNER JOIN (
        SELECT id, MAX(version) AS max_v
        FROM workflow_definitions
        WHERE deleted_at IS NULL
        GROUP BY id
      ) latest ON d.id = latest.id AND d.version = latest.max_v
      WHERE d.deleted_at IS NULL
      ORDER BY d.name ASC
    `);

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      version: r.version,
      description: r.description || undefined
    }));
  }

  /**
   * Soft-deletes a workflow by setting deleted_at.
   */
  async delete(id: string): Promise<void> {
    await this.db.run(
      `UPDATE workflow_definitions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`,
      Date.now(),
      id
    );

    await EventBus.getInstance().publish(`workflow:deleted:${id}`, { workflowId: id });
  }

  // ── Run Tracking ────────────────────────────────────────────────────

  async saveRun(run: WfRun): Promise<void> {
    await this.db.run(
      `INSERT INTO workflow_runs (run_id, workflow_id, version, parent_run_id, inputs, status, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id) DO UPDATE SET
         status = excluded.status,
         error = excluded.error,
         finished_at = excluded.finished_at`,
      run.runId,
      run.workflowId,
      run.version,
      run.parentRunId || null,
      JSON.stringify(run.inputs || {}),
      run.status,
      run.error || null,
      run.startedAt,
      run.finishedAt || null
    );
  }

  async getRun(runId: string): Promise<WfRun | null> {
    const row = await this.db.get(`SELECT * FROM workflow_runs WHERE run_id = ?`, runId);
    if (!row) return null;

    const outputRows = await this.db.all(
      `SELECT * FROM workflow_node_outputs WHERE run_id = ?`,
      runId
    );

    const nodeOutputs: Record<string, WfNodeOutput> = {};
    for (const o of outputRows) {
      let output: any = undefined;
      if (o.output) {
        try {
          output = JSON.parse(o.output);
        } catch {
          output = o.output;
        }
      }
      nodeOutputs[o.node_id] = {
        nodeId: o.node_id,
        status: o.status,
        output,
        error: o.error || undefined,
        startedAt: o.started_at || undefined,
        finishedAt: o.finished_at || undefined
      };
    }

    return {
      runId: row.run_id,
      workflowId: row.workflow_id,
      version: row.version,
      parentRunId: row.parent_run_id || undefined,
      inputs: JSON.parse(row.inputs || '{}'),
      status: row.status as WfRunStatus,
      error: row.error || undefined,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      nodeOutputs
    };
  }

  async listRuns(workflowId: string, limit: number = 20): Promise<WfRun[]> {
    const rows = await this.db.all(
      `SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?`,
      workflowId,
      limit
    );

    const runs: WfRun[] = [];
    for (const r of rows) {
      runs.push({
        runId: r.run_id,
        workflowId: r.workflow_id,
        version: r.version,
        parentRunId: r.parent_run_id || undefined,
        inputs: JSON.parse(r.inputs || '{}'),
        status: r.status as WfRunStatus,
        error: r.error || undefined,
        startedAt: r.started_at,
        finishedAt: r.finished_at || undefined,
        nodeOutputs: {}
      });
    }
    return runs;
  }

  async updateNodeOutput(runId: string, nodeId: string, out: WfNodeOutput): Promise<void> {
    const serialized = out.output !== undefined
      ? (typeof out.output === 'string' ? out.output : JSON.stringify(out.output))
      : null;

    await this.db.run(
      `INSERT INTO workflow_node_outputs (run_id, node_id, status, output, error, started_at, finished_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, node_id) DO UPDATE SET
         status = excluded.status,
         output = excluded.output,
         error = excluded.error,
         started_at = excluded.started_at,
         finished_at = excluded.finished_at`,
      runId,
      nodeId,
      out.status,
      serialized,
      out.error || null,
      out.startedAt || null,
      out.finishedAt || null
    );
  }

  async getNodeOutput(runId: string, nodeId: string): Promise<WfNodeOutput | null> {
    const row = await this.db.get(
      `SELECT * FROM workflow_node_outputs WHERE run_id = ? AND node_id = ?`,
      runId,
      nodeId
    );
    if (!row) return null;

    let parsedOutput: any = undefined;
    if (row.output) {
      try {
        parsedOutput = JSON.parse(row.output);
      } catch {
        parsedOutput = row.output;
      }
    }

    return {
      nodeId: row.node_id,
      status: row.status,
      output: parsedOutput,
      error: row.error || undefined,
      startedAt: row.started_at || undefined,
      finishedAt: row.finished_at || undefined
    };
  }

  async getNodeOutputs(runId: string): Promise<Record<string, WfNodeOutput>> {
    const run = await this.getRun(runId);
    return run?.nodeOutputs || {};
  }

  getBlackboard(runId: string): WorkflowBlackboard {
    return new WorkflowBlackboard(this.db, runId);
  }
}
