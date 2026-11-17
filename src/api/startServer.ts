import * as dotenv from 'dotenv';
dotenv.config();

import { createStorage } from '../storage/storeFactory.js';
import { createAthenaServer } from './server.js';
import { tools, registerDynamicTools } from '../tools/index.js';
import { MCPManager } from '../mcp/mcpManager.js';
import { Agent } from '../runtime/agent.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';

async function bootstrap() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  console.log('🚀 Initializing Athena Backend Storage...');
  const storage = await createStorage();
  console.log('✔ Storage initialized with driver: [' + storage.driver + ']');

  console.log('🔌 Connecting Model Context Protocol (MCP) servers...');
  const mcpManager = new MCPManager();
  try {
    const mcpTools = await mcpManager.loadAndInitialize('./mcp_servers.json');
    if (mcpTools.length > 0) {
      registerDynamicTools(mcpTools);
      console.log(`✔ Loaded & registered ${mcpTools.length} dynamic MCP tools into Athena agent runtime.`);
    }
  } catch (err: any) {
    console.warn(`[MCP Warning] Failed to initialize MCP servers: ${err.message}`);
  }

  console.log('🤖 Initializing Autonomous Agent Core...');
  const agent = new Agent({
    provider: (process.env.LLM_PROVIDER as any) || 'gemini',
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || '20', 10),
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath: process.env.DATABASE_PATH || './state.db'
  });
  await agent.init();
  console.log('✔ Agent Core initialized with SOUL.md & memory.');

  const app = await createAthenaServer({
    storage,
    agent,
    corsOrigin: process.env.CORS_ORIGIN || '*',
    apiKey: process.env.ATHENA_API_KEY
  });

  const server = app.listen(port, host, () => {
    app.httpServer = server;
    console.log(`
=================================================================
               🏛️  ATHENA AUTONOMOUS AGENT PLATFORM
=================================================================
  🚀 Server Running:     http://localhost:${port}
  📖 Interactive Docs:   http://localhost:${port}/docs
  📜 OpenAPI 3.1 Spec:   http://localhost:${port}/api/v1/openapi.json
  🩺 Health Live:        http://localhost:${port}/health/live
  🩺 Health Ready:       http://localhost:${port}/health/ready
  🤖 Active LLM Model:   ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'} (${process.env.LLM_PROVIDER || 'gemini'})
  💾 Database Driver:    ${storage.driver.toUpperCase()}
  🛠️  Registered Tools:   ${tools.length} real tools
=================================================================
`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully shutting down Athena server...`);
    try {
      await mcpManager.closeAll();
      await app.close();
      console.log('✔ Server, MCP connections, and database storage closed cleanly.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('❌ Failed to start Athena backend server:', err);
  process.exit(1);
});
