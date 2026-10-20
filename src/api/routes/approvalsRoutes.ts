import { Router } from 'express';
import { ApprovalService } from '../services/approvalService.js';
import { ApprovalsController } from '../controllers/approvalsController.js';

export function registerApprovalsRoutes(
  app: Router,
  services: { approvalService: ApprovalService; stores: any }
) {
  const controller = new ApprovalsController(services);

  app.get('/api/v1/approvals/pending', controller.listPending);
  app.get('/api/v1/approvals/:approvalId', controller.getApproval);
  app.post('/api/v1/approvals/:approvalId/decision', controller.decide);
}
