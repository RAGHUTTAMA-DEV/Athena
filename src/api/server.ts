import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as http from 'http';
import { InitializedStorage } from '../storage/storeFactory.js';
import { SSEManager } from './events/sseManager.js';
import { DispatchService } from './services/dispatchService.js';
import { HydrationService } from './services/hydrationService.js';
import { ApprovalService } from './services/approvalService.js';
import { ArtifactService } from './services/artifactService.js';
import { AttachmentService } from './services/attachmentService.js';
import { authMiddleware } from './auth.js';
import { athenaOpenApiSpec, renderSwaggerUiHtml } from './openApiSpec.js';

// Route registrations
import { registerSessionsRoutes } from './routes/sessionsRoutes.js';
import { registerRunsRoutes } from './routes/runsRoutes.js';
import { registerApprovalsRoutes } from './routes/approvalsRoutes.js';
import { registerArtifactsRoutes } from './routes/artifactsRoutes.js';
import { registerGoalsRoutes } from './routes/goalsRoutes.js';
import { registerHarnessRoutes } from './routes/harnessRoutes.js';
import { registerComputerRoutes } from './routes/computerRoutes.js';
import { registerBrowserRoutes } from './routes/browserRoutes.js';
import { registerResearchRoutes } from './routes/researchRoutes.js';
import { registerMultiagentRoutes } from './routes/multiagentRoutes.js';
import { registerLearningRoutes } from './routes/learningRoutes.js';
import { registerCommunicationRoutes } from './routes/communicationRoutes.js';
import { registerProactiveRoutes } from './routes/proactiveRoutes.js';
import { registerReliabilityRoutes } from './routes/reliabilityRoutes.js';
import { registerToolsRoutes } from './routes/toolsRoutes.js';
import { registerIntelligenceRoutes } from './routes/intelligenceRoutes.js';
import { registerSystemRoutes } from './routes/systemRoutes.js';
import { registerWorkflowRoutes, WorkflowServices } from './routes/workflowRoutes.js';
import { WorkflowRegistry } from '../workflows/registry.js';
import { WorkflowExecutor } from '../workflows/executor.js';
import { WorkflowTriggerAdapter } from '../workflows/triggerAdapter.js';
import { CredentialVault } from '../workflows/integrations/credentialVault.js';
import { createOAuthRouter } from '../workflows/integrations/oauthRouter.js';
import { AgentRunner } from './services/dispatchService.js';
import { AgentEventEmitter } from '../runtime/events.js';
import { Agent } from '../runtime/agent.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';
import { ToolExecutor } from '../tools/toolRuntime.js';
import { registerWorkflowTools } from '../tools/index.js';

export interface ServerOptions {
  storage: InitializedStorage;
  agent?: any;
  agentRunner?: AgentRunner;
  port?: number;
  host?: string;
  corsOrigin?: string | string[] | boolean;
  apiKey?: string;
  logger?: boolean;
}

export interface AthenaExpressApp extends Express {
  sseManager: SSEManager;
  storage: InitializedStorage;
  close: () => Promise<void>;
  httpServer?: http.Server;
}

export async function createAthenaServer(options: ServerOptions): Promise<AthenaExpressApp> {
  const app = express() as AthenaExpressApp;

  // 1. Request ID & Header tracking middleware
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.id = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    res.setHeader('x-request-id', req.id);
    next();
  });

  // 2. CORS middleware
  app.use(cors({
    origin: options.corsOrigin ?? true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-idempotency-key', 'x-workspace-id', 'last-event-id', 'x-signature']
  }));

  // 3. Body parsers (50mb limit supports base64 PDF/DOCX/image attachment uploads)
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 4. OpenAPI 3.1 & Interactive Documentation (Swagger UI)
  app.get('/api/v1/openapi.json', (req: Request, res: Response) => {
    res.json(athenaOpenApiSpec);
  });

  app.get('/docs', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderSwaggerUiHtml('/api/v1/openapi.json'));
  });

  // 5. Global Authentication & Workspace Scoping Middleware
  app.use(authMiddleware(options.apiKey));

  // 6. Instantiate Core Platform Services
  const sseManager = new SSEManager();
  const approvalService = new ApprovalService(
    options.storage.stores.approval,
    options.storage.stores.runWait,
    sseManager
  );

  const attachmentService = new AttachmentService(options.storage.stores);

  let runner = options.agentRunner;
  if (!runner && options.agent) {
    runner = async (input, runId, callbacks) => {
      const history: any[] = [];
      const prepared = await attachmentService.preparePromptContext({
        userPrompt: input.content,
        attachments: input.attachments,
        sessionId: input.sessionId
      });
      const events = new AgentEventEmitter();
      events.onAny((ev) => {
        if (options.storage.stores.event?.saveRunEvent && ev.type !== 'status_change' && ev.type !== 'completed') {
          options.storage.stores.event.saveRunEvent(ev).catch(() => {});
        }
      });
      return options.agent.run(prepared.promptText, history, {
        sessionId: input.sessionId,
        runId,
        events,
        onUpdate: callbacks.onUpdate,
        confirm: callbacks.confirm,
        mediaAttachments: prepared.mediaAttachments,
        forcedTools: prepared.forcedTools,
        persistedUserPrompt: prepared.persistedUserPrompt,
        toolIntent: input.content
      });
    };
  }

  const dispatchService = new DispatchService(
    options.storage.stores.run,
    sseManager,
    runner,
    approvalService
  );
  const hydrationService = new HydrationService(
    options.storage.stores.run,
    options.storage.stores.approval,
    options.storage.stores.goal,
    options.storage.stores.task
  );
  const artifactService = new ArtifactService(options.storage.stores.artifact);

  // 7. Register Modular Subsystem Routes
  registerSessionsRoutes(app, { dispatch: dispatchService, hydration: hydrationService, sse: sseManager, stores: options.storage.stores, storage: options.storage, agent: options.agent });
  registerRunsRoutes(app, { stores: options.storage.stores, sse: sseManager });
  registerApprovalsRoutes(app, { approvalService, stores: options.storage.stores });
  registerArtifactsRoutes(app, { artifactService });
  registerGoalsRoutes(app, { stores: options.storage.stores, agent: options.agent });
  registerHarnessRoutes(app);
  registerComputerRoutes(app);
  registerBrowserRoutes(app, { stores: options.storage.stores });
  registerResearchRoutes(app, { stores: options.storage.stores });
  registerMultiagentRoutes(app, { stores: options.storage.stores });
  registerLearningRoutes(app, { stores: options.storage.stores });
  registerCommunicationRoutes(app, { stores: options.storage.stores });
  registerProactiveRoutes(app, { stores: options.storage.stores });
  registerReliabilityRoutes(app);
  registerToolsRoutes(app);
  registerIntelligenceRoutes(app, { stores: options.storage.stores });
  registerSystemRoutes(app, { storage: options.storage });

  let triggerAdapter: WorkflowTriggerAdapter | undefined;
  if (options.storage.sqliteDb) {
    const db = options.storage.sqliteDb;
    const vault = new CredentialVault(db);
    const wfRegistry = new WorkflowRegistry(db);
    const wfExecutor = new WorkflowExecutor({
      registry: wfRegistry,
      credentialVault: vault,
      events: options.agent?.events,
      policy: options.agent?.policyEngine,
      promptDefense: options.agent?.promptDefense,
      approvalEngine: options.agent?.approvalEngine,
      selfRepair: options.agent?.selfRepairEngine,
      toolExecutor: options.agent?.toolExecutor || new ToolExecutor(),
      agentFactory: {
        create: (cfg: any) => {
          return new Agent({
            provider: (process.env.LLM_PROVIDER as any) || 'gemini',
            modelName: cfg.modelOverride || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
            maxTurns: cfg.budget?.maxTurns || 15,
            systemPrompt: cfg.systemPromptOverride || DEFAULT_AGENT_PROMPT,
            allowedTools: cfg.allowedTools,
            soulPath: './SOUL.md',
            dbPath: process.env.DATABASE_PATH || './state.db'
          });
        }
      }
    });
    triggerAdapter = new WorkflowTriggerAdapter({
      registry: wfRegistry,
      executor: wfExecutor,
      db
    });
    await triggerAdapter.init();

    registerWorkflowRoutes(app, {
      registry: wfRegistry,
      executor: wfExecutor,
      triggerAdapter,
      sseManager
    });

    // Expose workflow creation, inspection, and execution tools to Athena chat agent runtime
    registerWorkflowTools(wfRegistry, wfExecutor);

    const oauthRouter = createOAuthRouter({ vault });
    app.use('/api/v1/integrations', oauthRouter);
  }

  // 8. Standardized Error Envelope Middleware
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const statusCode = err.statusCode || err.status || 500;
    const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
    res.status(statusCode).json({
      error: {
        code: errorCode,
        message: err.message || 'An unexpected internal error occurred',
        requestId: req.id,
        details: err.details || {}
      }
    });
  });

  // 9. Attach services and cleanup helpers
  app.sseManager = sseManager;
  app.storage = options.storage;

  app.close = async () => {
    if (triggerAdapter) {
      await triggerAdapter.stop();
    }
    sseManager.close();
    if (app.httpServer) {
      await new Promise<void>((resolve) => app.httpServer?.close(() => resolve()));
    }
    await options.storage.close();
  };

  return app;
}
