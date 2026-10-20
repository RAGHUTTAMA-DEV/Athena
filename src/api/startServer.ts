import * as dotenv from 'dotenv';
dotenv.config();

import { createStorage } from '../storage/storeFactory.js';
import { createAthenaServer } from './server.js';
import { tools } from '../tools/index.js';

async function bootstrap() {
  const port = parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';

  console.log('🚀 Initializing Athena Backend Storage...');
  const storage = await createStorage();
  console.log(`✔ Storage initialized with driver: [${storage.driver}]`);

  const app = await createAthenaServer({
    storage,
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
  💾 Database Driver:    ${storage.driver.toUpperCase()}
  🛠️  Registered Tools:   ${tools.length} real tools
=================================================================
`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully shutting down Athena server...`);
    try {
      await app.close();
      console.log('✔ Server and database storage closed cleanly.');
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
