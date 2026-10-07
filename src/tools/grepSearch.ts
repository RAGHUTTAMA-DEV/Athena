import { Tool } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.browser-session-data',
  '.vscode',
  '.gemini',
  'scratch',
  '.kilo'
]);

const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf',
  '.zip', '.tar', '.gz', '.7z', '.exe', '.dll', '.so', '.dylib',
  '.db', '.sqlite', '.sqlite3', '.mp3', '.mp4', '.wav', '.mov',
  '.map', '.lock'
]);

async function collectFiles(dir: string, includes?: string[]): Promise<string[]> {
  const results: string[] = [];

  async function walk(currentDir: string) {
    try {
      const entries = await fs.readdir(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            await walk(path.join(currentDir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (IGNORED_EXTENSIONS.has(ext)) continue;

          if (includes && includes.length > 0) {
            const matchesInclude = includes.some(inc => {
              const cleanInc = inc.replace(/^\*+\./, '.').toLowerCase();
              return cleanInc.startsWith('.') ? ext === cleanInc : entry.name.toLowerCase().includes(cleanInc);
            });
            if (!matchesInclude) continue;
          }

          results.push(path.join(currentDir, entry.name));
        }
      }
    } catch (err) {
      // Skip unreadable directories
    }
  }

  await walk(dir);
  return results;
}

export const grepSearchTool: Tool = {
  definition: {
    name: 'grepSearch',
    description: 'Fast recursive text and pattern search across project files. Returns matching lines and line numbers, excluding build and dependency folders.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The search string or regex pattern to search for across files.'
        },
        path: {
          type: 'STRING',
          description: 'Directory path to search in (defaults to workspace root ".").'
        },
        caseSensitive: {
          type: 'BOOLEAN',
          description: 'Whether search should be case sensitive (defaults to false).'
        },
        isRegex: {
          type: 'BOOLEAN',
          description: 'Whether the query should be treated as a regular expression (defaults to false).'
        },
        includes: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of file extensions or patterns to include, e.g. ["*.ts", "*.json"].'
        },
        maxResults: {
          type: 'INTEGER',
          description: 'Maximum number of line matches to return (defaults to 40).'
        }
      },
      required: ['query']
    }
  },
  execute: async (args: {
    query: string;
    path?: string;
    caseSensitive?: boolean;
    isRegex?: boolean;
    includes?: string[];
    maxResults?: number;
  }) => {
    try {
      const rootDir = path.resolve(process.cwd(), args.path || '.');
      const maxResults = args.maxResults || 40;
      const files = await collectFiles(rootDir, args.includes);

      let regex: RegExp;
      try {
        const flags = args.caseSensitive ? 'g' : 'gi';
        const pattern = args.isRegex
          ? args.query
          : args.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(pattern, flags);
      } catch (regexErr: any) {
        return { success: false, error: `Invalid regex pattern: ${regexErr.message}` };
      }

      const matches: Array<{ file: string; line: number; text: string }> = [];

      for (const filePath of files) {
        if (matches.length >= maxResults) break;

        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const lines = content.split(/\r?\n/);
          const relPath = path.relative(process.cwd(), filePath);

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            regex.lastIndex = 0;
            if (regex.test(line)) {
              matches.push({
                file: relPath.replace(/\\/g, '/'),
                line: i + 1,
                text: line.trim().slice(0, 200) // Truncate very long lines
              });

              if (matches.length >= maxResults) break;
            }
          }
        } catch (readErr) {
          // Skip unreadable files
        }
      }

      return {
        success: true,
        query: args.query,
        searchedFilesCount: files.length,
        totalMatches: matches.length,
        matches,
        note: matches.length >= maxResults ? `Results capped at maxResults (${maxResults}).` : undefined
      };
    } catch (err: any) {
      return { success: false, error: `grepSearch failed: ${err.message}` };
    }
  }
};
