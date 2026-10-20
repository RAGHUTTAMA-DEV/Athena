import { Request, Response } from 'express';

export class MultiagentController {
  constructor(private stores: any) {}

  listTeams = async (req: Request, res: Response): Promise<void> => {
    try {
      let teams: any[] = [];
      if (this.stores.agentTeam) {
        teams = await this.stores.agentTeam.list();
      }
      res.json({ teams, count: teams.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TEAMS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  createTeam = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.name || !req.body?.justification || !req.body?.leadAgentId || !req.body?.memberAgentIds) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields name, justification, leadAgentId, memberAgentIds are required', requestId: req.id }
        });
        return;
      }
      const id = `team_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const team = {
        id,
        name: req.body.name,
        justification: req.body.justification,
        leadAgentId: req.body.leadAgentId,
        memberAgentIds: req.body.memberAgentIds,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (this.stores.agentTeam) {
        await this.stores.agentTeam.save(team);
      }
      res.status(201).json(team);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TEAM_CREATE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getTeam = async (req: Request, res: Response): Promise<void> => {
    try {
      let team = null;
      if (this.stores.agentTeam) {
        team = await this.stores.agentTeam.get(req.params.id);
      }
      if (!team) {
        res.status(404).json({
          error: { code: 'TEAM_NOT_FOUND', message: `Team not found: ${req.params.id}`, requestId: req.id }
        });
        return;
      }
      res.json(team);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TEAM_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      let messages: any[] = [];
      if (this.stores.agentMessage && req.query.recipientId) {
        messages = await this.stores.agentMessage.listByRecipient(String(req.query.recipientId), {
          goalId: req.query.goalId ? String(req.query.goalId) : undefined,
          taskId: req.query.taskId ? String(req.query.taskId) : undefined
        });
      }
      res.json({ messages, count: messages.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MESSAGES_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  sendMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.senderId || !req.body?.recipientId || !req.body?.messageType || !req.body?.payload) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields senderId, recipientId, messageType, payload are required', requestId: req.id }
        });
        return;
      }
      const id = `a2a_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const msg = {
        id,
        senderId: req.body.senderId,
        recipientId: req.body.recipientId,
        messageType: req.body.messageType,
        payload: req.body.payload,
        goalId: req.body.goalId,
        taskId: req.body.taskId,
        status: 'delivered' as const,
        createdAt: Date.now()
      };
      if (this.stores.agentMessage) {
        await this.stores.agentMessage.save(msg);
      }
      res.status(201).json(msg);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MESSAGE_SEND_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
