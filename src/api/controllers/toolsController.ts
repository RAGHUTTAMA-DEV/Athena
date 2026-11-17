import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { tools, searchableToolRegistry } from '../../tools/index.js';

export class ToolsController {
  private configPath = path.resolve('./mcp_servers.json');

  listTools = async (req: Request, res: Response): Promise<void> => {
    try {
      const categoryFilter = req.query.category ? String(req.query.category).toLowerCase() : undefined;
      const query = req.query.q ? String(req.query.q).toLowerCase() : undefined;

      let toolList = tools;
      if (query) {
        toolList = searchableToolRegistry.search(query).map(s => s.tool);
      }

      const formatted = toolList.map(t => {
        const isMcp = Boolean(
          t.manifest?.tags?.includes('mcp') ||
          t.definition.description?.startsWith('[MCP:') ||
          t.definition.name.includes('_') && ['calendar', 'gmail', 'github', 'notion', 'excalidraw', 'filesystem'].some(s => t.definition.name.startsWith(s + '_'))
        );
        let mcpServer: string | undefined = undefined;
        if (isMcp) {
          const match = t.definition.description?.match(/\[MCP:\s*([^\]]+)\]/);
          if (match) {
            mcpServer = match[1].trim();
          } else {
            const prefix = t.definition.name.split('_')[0];
            mcpServer = prefix;
          }
        }

        return {
          name: t.definition.name,
          description: t.definition.description,
          category: isMcp ? (mcpServer || 'mcp') : (t.manifest?.tags?.[0] || 'general'),
          tags: t.manifest?.tags || [],
          riskLevel: t.manifest?.riskLevel || (t.requiresConfirmation ? 'confirm' : 'safe'),
          requiresConfirmation: Boolean(t.requiresConfirmation),
          parameters: t.definition.parameters,
          timeoutMs: t.manifest?.timeoutMs || 30000,
          parallelSafe: t.manifest?.parallelSafe ?? false,
          isMcp,
          mcpServer,
          source: isMcp ? 'mcp' : 'builtin'
        };
      });

      const filtered = categoryFilter
        ? formatted.filter(t => t.category.toLowerCase() === categoryFilter || t.tags.some(tag => tag.toLowerCase() === categoryFilter))
        : formatted;

      res.json({
        tools: filtered,
        count: filtered.length,
        totalRegistered: tools.length
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TOOLS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listMcpServers = async (req: Request, res: Response): Promise<void> => {
    try {
      let servers: Record<string, any> = {};
      if (fs.existsSync(this.configPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
          const raw = parsed.mcpServers || {};
          for (const [k, v] of Object.entries<any>(raw)) {
            const safeEnv: Record<string, string> | undefined = v?.env
              ? Object.fromEntries(
                  Object.entries<string>(v.env).map(([ek, ev]) => [
                    ek,
                    String(ev).startsWith('${') ? String(ev) : '••••••••',
                  ])
                )
              : undefined;
            servers[k] = {
              type: v?.url ? 'sse' : (v?.type || 'stdio'),
              command: v?.command,
              args: v?.args,
              url: v?.url,
              ...(safeEnv ? { env: safeEnv } : {}),
            };
          }
        } catch {
          servers = {};
        }
      }
      res.json({ servers, count: Object.keys(servers).length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MCP_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  registerMcpServer = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.name) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "name" is required', requestId: req.id }
        });
        return;
      }
      const serverType = req.body.type || (req.body.url ? 'sse' : 'stdio');
      let config: any = { mcpServers: {} };
      if (fs.existsSync(this.configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        } catch {}
      }
      config.mcpServers = config.mcpServers || {};
      const entry: any = {
        type: serverType,
        ...(req.body.command ? { command: req.body.command } : {}),
        ...(req.body.args ? { args: req.body.args } : {}),
        ...(req.body.url ? { url: req.body.url } : {}),
        ...(req.body.env && Object.keys(req.body.env).length > 0 ? { env: req.body.env } : {}),
      };
      config.mcpServers[req.body.name] = entry;
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      res.status(201).json({ success: true, name: req.body.name, server: entry });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MCP_SAVE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  deleteMcpServer = async (req: Request, res: Response): Promise<void> => {
    try {
      const name = req.params.name;
      if (!fs.existsSync(this.configPath)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'mcp_servers.json not found', requestId: req.id } });
        return;
      }
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      if (!config.mcpServers || !config.mcpServers[name]) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `MCP server "${name}" not found`, requestId: req.id } });
        return;
      }
      delete config.mcpServers[name];
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      res.json({ success: true, deleted: name });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MCP_DELETE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
