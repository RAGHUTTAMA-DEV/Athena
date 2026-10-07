import { Tool } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.db', '.sqlite', '.sqlite3', '.mp3', '.mp4', '.wav', '.mov'
]);

export const readFileTool: Tool = {
  definition: {
    name: 'readFile',
    description: 'Read the contents of a text file at the specified path. Supports line-range slicing (startLine, endLine) to efficiently inspect large files without exhausting token limits.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The path of the file to read, relative to workspace or absolute on system.'
        },
        startLine: {
          type: 'INTEGER',
          description: 'Optional 1-indexed starting line number to read from (inclusive).'
        },
        endLine: {
          type: 'INTEGER',
          description: 'Optional 1-indexed ending line number to read up to (inclusive).'
        }
      },
      required: ['path']
    }
  },
  execute: async (args: { path: string; startLine?: number; endLine?: number }) => {
    try {
      const resolvedPath = path.resolve(process.cwd(), args.path);
      const ext = path.extname(resolvedPath).toLowerCase();

      if (BINARY_EXTENSIONS.has(ext)) {
        const stats = await fs.stat(resolvedPath);
        return {
          success: true,
          isBinary: true,
          path: args.path,
          sizeBytes: stats.size,
          message: `Binary file detected (${ext}, ${stats.size} bytes). Direct text reading is not supported.`
        };
      }

      const rawContent = await fs.readFile(resolvedPath, 'utf-8');
      const lines = rawContent.split(/\r?\n/);
      const totalLines = lines.length;

      let start = args.startLine ? Math.max(1, args.startLine) : 1;
      let end = args.endLine ? Math.min(totalLines, args.endLine) : totalLines;

      if (start > totalLines) {
        return {
          success: true,
          path: args.path,
          totalLines,
          content: '',
          message: `startLine (${start}) exceeds total line count (${totalLines}).`
        };
      }

      // If no range specified and file has more than 500 lines, cap output to prevent context overflow
      let wasTruncated = false;
      const MAX_UNSLICED_LINES = 500;
      if (!args.startLine && !args.endLine && totalLines > MAX_UNSLICED_LINES) {
        end = MAX_UNSLICED_LINES;
        wasTruncated = true;
      }

      const selectedLines = lines.slice(start - 1, end);
      const numberedContent = selectedLines
        .map((line, idx) => `${start + idx}: ${line}`)
        .join('\n');

      return {
        success: true,
        path: args.path,
        startLine: start,
        endLine: end,
        totalLines,
        wasTruncated,
        content: numberedContent,
        note: wasTruncated
          ? `Showing first ${MAX_UNSLICED_LINES} of ${totalLines} lines. To read further, specify startLine and endLine.`
          : undefined
      };
    } catch (err: any) {
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }
};

