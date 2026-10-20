import { Request, Response } from 'express';
import { CapabilityRegistry } from '../../tools/capabilityRegistry.js';
import { InitializedStorage } from '../../storage/storeFactory.js';

export class SystemController {
  private capabilityRegistry = CapabilityRegistry.getInstance();

  constructor(private storage: InitializedStorage) {}

  getLiveness = async (req: Request, res: Response): Promise<void> => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  };

  getReadiness = async (req: Request, res: Response): Promise<void> => {
    try {
      const dbOk = await this.storage.ping();
      if (!dbOk) {
        res.status(503).json({
          status: 'unready',
          database: { driver: this.storage.driver, connected: false }
        });
        return;
      }
      res.json({
        status: 'ready',
        database: { driver: this.storage.driver, connected: true }
      });
    } catch (err: any) {
      res.status(503).json({
        status: 'unready',
        error: err.message,
        database: { driver: this.storage.driver, connected: false }
      });
    }
  };

  listCapabilities = async (req: Request, res: Response): Promise<void> => {
    try {
      const list = this.capabilityRegistry.list();
      res.json({ capabilities: list, count: list.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CAPABILITIES_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getPolicy = async (req: Request, res: Response): Promise<void> => {
    res.json({
      policy: {
        sandboxEnforced: true,
        sensitivePathPatterns: ['\\.env', '\\.git', 'id_rsa', '\\.pem', 'credentials\\.json'],
        promptInjectionDefense: 'active',
        maxTurnBudget: 20,
        allowedChannels: ['cli', 'telegram', 'api']
      }
    });
  };
}
