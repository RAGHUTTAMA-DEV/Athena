export const athenaOpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Athena Autonomous Agent API',
    description: 'Production REST & Event Streaming Platform for Athena V2',
    version: '2.0.0'
  },
  servers: [
    { url: '/api/v1', description: 'Primary API Server' }
  ],
  tags: [
    { name: 'Sessions', description: 'Durable message dispatch, session state hydration, and event streaming' },
    { name: 'Runs', description: 'Run state, execution cancellation, replay trajectories, and event subscriptions' },
    { name: 'Approvals', description: 'Human-in-the-loop permission requests and atomic decisions' },
    { name: 'Artifacts', description: 'Immutable artifact versions, unified diffing, and raw content streaming' },
    { name: 'Goals', description: 'Autonomous goal hierarchy, progress tracking, and DAG tasks' },
    { name: 'Coding Harness', description: 'Repository inspection, branch status, diffs, and rollback snapshots' },
    { name: 'Computer Use', description: 'Desktop screen capture, window enumeration, and input automation' },
    { name: 'Browser', description: 'Playwright browser profiles, session management, and visual snapshots' },
    { name: 'Research & RAG', description: 'Document indexing, vector search, and hybrid retrieval' },
    { name: 'Multi-Agent', description: 'Specialized agent profiles, delegation contracts, and A2A mailbox' },
    { name: 'Learning & Skills', description: 'Progressive disclosure skills, learned workflows, and standing routines' },
    { name: 'Communication', description: 'Channel gateways (CLI, Telegram, etc.) and calendar scheduling' },
    { name: 'Proactive & Background', description: 'Heartbeat inspections, cost controls, durable events, and webhooks' },
    { name: 'Reliability & Safety', description: 'Task verification, bounded self-repair, and clarification questions' },
    { name: 'Tools & MCP', description: 'Tool catalogs and Model Context Protocol server configurations' },
    { name: 'Intelligence & Models', description: 'Model routing tiers, prompt cache telemetry, and metrics' },
    { name: 'System & Health', description: 'Liveness, database readiness probes, and capabilities' }
  ],
  paths: {
    '/health/live': {
      get: {
        tags: ['System & Health'],
        summary: 'Process liveness probe',
        responses: { '200': { description: 'Process alive' } }
      }
    },
    '/health/ready': {
      get: {
        tags: ['System & Health'],
        summary: 'Readiness probe verifying storage connectivity',
        responses: { '200': { description: 'System ready' }, '503': { description: 'Storage unready' } }
      }
    },
    '/api/v1/sessions': {
      get: {
        tags: ['Sessions'],
        summary: 'List recent sessions',
        responses: { '200': { description: 'List of sessions' } }
      }
    },
    '/api/v1/sessions/{sessionId}/messages': {
      post: {
        tags: ['Sessions'],
        summary: 'Durable message dispatch',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deduplicated run' }, '202': { description: 'Run queued' } }
      }
    },
    '/api/v1/sessions/{sessionId}/state': {
      get: {
        tags: ['Sessions'],
        summary: 'Hydrate unified session view',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Hydrated session state' } }
      }
    },
    '/api/v1/sessions/{sessionId}/events': {
      get: {
        tags: ['Sessions'],
        summary: 'Session SSE event stream',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'SSE text/event-stream' } }
      }
    },
    '/api/v1/runs/{runId}': {
      get: {
        tags: ['Runs'],
        summary: 'Get run details and status',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Run details' }, '404': { description: 'Run not found' } }
      }
    },
    '/api/v1/runs/{runId}/abort': {
      post: {
        tags: ['Runs'],
        summary: 'Request run cancellation',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Cancellation acknowledged' } }
      }
    },
    '/api/v1/runs/{runId}/events': {
      get: {
        tags: ['Runs'],
        summary: 'Run execution live SSE stream',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'SSE text/event-stream' } }
      }
    },
    '/api/v1/runs/{runId}/replay': {
      get: {
        tags: ['Runs'],
        summary: 'Get execution trajectory replay steps',
        parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Trajectory steps' } }
      }
    },
    '/api/v1/approvals/pending': {
      get: {
        tags: ['Approvals'],
        summary: 'List pending human approval requests',
        responses: { '200': { description: 'Pending approval list' } }
      }
    },
    '/api/v1/approvals/{approvalId}/decision': {
      post: {
        tags: ['Approvals'],
        summary: 'Submit atomic approval decision',
        parameters: [{ name: 'approvalId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Decision recorded' }, '409': { description: 'Already resolved or expired' } }
      }
    },
    '/api/v1/artifacts': {
      get: {
        tags: ['Artifacts'],
        summary: 'List artifacts with filtering',
        responses: { '200': { description: 'List of artifacts' } }
      }
    },
    '/api/v1/artifacts/{artifactId}/diff': {
      get: {
        tags: ['Artifacts'],
        summary: 'Compute line-by-line diff between artifact versions',
        parameters: [{ name: 'artifactId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Diff result' } }
      }
    },
    '/api/v1/artifacts/{artifactId}/raw': {
      get: {
        tags: ['Artifacts'],
        summary: 'Get raw artifact content stream',
        parameters: [{ name: 'artifactId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Raw stream' } }
      }
    }
  }
};

export function renderSwaggerUiHtml(openApiUrl = '/api/v1/openapi.json'): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Athena Autonomous Agent API — OpenAPI 3.1</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #0f172a; color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; }
    .topbar { display: none; }
    .swagger-ui { filter: invert(88%) hue-rotate(180deg); }
    .swagger-ui .info h2 { color: #38bdf8; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${openApiUrl}',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis],
        layout: "BaseLayout"
      });
    };
  </script>
</body>
</html>`;
}
