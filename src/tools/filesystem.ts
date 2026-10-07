import { Tool } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Helper to resolve path (supports relative and absolute paths)
function resolvePath(targetPath: string): string {
  return path.resolve(process.cwd(), targetPath);
}

export const writeFileTool: Tool = {
  definition: {
    name: 'writeFile',
    description: 'Create or overwrite a file at the specified path (relative to workspace or absolute on system).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The path of the file to write, relative to workspace or absolute on system.'
        },
        content: {
          type: 'STRING',
          description: 'The text content to write to the file.'
        }
      },
      required: ['path', 'content']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { path: string; content: string }) => {
    try {
      const targetPath = resolvePath(args.path);
      // Ensure parent directories exist
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, args.content, 'utf-8');
      return { success: true, message: `Successfully wrote file to ${args.path}` };
    } catch (err: any) {
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  }
};

export const deleteFileTool: Tool = {
  definition: {
    name: 'deleteFile',
    description: 'Delete a file at the specified path (relative to workspace or absolute on system).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The path of the file to delete, relative to workspace or absolute on system.'
        }
      },
      required: ['path']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { path: string }) => {
    try {
      const targetPath = resolvePath(args.path);
      await fs.unlink(targetPath);
      return { success: true, message: `Successfully deleted file ${args.path}` };
    } catch (err: any) {
      return { success: false, error: `Failed to delete file: ${err.message}` };
    }
  }
};

export const listFilesTool: Tool = {
  definition: {
    name: 'listFiles',
    description: 'List the contents of a directory (relative to workspace or absolute on system).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The directory path to list, relative to workspace or absolute on system (defaults to current directory ".").'
        }
      }
    }
  },
  requiresConfirmation: false,
  execute: async (args: { path?: string }) => {
    try {
      const targetDir = resolvePath(args.path || '.');
      const files = await fs.readdir(targetDir, { withFileTypes: true });
      const contents = files.map(f => ({
        name: f.name,
        isDirectory: f.isDirectory(),
        isFile: f.isFile()
      }));
      return { success: true, path: args.path || '.', contents };
    } catch (err: any) {
      return { success: false, error: `Failed to list directory: ${err.message}` };
    }
  }
};
