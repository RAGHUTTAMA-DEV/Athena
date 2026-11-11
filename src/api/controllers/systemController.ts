import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { CapabilityRegistry } from '../../tools/capabilityRegistry.js';
import { InitializedStorage } from '../../storage/storeFactory.js';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', '.browser-session-data', '.vscode', '.harness']);

function scanWorkspace(rootDir: string, query: string, limit = 40): Array<{ name: string; path: string; type: 'file' | 'folder' }> {
  const results: Array<{ name: string; path: string; type: 'file' | 'folder' }> = [];
  const q = query.toLowerCase();

  function walk(dir: string, relBase: string, depth: number) {
    if (results.length >= limit || depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) break;
      if (IGNORED_DIRS.has(entry.name)) continue;
      if (entry.name.endsWith('.db') || entry.name === '.env') continue;

      const relPath = relBase ? `${relBase}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory();

      if (!q || relPath.toLowerCase().includes(q) || entry.name.toLowerCase().includes(q)) {
        results.push({
          name: entry.name,
          path: relPath,
          type: isDir ? 'folder' : 'file'
        });
      }

      if (isDir) {
        walk(path.join(dir, entry.name), relPath, depth + 1);
      }
    }
  }

  walk(rootDir, '', 0);
  return results;
}

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

  listFiles = async (req: Request, res: Response): Promise<void> => {
    try {
      const q = req.query.q ? String(req.query.q) : '';
      const files = scanWorkspace(process.cwd(), q, 40);
      res.json({ files });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'FILES_LIST_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
