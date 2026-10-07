import { Tool } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export const replaceFileContentTool: Tool = {
  definition: {
    name: 'replaceFileContent',
    description: 'Surgically replace a block of text within an existing file. This is the preferred method for editing existing code or documents, as it avoids re-writing the entire file.',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'The path of the file to modify, relative to workspace or absolute on system.'
        },
        targetContent: {
          type: 'STRING',
          description: 'The exact block of code/text to find and replace. Must match the existing file content (including indentation).'
        },
        replacementContent: {
          type: 'STRING',
          description: 'The new replacement code/text to insert in place of targetContent.'
        },
        allowMultiple: {
          type: 'BOOLEAN',
          description: 'If true, all occurrences of targetContent will be replaced. If false (default), exactly one occurrence must exist.'
        }
      },
      required: ['path', 'targetContent', 'replacementContent']
    }
  },
  requiresConfirmation: true,
  execute: async (args: {
    path: string;
    targetContent: string;
    replacementContent: string;
    allowMultiple?: boolean;
  }) => {
    try {
      const resolvedPath = path.resolve(process.cwd(), args.path);
      const originalFile = await fs.readFile(resolvedPath, 'utf-8');

      // Normalize line endings to LF for consistent matching across Windows (CRLF) and Unix (LF)
      const isCRLF = originalFile.includes('\r\n');
      const normalizedOriginal = originalFile.replace(/\r\n/g, '\n');
      const normalizedTarget = args.targetContent.replace(/\r\n/g, '\n');
      const normalizedReplacement = args.replacementContent.replace(/\r\n/g, '\n');

      if (!normalizedOriginal.includes(normalizedTarget)) {
        return {
          success: false,
          error: `targetContent was not found in file "${args.path}". Please verify exact character spacing, indentation, and content using readFile before attempting replace.`
        };
      }

      // Count occurrences
      let count = 0;
      let pos = normalizedOriginal.indexOf(normalizedTarget);
      while (pos !== -1) {
        count++;
        pos = normalizedOriginal.indexOf(normalizedTarget, pos + normalizedTarget.length);
      }

      if (count > 1 && !args.allowMultiple) {
        return {
          success: false,
          error: `Found ${count} occurrences of targetContent in "${args.path}". Specify more surrounding lines to create a unique target, or set allowMultiple: true.`
        };
      }

      let updatedNormalized: string;
      if (args.allowMultiple) {
        updatedNormalized = normalizedOriginal.replaceAll(normalizedTarget, normalizedReplacement);
      } else {
        const index = normalizedOriginal.indexOf(normalizedTarget);
        updatedNormalized =
          normalizedOriginal.substring(0, index) +
          normalizedReplacement +
          normalizedOriginal.substring(index + normalizedTarget.length);
      }

      // Restore original line ending style if file was CRLF
      const finalContent = isCRLF ? updatedNormalized.replace(/\n/g, '\r\n') : updatedNormalized;
      await fs.writeFile(resolvedPath, finalContent, 'utf-8');

      return {
        success: true,
        message: `Successfully replaced ${count} occurrence(s) in "${args.path}".`,
        replacementsCount: count
      };
    } catch (err: any) {
      return { success: false, error: `Failed to replace content in file: ${err.message}` };
    }
  }
};
