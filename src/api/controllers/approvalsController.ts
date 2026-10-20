import { Request, Response } from 'express';
import { ApprovalService } from '../services/approvalService.js';

export class ApprovalsController {
  constructor(
    private services: {
      approvalService: ApprovalService;
      stores: any;
    }
  ) {}

  listPending = async (req: Request, res: Response): Promise<void> => {
    try {
      const list = await this.services.stores.approval.listPending({
        runId: req.query.runId ? String(req.query.runId) : undefined,
        goalId: req.query.goalId ? String(req.query.goalId) : undefined,
        limit: req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
      });
      res.json({ pending: list, count: list.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'APPROVALS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getApproval = async (req: Request, res: Response): Promise<void> => {
    try {
      const item = await this.services.stores.approval.getRequest(req.params.approvalId);
      if (!item) {
        res.status(404).json({
          error: { code: 'APPROVAL_NOT_FOUND', message: `Approval not found: ${req.params.approvalId}`, requestId: req.id }
        });
        return;
      }
      res.json(item);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'APPROVAL_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  decide = async (req: Request, res: Response): Promise<void> => {
    try {
      const decisionResult = await this.services.approvalService.decide({
        approvalId: req.params.approvalId,
        status: req.body?.status,
        reason: req.body?.reason,
        modifiedParams: req.body?.modifiedParams
      });
      res.json({ success: true, approval: decisionResult });
    } catch (err: any) {
      if (err.statusCode === 409 || err.code === 'APPROVAL_ALREADY_RESOLVED' || err.message?.includes('already resolved') || err.message?.includes('expired')) {
        res.status(err.statusCode || 409).json({
          error: {
            code: err.code || 'APPROVAL_ALREADY_RESOLVED',
            message: err.message,
            requestId: req.id
          }
        });
        return;
      }
      res.status(err.statusCode || 400).json({
        error: {
          code: err.code || 'APPROVAL_DECISION_FAILED',
          message: err.message,
          requestId: req.id
        }
      });
    }
  };
}
