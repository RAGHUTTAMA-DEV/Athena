import { Tool } from '../core/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export const readFileTool: Tool = {
  definition: {
    name: 'readFile',
    description: 'Read the contents of a file at the specified path (relative to workspace or absolute on system).',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The path of the file to read, relative to workspace or absolute on system.'
        }
      },
      required: ['path']
    }
  },
  execute: async (args: { path: string }) => {
    try {
      // Resolve path to prevent directory traversal
      const resolvedPath = path.resolve(process.cwd(), args.path);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      return { success: true, content };
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }
};
