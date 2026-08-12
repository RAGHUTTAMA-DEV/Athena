import { Tool } from '../core/types.js';
import { calculateTool } from './calculate.js';
import { systemTimeTool } from './systemTime.js';
import { readFileTool } from './readFile.js';
import { terminalTool } from './terminal.js';
import { writeFileTool, deleteFileTool, listFilesTool } from './filesystem.js';
import { browserTool } from './browser.js';
import { searchWebTool } from './searchWeb.js';
import { skillManageTool } from './skillManage.js';
import { semanticMemoryTool } from './semanticMemory.js';
import { executePythonTool } from './executePython.js';
import { delegateTaskTool } from './delegateTask.js';
import { cronjobTool } from './cronjob.js';
import { browserNavigateTool, browserActionTool } from './interactiveBrowser.js';
import { delegateCodingTaskTool } from './delegateCodingTask.js';

export const tools: Tool[] = [
  calculateTool,
  systemTimeTool,
  readFileTool,
  terminalTool,
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
  delegateCodingTaskTool
];

export const toolsRegistry = new Map<string, Tool>(
  tools.map(t => [t.definition.name, t])
);

export function registerDynamicTools(dynamicTools: Tool[]) {
  for (const tool of dynamicTools) {
    tools.push(tool);
    toolsRegistry.set(tool.definition.name, tool);
  }
}


