import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Tool, ToolDefinition } from './types.js';

export interface MCPServerConfig {
  type?: 'stdio' | 'sse' | 'http' | 'streamable-http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

export interface MCPConfigFile {
  mcpServers: Record<string, MCPServerConfig>;
}

const ALLOWED_GEMINI_FIELDS = new Set([
  'name',
  'description',
  'parameters',
  'type',
  'format',
  'nullable',
  'enum',
  'properties',
  'required',
  'items',
  'minItems',
  'maxItems'
]);

/**
 * Strictly clean and convert any tool or schema object into a 100% valid Gemini API parameter schema.
 * Prevents array-to-object numeric property keys ("0", "1") and strips all unsupported JSON schema keywords.
 */
export function cleanGeminiSchema(schema: any, isRoot: boolean = true): any {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(item => cleanGeminiSchema(item, false));
  }

  const cleaned: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (!ALLOWED_GEMINI_FIELDS.has(key)) {
      continue;
    }

    // Only keep 'required' at the root parameters object level (Gemini OpenAPI forbids nested 'required')
    if (key === 'required' && !isRoot) {
      continue;
    }

    if (key === 'properties') {
      if (Array.isArray(value)) {
        const propObj: Record<string, any> = {};
        for (const item of value) {
          if (item && typeof item === 'object') {
            const propName = item.name || item.key || item.id || `param_${Object.keys(propObj).length}`;
            const { name, key: k, id, ...rest } = item;
            propObj[propName] = cleanGeminiSchema(rest, false);
          }
        }
        cleaned.properties = propObj;
      } else if (value && typeof value === 'object') {
        const propObj: Record<string, any> = {};
        for (const [propKey, propVal] of Object.entries(value)) {
          if (/^\d+$/.test(propKey) && propVal && typeof propVal === 'object') {
            const realName = (propVal as any).name || (propVal as any).key || `param_${propKey}`;
            const { name, key: k, ...rest } = propVal as any;
            propObj[realName] = cleanGeminiSchema(rest, false);
          } else {
            propObj[propKey] = cleanGeminiSchema(propVal, false);
          }
        }
        cleaned.properties = propObj;
      } else {
        cleaned.properties = {};
      }
    } else if (key === 'parameters') {
      cleaned.parameters = cleanGeminiSchema(value, true);
    } else if (key === 'type') {
      if (Array.isArray(value)) {
        const validTypes = value.filter(t => t !== 'null' && t !== null);
        cleaned.type = (validTypes[0] || 'STRING').toString().toUpperCase();
      } else if (typeof value === 'string') {
        cleaned.type = value.toUpperCase();
      } else {
        cleaned.type = 'STRING';
      }
    } else if (key === 'enum') {
      if (Array.isArray(value)) {
        cleaned.enum = value.filter(v => v !== null && v !== undefined).map(v => String(v));
      }
    } else if (key === 'items') {
      cleaned.items = cleanGeminiSchema(value, false);
      if (!cleaned.items || typeof cleaned.items !== 'object') {
        cleaned.items = { type: 'STRING' };
      }
    } else if (key === 'required') {
      if (Array.isArray(value)) {
        cleaned.required = value.map(v => String(v));
      }
    } else if (value && typeof value === 'object') {
      cleaned[key] = cleanGeminiSchema(value, false);
    } else {
      cleaned[key] = value;
    }
  }

  if (cleaned.type === 'ARRAY' && !cleaned.items) {
    cleaned.items = { type: 'STRING' };
  }
  if (cleaned.type === 'OBJECT' && !cleaned.properties) {
    cleaned.properties = {};
  }

  return cleaned;
}

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private transports: any[] = [];

  async loadAndInitialize(configPath: string = './mcp_servers.json'): Promise<Tool[]> {
    const fullPath = path.resolve(configPath);
    if (!fs.existsSync(fullPath)) {
      console.log(`[MCP] No configuration file found at ${fullPath}. Skipping MCP initialization.`);
      return [];
    }

    let configFile: MCPConfigFile;
    try {
      const fileContent = fs.readFileSync(fullPath, 'utf-8');
      configFile = JSON.parse(fileContent);
    } catch (err: any) {
      console.error(`[MCP Error] Failed to parse ${fullPath}: ${err.message}`);
      return [];
    }

    if (!configFile.mcpServers || Object.keys(configFile.mcpServers).length === 0) {
      console.log(`[MCP] No mcpServers defined in ${fullPath}.`);
      return [];
    }

    const loadedTools: Tool[] = [];
    const serverEntries = Object.entries(configFile.mcpServers);

    const initPromises = serverEntries.map(async ([serverName, serverConfig]) => {
      const serverTools: Tool[] = [];
      const timeoutMs = (serverConfig as any).timeoutMs || 30000;

      const initSingleServer = async () => {
        let transport: any;
        const transportType = serverConfig.type || (serverConfig.url ? 'sse' : 'stdio');

        if (transportType === 'sse') {
          if (!serverConfig.url) {
            throw new Error(`SSE transport requires a "url" property.`);
          }
          console.log(`[MCP] Connecting to SSE server "${serverName}" at ${serverConfig.url}...`);
          const headers = serverConfig.headers || {};
          transport = new SSEClientTransport(new URL(serverConfig.url), {
            requestInit: { headers }
          });
        } else if (transportType === 'http' || transportType === 'streamable-http') {
          if (!serverConfig.url) {
            throw new Error(`HTTP transport requires a "url" property.`);
          }
          console.log(`[MCP] Connecting to Streamable HTTP server "${serverName}" at ${serverConfig.url}...`);
          const headers = serverConfig.headers || {};
          transport = new StreamableHTTPClientTransport(new URL(serverConfig.url), {
            requestInit: { headers }
          });
        } else {
          // Stdio Transport
          if (!serverConfig.command) {
            throw new Error(`Stdio transport requires a "command" property.`);
          }
          console.log(`[MCP] Launching stdio server "${serverName}" (${serverConfig.command} ${(serverConfig.args || []).join(' ')})...`);

          const cleanEnv: Record<string, string> = {};
          for (const [key, val] of Object.entries({ ...process.env, ...(serverConfig.env || {}) })) {
            if (val !== undefined) {
              cleanEnv[key] = val;
            }
          }

          const stdioTransport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: cleanEnv
          });

          if (stdioTransport.stderr) {
            stdioTransport.stderr.on('data', (chunk: any) => {
              const msg = chunk.toString().trim();
              if (msg) {
                console.log(`[MCP Server (${serverName})] ${msg}`);
              }
            });
          }

          transport = stdioTransport;
        }

        const client = new Client(
          { name: `athena-agent`, version: "1.0.0" },
          { capabilities: {} }
        );

        await client.connect(transport);
        this.clients.set(serverName, client);
        this.transports.push(transport);

        const { tools: mcpTools } = await client.listTools();

        for (const mcpTool of mcpTools) {
          const sanitizedServerName = serverName.replace(/[^a-zA-Z0-9_]/g, '_');
          const sanitizedToolName = mcpTool.name.replace(/[^a-zA-Z0-9_]/g, '_');
          const namespacedName = `${sanitizedServerName}_${sanitizedToolName}`;

          const rawSchema = (mcpTool.inputSchema as any) || {};
          const cleanedSchema = cleanGeminiSchema(rawSchema);

          const toolDef: ToolDefinition = {
            name: namespacedName,
            description: `[MCP: ${serverName}] ${mcpTool.description || ''}`,
            parameters: cleanedSchema && cleanedSchema.properties && Object.keys(cleanedSchema.properties).length > 0 ? {
              type: 'OBJECT',
              properties: cleanedSchema.properties,
              required: cleanedSchema.required || []
            } : undefined
          };

          const athenaTool: Tool = {
            definition: toolDef,
            execute: async (args: any) => {
              try {
                const response = await client.callTool({
                  name: mcpTool.name,
                  arguments: args || {}
                });

                if (Array.isArray(response.content)) {
                  const textContent = response.content
                    .map((item: any) => {
                      if (item.type === 'text') return item.text;
                      return JSON.stringify(item);
                    })
                    .join('\n');
                  return { success: true, result: textContent };
                }

                return { success: true, result: response };
              } catch (toolErr: any) {
                return { success: false, error: `[MCP Tool Error: ${namespacedName}] ${toolErr.message}` };
              }
            }
          };

          serverTools.push(athenaTool);
          console.log(`[MCP] Registered tool: ${namespacedName}`);
        }
      };

      let timer: any;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Connection timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      try {
        await Promise.race([initSingleServer(), timeoutPromise]);
      } finally {
        if (timer) clearTimeout(timer);
      }

      return serverTools;
    });

    const results = await Promise.allSettled(initPromises);

    results.forEach((result, idx) => {
      const serverName = serverEntries[idx][0];
      if (result.status === 'fulfilled') {
        loadedTools.push(...result.value);
      } else {
        console.error(`[MCP Warning] Server "${serverName}" failed to initialize: ${result.reason?.message || result.reason}`);
      }
    });

    return loadedTools;
  }

  async closeAll(): Promise<void> {
    for (const transport of this.transports) {
      try {
        await transport.close();
      } catch (err: any) {
        // Silently handle close errors during exit
      }
    }
    this.transports = [];
    this.clients.clear();
  }
}
