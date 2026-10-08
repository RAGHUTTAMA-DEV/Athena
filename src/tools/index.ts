import { Tool } from '../runtime/types.js';
import { calculateTool } from './calculate.js';
import { systemTimeTool } from './systemTime.js';
import { readFileTool } from './readFile.js';
import { terminalTool } from './terminal.js';
import { writeFileTool, deleteFileTool, listFilesTool } from './filesystem.js';
import { replaceFileContentTool } from './editFile.js';
import { grepSearchTool } from './grepSearch.js';
import { browserTool } from './browser.js';
import { searchWebTool } from './searchWeb.js';
import { skillManageTool } from './skillManage.js';
import { semanticMemoryTool } from './semanticMemory.js';
import { executePythonTool } from './executePython.js';
import { delegateTaskTool } from './delegateTask.js';
import { cronjobTool } from './cronjob.js';
import { browserNavigateTool, browserActionTool, browserScreenshotTool } from './interactiveBrowser.js';
import { delegateCodingTaskTool } from './delegateCodingTask.js';
import { processManageTool } from './processManage.js';
import { researchWebTool } from './researchWeb.js';
import { ingestDocumentTool } from './ingestDocument.js';
import { searchDocumentsTool } from './searchDocuments.js';
import { readDocumentTool } from './readDocument.js';

export const tools: Tool[] = [
  calculateTool,
  systemTimeTool,
  readFileTool,
  replaceFileContentTool,
  grepSearchTool,
  terminalTool,
  processManageTool,
  writeFileTool,
  deleteFileTool,
  listFilesTool,
  browserTool,
  searchWebTool,
  skillManageTool,
  semanticMemoryTool,
  executePythonTool,
  delegateTaskTool,
  cronjobTool,
  browserNavigateTool,
  browserActionTool,
  browserScreenshotTool,
  delegateCodingTaskTool,
  researchWebTool,
  ingestDocumentTool,
  searchDocumentsTool,
  readDocumentTool
];

export * from './processManage.js';
export * from './processManager.js';
import { DEFAULT_TOOL_MANIFESTS, ToolManifest } from './toolRuntime.js';
export * from './toolRuntime.js';

// Attach manifests to all registered tools
for (const tool of tools) {
  if (!tool.manifest) {
    const meta = DEFAULT_TOOL_MANIFESTS[tool.definition.name];
    if (meta) {
      tool.manifest = {
        name: tool.definition.name,
        version: meta.version || '1.0.0',
        description: tool.definition.description,
        riskLevel: meta.riskLevel || (tool.requiresConfirmation ? 'confirm' : 'safe'),
        parallelSafe: meta.parallelSafe ?? false,
        timeoutMs: meta.timeoutMs || 30000,
        permissions: meta.permissions || [],
        tags: meta.tags || [],
        maxOutputBytes: meta.maxOutputBytes || 16384
      };
    }
  }
}

export const toolsRegistry = new Map<string, Tool>(
  tools.map(t => [t.definition.name, t])
);

import { SearchableToolRegistry } from './toolRegistry.js';

export * from './executionBackend.js';
export * from './sandboxBackend.js';
export * from './filesystemEngine.js';
export * from './processManager.js';
export * from './toolRegistry.js';
export * from './toolDiscovery.js';

export const searchableToolRegistry = new SearchableToolRegistry(tools);

export function registerDynamicTools(dynamicTools: Tool[]) {
  for (const tool of dynamicTools) {
    if (!tool.manifest) {
      tool.manifest = {
        name: tool.definition.name,
        version: '1.0.0',
        description: tool.definition.description,
        riskLevel: tool.requiresConfirmation ? 'confirm' : 'safe',
        parallelSafe: false,
        timeoutMs: 30000,
        permissions: [],
        tags: ['mcp', 'dynamic'],
        maxOutputBytes: 16384
      };
    }
    if (!toolsRegistry.has(tool.definition.name)) {
      tools.push(tool);
    }
    toolsRegistry.set(tool.definition.name, tool);
    searchableToolRegistry.register(tool);
  }
}


