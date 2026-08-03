import { Tool } from '../core/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';

const execPromise = promisify(exec);

export const executePythonTool: Tool = {
  definition: {
    name: 'executePython',
    description: 'Execute Python code or run a Python script file. You must provide either "code" (for inline execution) or "scriptPath" (to run an existing file), along with optional command-line arguments.',
    parameters: {
      type: 'OBJECT',
      properties: {
        code: {
          type: 'STRING',
          description: 'Inline Python code to execute. This will be written to a temp file, executed, and cleaned up automatically.'
        },
        scriptPath: {
          type: 'STRING',
          description: 'Path to the Python script file to execute (absolute or relative to the workspace root).'
        },
        args: {
          type: 'ARRAY',
          items: {
            type: 'STRING'
          },
          description: 'Optional command-line arguments to pass to the Python script.'
        }
      },
      required: []
    }
  },
  requiresConfirmation: true,
  execute: async (args: { code?: string; scriptPath?: string; args?: string[] }) => {
    if (!args.code && !args.scriptPath) {
      return {
        success: false,
        error: 'You must provide either "code" or "scriptPath" to execute.'
      };
    }

    let runFilePath = '';
    let isTempFile = false;

    try {
      // 1. Prepare file path to execute
      if (args.code) {
        // Ensure scratch folder exists
        const scratchDir = path.resolve('scratch');
        await fs.mkdir(scratchDir, { recursive: true });

        // Generate temporary file path
        const fileName = `temp_run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.py`;
        runFilePath = path.join(scratchDir, fileName);
        isTempFile = true;

        // Write the inline code to the temporary file
        await fs.writeFile(runFilePath, args.code, 'utf-8');
      } else if (args.scriptPath) {
        runFilePath = path.resolve(args.scriptPath);
      }

      // 2. Build shell command
      const cliArgs = args.args || [];
      const escapedArgs = cliArgs
        .map(arg => `"${String(arg).replace(/"/g, '\\"')}"`)
        .join(' ');
      
      const command = `python "${runFilePath}" ${escapedArgs}`.trim();

      // 3. Execute command
      const { stdout, stderr } = await execPromise(command, { cwd: process.cwd() });

      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        stdout: err.stdout?.trim(),
        stderr: err.stderr?.trim()
      };
    } finally {
      // 4. Clean up temporary file if created
      if (isTempFile && runFilePath) {
        try {
          await fs.unlink(runFilePath);
        } catch (cleanupErr) {
          // Quietly catch cleanup errors to avoid failing the main return
          console.warn(`[executePython] Failed to delete temp file ${runFilePath}:`, cleanupErr);
        }
      }
    }
  }
};
