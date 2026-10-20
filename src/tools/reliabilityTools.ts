import { Tool, ToolContext } from '../runtime/types.js';
import { TaskVerificationEngine } from '../reliability/verificationEngine.js';
import { ApprovalEngine } from '../reliability/approvalEngine.js';
import { ArtifactStore, ApprovalStore } from '../storage/stores/types.js';

function getApprovalStore(context?: ToolContext): ApprovalStore | null {
  const memory = context?.memory as any;
  if (memory && typeof memory.getApprovalStore === 'function') {
    return memory.getApprovalStore();
  }
  return null;
}

function getArtifactStore(context?: ToolContext): ArtifactStore | null {
  const memory = context?.memory as any;
  if (memory && typeof memory.getArtifactStore === 'function') {
    return memory.getArtifactStore();
  }
  return null;
}

export const approvalRequestTool: Tool = {
  definition: {
    name: 'approvalRequest',
    description: 'Submit an action for Human-In-The-Loop approval when executing high-risk, destructive, or financial operations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Identifier of the action requiring approval (e.g. "fs:delete", "cmd:destructive", "financial:transfer").'
        },
        riskLevel: {
          type: 'STRING',
          description: 'Risk level assessment: "low", "medium", "high", or "critical".'
        },
        explanation: {
          type: 'STRING',
          description: 'Clear, human-readable explanation of why this action is necessary and what it affects.'
        },
        proposedAction: {
          type: 'OBJECT',
          description: 'Structured payload or parameters of the proposed action.'
        }
      },
      required: ['action', 'explanation']
    }
  },
  manifest: {
    name: 'approvalRequest',
    version: '1.0.0',
    description: 'Request human authorization for high-risk or destructive actions',
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['system']
  },
  execute: async (args: any, context?: ToolContext) => {
    const store = getApprovalStore(context);
    const engine = new ApprovalEngine(
      store || {
        createRequest: async (r) => r,
        getRequest: async () => null,
        resolveRequest: async () => null,
        listPending: async () => [],
        listAll: async () => []
      }
    );

    const evalResult = engine.evaluate({ action: args.action, params: args.proposedAction });
    const req = await engine.requestApproval(
      {
        action: args.action,
        params: args.proposedAction,
        runId: (context as any)?.runId,
        goalId: (context as any)?.goalId
      },
      {
        requiresApproval: true,
        riskLevel: (args.riskLevel as any) || evalResult.riskLevel,
        explanation: args.explanation || evalResult.explanation
      }
    );

    return {
      success: true,
      approvalId: req.id,
      status: req.status,
      riskLevel: req.riskLevel,
      explanation: req.explanation
    };
  }
};

export const artifactManageTool: Tool = {
  definition: {
    name: 'artifactManage',
    description: 'Create, update, version, or retrieve persistent deliverables and artifacts linked to runs and goals.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: '"save", "get", or "list".'
        },
        id: {
          type: 'STRING',
          description: 'Unique artifact ID (required for get or update).'
        },
        name: {
          type: 'STRING',
          description: 'Human-readable name of the artifact.'
        },
        type: {
          type: 'STRING',
          description: 'Type of artifact: "code", "document", "diff", "report", "dataset", or "config".'
        },
        contentText: {
          type: 'STRING',
          description: 'Text content of the artifact.'
        },
        filePath: {
          type: 'STRING',
          description: 'Disk file path where the artifact is located.'
        }
      },
      required: ['action']
    }
  },
  manifest: {
    name: 'artifactManage',
    version: '1.0.0',
    description: 'Manage versioned deliverables and artifacts in persistent storage',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['fs:read', 'fs:write']
  },
  execute: async (args: any, context?: ToolContext) => {
    const store = getArtifactStore(context);
    if (!store) {
      return { success: false, error: 'Artifact store is not available.' };
    }

    if (args.action === 'save') {
      const artId = args.id || `art_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const saved = await store.saveArtifact({
        id: artId,
        name: args.name || 'Untitled Artifact',
        type: args.type || 'document',
        mimeType: args.type === 'code' ? 'text/typescript' : 'text/markdown',
        contentHash: '',
        contentText: args.contentText,
        filePath: args.filePath,
        runId: (context as any)?.runId,
        goalId: (context as any)?.goalId,
        createdAt: Date.now()
      });
      return {
        success: true,
        artifact: saved
      };
    }

    if (args.action === 'get') {
      if (!args.id) return { success: false, error: 'Missing artifact id' };
      const art = await store.getArtifact(args.id);
      return {
        success: !!art,
        artifact: art
      };
    }

    if (args.action === 'list') {
      const list = await store.listArtifacts({
        type: args.type,
        runId: (context as any)?.runId,
        goalId: (context as any)?.goalId
      });
      return {
        success: true,
        artifacts: list
      };
    }

    return { success: false, error: `Unsupported action "${args.action}"` };
  }
};

export const verificationInspectTool: Tool = {
  definition: {
    name: 'verificationInspect',
    description: 'Execute task-type verification gate (file, page, test_build, sources, delivery, or state) to validate work quality.',
    parameters: {
      type: 'OBJECT',
      properties: {
        taskType: {
          type: 'STRING',
          description: '"file_verified", "page_inspected", "test_build", "sources_checked", "delivery_result", or "resulting_state".'
        },
        expectedOutcome: {
          type: 'STRING',
          description: 'Expected outcome criteria string.'
        },
        evidence: {
          type: 'OBJECT',
          description: 'Evidence payload supporting the verification.'
        },
        options: {
          type: 'OBJECT',
          description: 'Verification options (e.g. filePath, url, domElements, exitCode, minSources).'
        }
      },
      required: ['taskType', 'expectedOutcome']
    }
  },
  manifest: {
    name: 'verificationInspect',
    version: '1.0.0',
    description: 'Execute structured verification across task categories',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['fs:read']
  },
  execute: async (args: any) => {
    const engine = new TaskVerificationEngine();
    const result = await engine.verify({
      taskType: args.taskType,
      expectedOutcome: args.expectedOutcome,
      evidence: args.evidence || {},
      options: args.options || {}
    });

    return {
      success: result.passed,
      score: result.score,
      summary: result.evidenceSummary,
      failureReasons: result.failureReasons,
      repairPlan: result.repairPlan
    };
  }
};
