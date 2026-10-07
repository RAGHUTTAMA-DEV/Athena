import { Tool } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseFrontmatter } from '../memory/procedural.js';

const SKILLS_DIR = './skills';

function getSafeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.md';
}

async function ensureSkillsDir(): Promise<void> {
  try {
    await fs.mkdir(path.resolve(SKILLS_DIR), { recursive: true });
  } catch (err) {}
}

export const skillManageTool: Tool = {
  definition: {
    name: 'skill_manage',
    description: 'Perform CRUD operations on procedural skill files (SKILL.md). Skills represent instructions the agent can use to perform tasks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'The action to perform: "create", "read", "update", "delete", or "list"'
        },
        name: {
          type: 'STRING',
          description: 'Name of the skill (required for create, read, update, delete)'
        },
        description: {
          type: 'STRING',
          description: 'Short description of the skill (for create/update)'
        },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tags indicating categories or topics (for create/update)'
        },
        content: {
          type: 'STRING',
          description: 'The body content/instructions of the skill in markdown (for create/update)'
        }
      },
      required: ['action']
    }
  },
  execute: async (args: {
    action: 'create' | 'read' | 'update' | 'delete' | 'list';
    name?: string;
    description?: string;
    tags?: string[];
    content?: string;
  }) => {
    await ensureSkillsDir();

    const { action, name, description, tags, content } = args;

    if (action !== 'list' && !name) {
      throw new Error(`Name is required for action: ${action}`);
    }

    const filename = name ? getSafeFilename(name) : '';
    const filePath = name ? path.join(SKILLS_DIR, filename) : '';

    switch (action) {
      case 'create': {
        try {
          await fs.access(filePath);
          return { success: false, error: `Skill "${name}" already exists at ${filename}. Use "update" to modify it.` };
        } catch (e) {
          // File does not exist, safe to create
        }

        const frontmatter = [
          '---',
          `name: "${name}"`,
          `description: "${description || ''}"`,
          `tags: ${JSON.stringify(tags || [])}`,
          '---',
          content || ''
        ].join('\n');

        await fs.writeFile(filePath, frontmatter, 'utf-8');
        return { success: true, message: `Skill "${name}" created successfully at ${filename}.` };
      }

      case 'read': {
        try {
          const rawText = await fs.readFile(filePath, 'utf-8');
          const { data, content: body } = parseFrontmatter(rawText);
          return {
            success: true,
            name: data.name || name,
            description: data.description || '',
            tags: data.tags || [],
            content: body
          };
        } catch (err: any) {
          return { success: false, error: `Skill "${name}" not found: ${err.message}` };
        }
      }

      case 'update': {
        try {
          const rawText = await fs.readFile(filePath, 'utf-8');
          const { data, content: existingBody } = parseFrontmatter(rawText);

          const finalName = name || data.name;
          const finalDesc = description !== undefined ? description : data.description;
          const finalTags = tags !== undefined ? tags : data.tags;
          const finalContent = content !== undefined ? content : existingBody;

          const frontmatter = [
            '---',
            `name: "${finalName}"`,
            `description: "${finalDesc || ''}"`,
            `tags: ${JSON.stringify(finalTags || [])}`,
            '---',
            finalContent || ''
          ].join('\n');

          await fs.writeFile(filePath, frontmatter, 'utf-8');
          return { success: true, message: `Skill "${name}" updated successfully.` };
        } catch (err: any) {
          return { success: false, error: `Failed to update skill "${name}": ${err.message}` };
        }
      }

      case 'delete': {
        try {
          await fs.unlink(filePath);
          return { success: true, message: `Skill "${name}" deleted successfully.` };
        } catch (err: any) {
          return { success: false, error: `Failed to delete skill "${name}": ${err.message}` };
        }
      }

      case 'list': {
        try {
          const files = await fs.readdir(SKILLS_DIR);
          const mdFiles = files.filter(f => f.endsWith('.md'));
          const skillsList = [];

          for (const file of mdFiles) {
            const rawText = await fs.readFile(path.join(SKILLS_DIR, file), 'utf-8');
            const { data } = parseFrontmatter(rawText);
            skillsList.push({
              name: data.name || path.basename(file, '.md'),
              description: data.description || '',
              tags: data.tags || []
            });
          }

          return { success: true, skills: skillsList };
        } catch (err: any) {
          return { success: false, error: `Failed to list skills: ${err.message}` };
        }
      }

      default:
        throw new Error(`Invalid skill_manage action: ${action}`);
    }
  }
};
