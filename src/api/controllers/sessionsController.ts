import { Request, Response } from 'express';
import { DispatchService } from '../services/dispatchService.js';
import { HydrationService } from '../services/hydrationService.js';
import { SSEManager } from '../events/sseManager.js';

function isSubagentSession(sessionId: string): boolean {
  return sessionId.includes('_sub_') || sessionId.startsWith('sub_');
}

function extractTextFromContent(raw: string): string {
  try {
    const parts = JSON.parse(raw);
    if (Array.isArray(parts)) {
      return parts.map((p: any) => p?.text || '').filter(Boolean).join('\n');
    }
    return typeof parts === 'string' ? parts : JSON.stringify(parts);
  } catch {
    return String(raw || '');
  }
}

export class SessionsController {
  constructor(
    private services: {
      dispatch: DispatchService;
      hydration: HydrationService;
      sse: SSEManager;
      stores: any;
      storage?: any;
      agent?: any;
    }
  ) {}

  submitMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
      const result = await this.services.dispatch.submitMessage({
        sessionId: req.params.sessionId,
        content: req.body?.content,
        idempotencyKey,
        attachments: req.body?.attachments,
        metadata: req.body?.metadata,
        workspaceId: req.auth?.workspaceId
      });
      res.status(result.isDuplicate ? 200 : 202).json(result);
    } catch (err: any) {
      res.status(400).json({
        error: {
          code: 'DISPATCH_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };

  getState = async (req: Request, res: Response): Promise<void> => {
    try {
      const state = await this.services.hydration.getSessionState(req.params.sessionId);
      res.json(state);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'HYDRATION_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };

  getMessages = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.params.sessionId;
      const runs = await this.services.stores.run.list(sessionId, 200);
      const sortedRuns = [...runs].sort((a, b) => a.createdAt - b.createdAt);

      let epRows: any[] = [];
      if (this.services.storage?.sqliteDb) {
        try {
          epRows = await this.services.storage.sqliteDb.all(
            `SELECT id, role, content, timestamp FROM episodic_memory WHERE session_id = ? ORDER BY timestamp ASC, id ASC LIMIT 300`,
            sessionId
          );
        } catch {}
      }

      const messages: any[] = [];

      // Case 1: Episodic memory has turns that are missing from runs (e.g., CLI or mixed sessions)
      if (epRows.length > 0 && (sortedRuns.length === 0 || epRows.length > sortedRuns.length * 2)) {
        for (const row of epRows) {
          const text = extractTextFromContent(row.content);
          if (text.trim()) {
            messages.push({
              id: `ep_${row.id}`,
              sender: row.role === 'user' ? 'user' : 'agent',
              senderName: row.role === 'user' ? 'You' : 'Athena',
              content: text,
              timestamp: row.timestamp,
              status: 'completed'
            });
          }
        }

        // Also append any active/in-progress/recent runs not yet saved to episodic_memory
        for (const run of sortedRuns) {
          const alreadyHasTask = messages.some(
            (m) => m.sender === 'user' && m.content.trim() === String(run.task || '').trim()
          );
          if (!alreadyHasTask && run.task) {
            messages.push({
              id: `msg_user_${run.runId}`,
              sender: 'user',
              content: run.task,
              timestamp: run.createdAt,
              runId: run.runId
            });
            if (run.result || run.error || ['running', 'queued', 'approval_required'].includes(run.status)) {
              messages.push({
                id: `msg_agent_${run.runId}`,
                sender: 'agent',
                senderName: 'Athena',
                content: run.result || '',
                error: run.error,
                status: run.status,
                timestamp: run.updatedAt || run.createdAt,
                runId: run.runId
              });
            }
          }
        }
      } else {
        // Case 2: Reconstruct rich turns from runs + run_events + approvals
        for (const run of sortedRuns) {
          if (run.task) {
            messages.push({
              id: `msg_user_${run.runId}`,
              sender: 'user',
              content: run.task,
              timestamp: run.createdAt,
              runId: run.runId
            });
          }

          let toolCalls: any[] = [];
          let flowSteps: any[] = [];
          try {
            if (this.services.stores.event?.getRunEvents) {
              const events = await this.services.stores.event.getRunEvents(run.runId);
              for (const ev of events) {
                if (ev.type === 'turn_start') {
                  flowSteps.push({
                    id: `ev_${ev.timestamp}_turn_${ev.turn}`,
                    kind: 'Thinking',
                    title: `Turn ${ev.turn}/${ev.maxTurns}`,
                    status: 'done',
                    timestamp: ev.timestamp
                  });
                } else if (ev.type === 'thought') {
                  flowSteps.push({
                    id: `ev_${ev.timestamp}_thought`,
                    kind: 'Thinking',
                    title: ev.text || 'Thinking...',
                    status: 'done',
                    timestamp: ev.timestamp
                  });
                } else if (ev.type === 'plan_created') {
                  flowSteps.push({
                    id: `ev_${ev.timestamp}_plan`,
                    kind: 'Thinking',
                    title: `Formulated plan with ${ev.totalSteps} steps`,
                    detail: Array.isArray(ev.steps) ? ev.steps.map((s: any) => s.description).join(' ➔ ') : undefined,
                    status: 'done',
                    timestamp: ev.timestamp
                  });
                } else if (ev.type === 'tool_call') {
                  const tc = {
                    tool: ev.toolName || 'tool',
                    args: ev.args,
                    status: 'running' as const
                  };
                  toolCalls.push(tc);
                  flowSteps.push({
                    id: `ev_${ev.callId || ev.timestamp}_${ev.toolName}`,
                    kind: 'Tool',
                    tool: ev.toolName || 'tool',
                    title: ev.toolName || 'tool',
                    args: ev.args,
                    status: 'running',
                    timestamp: ev.timestamp
                  });
                } else if (ev.type === 'tool_result') {
                  const matchIdx = toolCalls.findIndex(
                    (t) => t.tool === (ev.toolName || t.tool) && t.status === 'running'
                  );
                  const target = matchIdx >= 0 ? toolCalls[matchIdx] : toolCalls[toolCalls.length - 1];
                  if (target) {
                    target.status = ev.success === false ? 'failed' : 'completed';
                    target.result = ev.resultSummary || ev.result || '';
                    target.durationMs = ev.durationMs;
                  }
                  const flowMatchIdx = flowSteps.findIndex(
                    (f) => f.tool === (ev.toolName || f.tool) && f.status === 'running'
                  );
                  const flowTarget = flowMatchIdx >= 0 ? flowSteps[flowMatchIdx] : undefined;
                  if (flowTarget) {
                    flowTarget.status = ev.success === false ? 'failed' : 'completed';
                    flowTarget.result = ev.result !== undefined ? ev.result : (ev.resultSummary || ev.error || '');
                    flowTarget.durationMs = ev.durationMs;
                  }
                }
              }
            }
          } catch {}

          let runApprovals: any[] = [];
          try {
            if (this.services.stores.approval?.listAll) {
              runApprovals = await this.services.stores.approval.listAll({ runId: run.runId, limit: 20 });
            }
          } catch {}

          const hasAgentOutput =
            run.result ||
            run.error ||
            toolCalls.length > 0 ||
            flowSteps.length > 0 ||
            runApprovals.length > 0 ||
            ['running', 'queued', 'waiting', 'approval_required', 'planning'].includes(run.status);

          if (hasAgentOutput) {
            messages.push({
              id: `msg_agent_${run.runId}`,
              sender: 'agent',
              senderName: 'Athena',
              content: run.result || '',
              error: run.error,
              status: run.status,
              timestamp: run.updatedAt || run.createdAt,
              runId: run.runId,
              toolCalls,
              flowSteps,
              approvals: runApprovals
            });
          }
        }
      }

      res.json({ sessionId, messages });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'MESSAGES_FETCH_FAILED',
          message: err.message,
          requestId: req.id
        }
      });
    }
  };

  getEvents = async (req: Request, res: Response): Promise<void> => {
    const lastEventId = (req.headers['last-event-id'] || req.query.lastEventId) as string | undefined;
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.services.sse.registerClient(clientId, res, {
      sessionId: req.params.sessionId,
      lastEventId
    });
  };

  listSessions = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionMap = new Map<string, any>();

      // 1. Load sessions from episodic_memory (captures CLI, Telegram, and all persisted chats)
      if (this.services.storage?.sqliteDb) {
        try {
          const epRows = await this.services.storage.sqliteDb.all(
            `SELECT session_id, MAX(timestamp) as last_ts, COUNT(*) as msg_count,
             (SELECT content FROM episodic_memory e2 WHERE e2.session_id = e1.session_id AND e2.role = 'user' ORDER BY timestamp ASC, id ASC LIMIT 1) as first_msg
             FROM episodic_memory e1
             GROUP BY session_id
             ORDER BY last_ts DESC
             LIMIT 100`
          );
          for (const row of epRows) {
            if (isSubagentSession(row.session_id)) continue;
            let title = row.session_id;
            if (row.first_msg) {
              const txt = extractTextFromContent(row.first_msg).trim();
              if (txt) title = txt.slice(0, 60);
            }
            sessionMap.set(row.session_id, {
              sessionId: row.session_id,
              title,
              lastActiveAt: row.last_ts,
              runCount: Math.max(1, Math.ceil(row.msg_count / 2)),
              latestStatus: 'completed'
            });
          }
        } catch {}
      }

      // 2. Merge runs (captures active, queued, failed, or web-only sessions)
      const runs = await this.services.stores.run.list(undefined, 300);
      // Iterate oldest-to-newest to pick earliest prompt as fallback title, while updating latest timestamp/status
      const chronological = [...runs].sort((a, b) => a.createdAt - b.createdAt);
      for (const r of chronological) {
        if (r.parentRunId || isSubagentSession(r.sessionId)) continue;
        const existing = sessionMap.get(r.sessionId);
        if (!existing) {
          sessionMap.set(r.sessionId, {
            sessionId: r.sessionId,
            title: r.task ? String(r.task).slice(0, 60) : r.sessionId,
            lastActiveAt: r.updatedAt || r.createdAt,
            runCount: 1,
            latestRunId: r.runId,
            latestStatus: r.status
          });
        } else {
          if (existing.title === r.sessionId && r.task) {
            existing.title = String(r.task).slice(0, 60);
          }
          existing.lastActiveAt = Math.max(Number(existing.lastActiveAt) || 0, Number(r.updatedAt || r.createdAt) || 0);
          existing.latestRunId = r.runId;
          existing.latestStatus = r.status;
        }
      }

      const sessions = Array.from(sessionMap.values())
        .sort((a, b) => (Number(b.lastActiveAt) || 0) - (Number(a.lastActiveAt) || 0))
        .slice(0, 50);

      res.json({ sessions });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'SESSIONS_FETCH_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };
}
