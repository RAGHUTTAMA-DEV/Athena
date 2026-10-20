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

      const formatted = toolList.map(t => ({
        name: t.definition.name,
        description: t.definition.description,
        category: t.manifest?.tags?.[0] || 'general',
        tags: t.manifest?.tags || [],
        riskLevel: t.manifest?.riskLevel || (t.requiresConfirmation ? 'confirm' : 'safe'),
        requiresConfirmation: Boolean(t.requiresConfirmation),
        parameters: t.definition.parameters,
        timeoutMs: t.manifest?.timeoutMs || 30000,
        parallelSafe: t.manifest?.parallelSafe ?? false
      }));

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
          servers = parsed.mcpServers || {};
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
      if (!req.body?.name || !req.body?.type) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Fields "name" and "type" are required', requestId: req.id }
        });
        return;
      }
      let config: any = { mcpServers: {} };
      if (fs.existsSync(this.configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        } catch {}
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers[req.body.name] = {
        type: req.body.type,
        command: req.body.command,
        args: req.body.args,
        url: req.body.url
      };
      fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
      res.status(201).json({ success: true, server: config.mcpServers[req.body.name] });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MCP_SAVE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
