import { Request, Response } from 'express';

export class GoalsController {
  constructor(private stores: any) {}

  listGoals = async (req: Request, res: Response): Promise<void> => {
    try {
      const wsId = req.query.workspaceId ? parseInt(String(req.query.workspaceId), 10) : undefined;
      const goals = await this.stores.goal.list({
        workspaceId: wsId,
        status: req.query.status,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
      });
      res.json({ goals, count: goals.length });
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
        status: 'pending',
        priority: req.body.priority || 'normal',
        progress: 0.0,
        dependencies: [],
        artifacts: [],
        budget: req.body.budget || {},
        workspaceId: req.auth?.workspaceId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      res.status(201).json(goal);
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
      res.json(goal);
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
