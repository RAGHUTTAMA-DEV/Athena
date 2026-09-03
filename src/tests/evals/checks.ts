import * as fs from 'fs/promises';
import * as path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export interface CheckContext {
  prompt: string;
  finalResponse: string;
  toolCalls: { name: string; args: any; result?: any }[];
  cwd: string;
}

export type CheckFunction = (ctx: CheckContext) => Promise<boolean>;

const checkRegistry: Record<string, CheckFunction> = {};

export function registerCheck(name: string, fn: CheckFunction) {
  checkRegistry[name] = fn;
}

export function getCheck(name: string): CheckFunction | undefined {
  return checkRegistry[name];
}

// Check 1: File created check (verifies file exists in scratch/ or workspace)
registerCheck('fileCreatedCheck', async (ctx) => {
  try {
    const scratchFile = path.join(ctx.cwd, 'scratch', 'eval_output.txt');
    await fs.access(scratchFile);
    const content = await fs.readFile(scratchFile, 'utf-8');
    return content.trim().length > 0;
  } catch {
    // Also check if any tool call wrote a file
    const fileWriteCall = ctx.toolCalls.find(
      (c) => c.name === 'write_file' || c.name === 'filesystem' || c.name === 'executePython'
    );
    return !!fileWriteCall;
  }
});

// Check 2: Python Execution Output Check
registerCheck('pythonExecOutputCheck', async (ctx) => {
  const pythonCall = ctx.toolCalls.find((c) => c.name === 'executePython');
  if (!pythonCall) return false;
  const resultStr = typeof pythonCall.result === 'string' ? pythonCall.result : JSON.stringify(pythonCall.result || {});
  return resultStr.length > 0 && !resultStr.includes('Error') && !resultStr.includes('SyntaxError');
});

// Check 3: SQLite Memory Saved Check
registerCheck('sqliteMemorySavedCheck', async (ctx) => {
  const dbPath = path.join(ctx.cwd, 'state.db');
  try {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const row = await db.get('SELECT COUNT(*) as count FROM messages');
    await db.close();
    return row && row.count > 0;
  } catch {
    return ctx.toolCalls.some((c) => c.name === 'semanticMemory' || c.name === 'memory');
  }
});

// Check 4: Skill Created Check
registerCheck('skillCreatedCheck', async (ctx) => {
  const skillCall = ctx.toolCalls.find((c) => c.name === 'skillManage');
  if (skillCall) return true;
  try {
    const skillsDir = path.join(ctx.cwd, 'skills');
    const files = await fs.readdir(skillsDir);
    return files.length > 0;
  } catch {
    return false;
  }
});

// Check 5: Sub-agent Coding Task Check
registerCheck('codingSubagentCheck', async (ctx) => {
  const delegateCall = ctx.toolCalls.find((c) => c.name === 'delegateCodingTask');
  return !!delegateCall;
});

// Check 6: Cronjob / Timer Scheduled Check
registerCheck('cronjobScheduledCheck', async (ctx) => {
  const cronCall = ctx.toolCalls.find((c) => c.name === 'cronjob');
  return !!cronCall;
});

// Check 7: Web Search / Browser Check
registerCheck('webSearchCheck', async (ctx) => {
  const searchCall = ctx.toolCalls.find((c) => c.name === 'searchWeb' || c.name === 'browser' || c.name === 'interactiveBrowser');
  return !!searchCall;
});

export { checkRegistry };
