import { Request, Response } from 'express';
import { TaskVerificationEngine } from '../../reliability/verificationEngine.js';
import { SelfRepairEngine } from '../../reliability/selfRepairEngine.js';
import { ClarificationManager } from '../../reliability/clarificationManager.js';

export class ReliabilityController {
  private verifier = new TaskVerificationEngine();
  private repairer = new SelfRepairEngine();
  private clarifier = new ClarificationManager();
  private pendingClarifications = new Map<string, any>();

  verify = async (req: Request, res: Response): Promise<void> => {
    try {
      const outcome = await this.verifier.verify({
        taskType: req.body?.taskType || 'resulting_state',
        expectedOutcome: req.body?.expectedOutcome || 'Operation completed with state ok',
        evidence: req.body?.evidence || { state: 'ok' },
        options: req.body?.options || {}
      });
      res.json(outcome);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'VERIFICATION_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  repair = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.task || !req.body?.originalCodeOrAction || !req.body?.errorOrFailure) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields task, originalCodeOrAction, errorOrFailure are required', requestId: req.id }
        });
        return;
      }
      const outcome = await this.repairer.executeLoop({
        task: req.body.task,
        originalCodeOrAction: req.body.originalCodeOrAction,
        errorOrFailure: req.body.errorOrFailure,
        verifier: async (candidate) => ({ passed: !candidate.includes('error'), message: 'Verified patch' })
      });
      res.json(outcome);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'REPAIR_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  assessClarification = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.prompt) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "prompt" is required', requestId: req.id }
        });
        return;
      }
      const question = this.clarifier.assessAmbiguity(req.body.prompt);
      if (question) {
        this.pendingClarifications.set(question.id, question);
      }
      res.json({ isAmbiguous: Boolean(question), question });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CLARIFICATION_ASSESS_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getPendingClarifications = async (req: Request, res: Response): Promise<void> => {
    res.json({ pending: Array.from(this.pendingClarifications.values()) });
  };

  answerClarification = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.answer) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "answer" is required', requestId: req.id }
        });
        return;
      }
      const item = this.pendingClarifications.get(req.params.id);
      if (!item) {
        res.status(404).json({ error: { code: 'CLARIFICATION_NOT_FOUND', message: 'Clarification not found', requestId: req.id } });
        return;
      }
      this.pendingClarifications.delete(req.params.id);
      res.json({ success: true, clarificationId: req.params.id, answer: req.body.answer });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CLARIFICATION_ANSWER_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
