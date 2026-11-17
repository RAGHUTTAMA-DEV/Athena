import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { WorkflowRegistry } from '../../workflows/registry.js';
import { WorkflowExecutor } from '../../workflows/executor.js';
import { WorkflowTriggerAdapter } from '../../workflows/triggerAdapter.js';
import { validateWorkflow } from '../../workflows/validator.js';
import { SSEManager } from '../events/sseManager.js';
import { Workflow } from '../../workflows/types.js';

export interface WorkflowServices {
  registry: WorkflowRegistry;
  executor: WorkflowExecutor;
  triggerAdapter?: WorkflowTriggerAdapter;
  sseManager?: SSEManager;
}

export function registerWorkflowRoutes(app: Router, services: WorkflowServices) {
  const { registry, executor, triggerAdapter, sseManager } = services;

  /**
   * GET /api/v1/workflows
   * List all saved workflows.
   */
  app.get('/api/v1/workflows', async (req: Request, res: Response) => {
    try {
      const workflows = await registry.list();
      res.json({ workflows });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/workflows/templates
   * List all built-in starter templates from templates/ folder.
   */
  app.get('/api/v1/workflows/templates', async (_req: Request, res: Response) => {
    try {
      const templatesDir = path.resolve(process.cwd(), 'templates');
      if (!fs.existsSync(templatesDir)) {
        return res.json({ templates: [] });
      }

      const files = await fs.promises.readdir(templatesDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      const templates = [];
      for (const file of jsonFiles) {
        try {
          const content = await fs.promises.readFile(path.join(templatesDir, file), 'utf-8');
          const parsed = JSON.parse(content);
          templates.push(parsed);
        } catch {}
      }

      res.json({ templates });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/workflows/templates/:id/instantiate
   * Instantiates a template into active workflows with optional custom id/name.
   */
  app.post('/api/v1/workflows/templates/:id/instantiate', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const templatesDir = path.resolve(process.cwd(), 'templates');
      const files = await fs.promises.readdir(templatesDir);
      let foundTemplate: any = null;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fs.promises.readFile(path.join(templatesDir, file), 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.id === id || file === `${id}.json`) {
          foundTemplate = parsed;
          break;
        }
      }

      if (!foundTemplate) {
        return res.status(404).json({ error: { message: `Template "${id}" not found` } });
      }

      const newId = req.body?.id || `${foundTemplate.id}-${Date.now().toString(36).substring(2, 6)}`;
      const newName = req.body?.name || foundTemplate.name;

      const instanceWf: Workflow = {
        ...foundTemplate,
        id: newId,
        name: newName,
        version: 1
      };

      const validation = validateWorkflow(instanceWf);
      if (!validation.valid) {
        return res.status(400).json({ error: { message: 'Template validation failed', details: validation.errors } });
      }

      await registry.save(instanceWf);
      const saved = await registry.get(newId);
      res.status(201).json({ workflow: saved });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/workflows
   * Create and register a new workflow.
   */
  app.post('/api/v1/workflows', async (req: Request, res: Response) => {
    try {
      const wf = req.body as Workflow;
      if (!wf || !wf.id || !wf.name) {
        return res.status(400).json({ error: { message: 'Missing required fields "id" and "name"' } });
      }

      wf.version = wf.version || 1;
      wf.inputs = wf.inputs || {};
      wf.settings = wf.settings || { maxTurns: 15 };

      // Validate topology and syntax
      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return res.status(400).json({
          error: {
            message: 'Workflow validation failed',
            details: { errors: validation.errors }
          }
        });
      }

      await registry.save(wf);
      const saved = await registry.get(wf.id);

      res.status(201).json({ workflow: saved });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/workflows/:id
   * Retrieve a specific workflow definition by id.
   */
  app.get('/api/v1/workflows/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const wf = await registry.get(id);
      if (!wf) {
        return res.status(404).json({ error: { message: `Workflow "${id}" not found` } });
      }
      res.json({ workflow: wf });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * PUT /api/v1/workflows/:id
   * Update an existing workflow definition.
   */
  app.put('/api/v1/workflows/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await registry.get(id);

      const wf = {
        ...req.body,
        id,
        version: existing?.version ? existing.version + 1 : (req.body?.version || 1),
        inputs: req.body?.inputs || existing?.inputs || {},
        settings: req.body?.settings || existing?.settings || { maxTurns: 15 },
      } as Workflow;

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return res.status(400).json({
          error: {
            message: 'Workflow validation failed',
            details: { errors: validation.errors }
          }
        });
      }

      await registry.save(wf);
      const updated = await registry.get(id);

      res.json({ workflow: updated });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * DELETE /api/v1/workflows/:id
   * Delete a workflow definition.
   */
  app.delete('/api/v1/workflows/:id', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const existing = await registry.get(id);
      if (!existing) {
        return res.status(404).json({ error: { message: `Workflow "${id}" not found` } });
      }

      await registry.delete(id);
      res.json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/workflows/:id/run
   * Trigger execution of a workflow.
   */
  app.post('/api/v1/workflows/:id/run', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      let wf = await registry.get(id);

      // If workflow not found in SQLite yet but client sent payload, save it on the fly
      if (!wf && req.body?.workflow) {
        const candidate = {
          ...req.body.workflow,
          id,
          version: req.body.workflow.version || 1,
          inputs: req.body.workflow.inputs || {},
          settings: req.body.workflow.settings || { maxTurns: 15 }
        } as Workflow;

        const val = validateWorkflow(candidate);
        if (val.valid) {
          await registry.save(candidate);
          wf = await registry.get(id);
        }
      }

      if (!wf) {
        return res.status(404).json({ error: { message: `Workflow "${id}" not found` } });
      }

      const inputs = req.body?.inputs || {};
      const sync = req.body?.sync === true;

      if (sync) {
        const run = await executor.execute(wf, inputs);
        return res.json({
          runId: run.runId,
          status: run.status,
          error: run.error,
          run
        });
      }

      // Asynchronous execution
      const runPromise = executor.execute(wf, inputs);

      // Return fast with run tracking reference if synchronous start
      // Create initial run record or await microtask to capture run ID
      // To provide deterministic runId to caller:
      const runId = `wf_run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      // Start background execution
      executor.execute(wf, inputs, { runId }).catch(err => {
        console.error(`[WorkflowRunError] Async run ${runId} failed:`, err);
      });

      res.status(202).json({
        runId,
        status: 'running',
        workflowId: id
      });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/workflows/runs/:runId
   * Retrieve execution details and node outputs for a specific run.
   */
  app.get('/api/v1/workflows/runs/:runId', async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const run = await registry.getRun(runId);
      if (!run) {
        return res.status(404).json({ error: { message: `Workflow run "${runId}" not found` } });
      }

      const nodeOutputs = await registry.getNodeOutputs(runId);
      res.json({ run, nodeOutputs });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * POST /api/v1/workflows/runs/:runId/resume
   * Resume a paused workflow run waiting for human approval.
   */
  app.post('/api/v1/workflows/runs/:runId/resume', async (req: Request, res: Response) => {
    try {
      const { runId } = req.params;
      const { approved, notes } = req.body || {};

      if (approved === undefined) {
        return res.status(400).json({ error: { message: 'Missing required field "approved"' } });
      }

      await executor.resumeRun(runId, { approved: Boolean(approved), notes });
      res.json({ success: true, runId, approved: Boolean(approved) });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });

  /**
   * GET /api/v1/workflows/runs/:runId/events
   * SSE endpoint streaming real-time workflow events for a run.
   */
  app.get('/api/v1/workflows/runs/:runId/events', (req: Request, res: Response) => {
    const { runId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    if (sseManager) {
      const clientId = `wf_sse_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      sseManager.registerClient(clientId, res, { runId });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'connected', runId })}\n\n`);
    }
  });

  /**
   * Webhook ingestion endpoint that routes to matching workflow trigger nodes.
   * Handles POST /api/v1/webhooks/:path*
   */
  app.use('/api/v1/webhooks', async (req: Request, res: Response, next: Function) => {
    if (req.method !== 'POST') {
      return next();
    }
    try {
      if (!triggerAdapter) {
        return res.status(503).json({ error: { message: 'WorkflowTriggerAdapter is not enabled' } });
      }

      // Extract webhook subpath (e.g. /ci/deploy or /api/v1/webhooks/ci/deploy -> ci/deploy)
      const webhookPath = req.path
        .replace(/^\/api\/v1\/webhooks\/?/, '')
        .replace(/^\/+/, '');
      const payload = req.body || {};

      const result = await triggerAdapter.dispatchWebhook(webhookPath, payload);
      res.json({
        success: true,
        path: result.path,
        triggered: result.triggered
      });
    } catch (err: any) {
      res.status(500).json({ error: { message: err.message } });
    }
  });
}
