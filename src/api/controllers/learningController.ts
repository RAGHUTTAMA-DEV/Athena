import { Request, Response } from 'express';

export class LearningController {
  constructor(private stores: any) {}

  listSkills = async (req: Request, res: Response): Promise<void> => {
    try {
      let skills: any[] = [];
      if (this.stores.skill) {
        skills = await this.stores.skill.list();
      }
      res.json({ skills, count: skills.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'SKILLS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listWorkflows = async (req: Request, res: Response): Promise<void> => {
    try {
      let workflows: any[] = [];
      if (this.stores.learnedWorkflow) {
        workflows = await this.stores.learnedWorkflow.list({ status: req.query.status });
      }
      res.json({ workflows, count: workflows.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'WORKFLOWS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  reviewWorkflow = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.status) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "status" is required', requestId: req.id }
        });
        return;
      }
      if (this.stores.learnedWorkflow) {
        await this.stores.learnedWorkflow.updateStatus(req.params.id, req.body.status, {
          notes: req.body.notes,
          reviewedBy: 'user'
        });
        res.json({ success: true, workflowId: req.params.id, status: req.body.status });
        return;
      }
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Workflow store unavailable', requestId: req.id } });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'WORKFLOW_REVIEW_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listRoutines = async (req: Request, res: Response): Promise<void> => {
    try {
      let routines: any[] = [];
      if (this.stores.routine) {
        routines = await this.stores.routine.list();
      }
      res.json({ routines, count: routines.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'ROUTINES_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  createRoutine = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.name || !req.body?.triggerType || !req.body?.triggerConfig || !req.body?.workflow) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields name, triggerType, triggerConfig, workflow are required', requestId: req.id }
        });
        return;
      }
      const id = `routine_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const routine = {
        id,
        name: req.body.name,
        triggerType: req.body.triggerType,
        triggerConfig: req.body.triggerConfig,
        workflow: req.body.workflow,
        enabled: true,
        successRate: 0.0,
        invocations: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (this.stores.routine) {
        await this.stores.routine.save(routine);
      }
      res.status(201).json(routine);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'ROUTINE_CREATE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
