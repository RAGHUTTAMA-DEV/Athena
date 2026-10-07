import * as dotenv from 'dotenv';
dotenv.config();

import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';

export const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
});

sdk.start();

// Handle graceful shutdown
const shutdown = () => {
  sdk.shutdown()
    .then(() => {
      console.log('[OTel] SDK shut down successfully.');
    })
    .catch((err) => {
      console.error('[OTel] Error shutting down SDK', err);
    });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
