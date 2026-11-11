import { Request, Response } from 'express';
import { Planner } from '../../autonomy/orchestration.js';

export class GoalsController {
  constructor(private stores: any, private agent?: any) {}

  listGoals = async (req: Request, res: Response): Promise<void> => {
    try {
      const wsId = req.query.workspaceId ? parseInt(String(req.query.workspaceId), 10) : undefined;
      const goals = await this.stores.goal.list({
        workspaceId: wsId,
        status: req.query.status,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
      });

      const enriched = await Promise.all(
        goals.map(async (g: any) => {
          let tasks: any[] = [];
          try {
            if (this.stores.task?.listByGoal) {
              tasks = await this.stores.task.listByGoal(g.id);
            }
          } catch {}
          return { ...g, tasks };
        })
      );

      res.json({ goals: enriched, count: enriched.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOALS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  createGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.title) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "title" is required', requestId: req.id }
        });
        return;
      }
      const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const goal = await this.stores.goal.save({
        id,
        title: req.body.title,
        description: req.body.description,
        status: 'proposed',
        priority: req.body.priority || 'normal',
        progress: 0.0,
        dependencies: [],
        artifacts: [],
        budget: req.body.budget || {},
        workspaceId: req.auth?.workspaceId ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      res.status(201).json({ ...goal, tasks: [] });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_CREATE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const goal = await this.stores.goal.get(req.params.goalId);
      if (!goal) {
        res.status(404).json({
          error: { code: 'GOAL_NOT_FOUND', message: `Goal not found: ${req.params.goalId}`, requestId: req.id }
        });
        return;
      }
      let tasks: any[] = [];
      try {
        tasks = await this.stores.task.listByGoal(req.params.goalId);
      } catch {}
      res.json({ ...goal, tasks });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getGoalTasks = async (req: Request, res: Response): Promise<void> => {
    try {
      const tasks = await this.stores.task.listByGoal(req.params.goalId);
      res.json({ goalId: req.params.goalId, tasks, count: tasks.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TASKS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  planGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const goal = await this.stores.goal.get(req.params.goalId);
      if (!goal) {
        res.status(404).json({
          error: { code: 'GOAL_NOT_FOUND', message: `Goal not found: ${req.params.goalId}`, requestId: req.id }
        });
        return;
      }
      let tasks = await this.stores.task.listByGoal(goal.id);
      if (tasks.length === 0) {
        tasks = await Planner.planGoalToTasks(goal, this.stores.task);
      }
      const updated = await this.stores.goal.update(goal.id, { status: 'active' });
      res.json({ goal: updated, tasks });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_PLAN_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  executeGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const goal = await this.stores.goal.get(req.params.goalId);
      if (!goal) {
        res.status(404).json({
          error: { code: 'GOAL_NOT_FOUND', message: `Goal not found: ${req.params.goalId}`, requestId: req.id }
        });
        return;
      }
      if (!this.agent) {
        res.status(503).json({
          error: { code: 'AGENT_UNAVAILABLE', message: 'Agent runtime is not attached to execute goals', requestId: req.id }
        });
        return;
      }

      // Ensure tasks exist before returning 202
      let tasks = await this.stores.task.listByGoal(goal.id);
      if (tasks.length === 0) {
        tasks = await Planner.planGoalToTasks(goal, this.stores.task);
      }
      await this.stores.goal.update(goal.id, { status: 'active' });

      const sessionId = req.body?.sessionId || `goal_${goal.id}`;
      setImmediate(() => {
        this.agent.executeGoal(goal.id, { sessionId }).catch((err: any) => {
          console.error(`[GoalsController] Error executing goal ${goal.id}:`, err);
        });
      });

      res.status(202).json({
        goalId: goal.id,
        status: 'active',
        sessionId,
        tasksCount: tasks.length
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_EXECUTE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  pauseGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const goal = await this.stores.goal.update(req.params.goalId, { status: 'paused' });
      res.json({ success: true, goal });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_PAUSE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  resumeGoal = async (req: Request, res: Response): Promise<void> => {
    try {
      const goal = await this.stores.goal.update(req.params.goalId, { status: 'active' });
      res.json({ success: true, goal });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'GOAL_RESUME_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
