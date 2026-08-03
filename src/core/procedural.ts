import * as fs from 'fs/promises';
import * as path from 'path';

export interface Skill {
  filePath: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

export function parseFrontmatter(fileContent: string): { data: Record<string, any>; content: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: fileContent };
  }
  const frontmatterText = match[1];
  const bodyContent = match[2];
  
  const data: Record<string, any> = {};
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > -1) {
      const key = line.slice(0, colonIndex).trim();
      let valueText = line.slice(colonIndex + 1).trim();
      
      // Remove surrounding quotes if any
      if ((valueText.startsWith('"') && valueText.endsWith('"')) || 
          (valueText.startsWith("'") && valueText.endsWith("'"))) {
        valueText = valueText.slice(1, -1);
      }
      
      if (key === 'tags') {
        try {
          if (valueText.startsWith('[') && valueText.endsWith(']')) {
            data[key] = JSON.parse(valueText);
          } else {
            data[key] = valueText.split(',').map(t => t.trim()).filter(Boolean);
          }
        } catch (e) {
          data[key] = valueText.split(',').map(t => t.trim()).filter(Boolean);
        }
      } else {
        data[key] = valueText;
      }
    }
  }
  return { data, content: bodyContent };
}

async function getMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await getMarkdownFiles(fullPath)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  } catch (err: any) {
    // If directory doesn't exist, return empty array
  }
  return files;
}

export class ProceduralMemory {
  private skillsPath: string;

  constructor(skillsPath: string) {
    this.skillsPath = skillsPath;
  }

  async loadAllSkills(): Promise<Skill[]> {
    const files = await getMarkdownFiles(this.skillsPath);
    const skills: Skill[] = [];
    for (const file of files) {
      try {
        const text = await fs.readFile(file, 'utf-8');
        const { data, content } = parseFrontmatter(text);
        const name = data.name || path.basename(file, '.md');
        const description = data.description || '';
        const tags = data.tags || [];
        skills.push({
          filePath: file,
          name,
          description,
          tags,
          content
        });
      } catch (err: any) {
        console.warn(`[Procedural Memory Warning] Failed to parse skill file ${file}: ${err.message}`);
      }
    }
    return skills;
  }

  async searchSkills(query: string, limit: number = 2): Promise<Skill[]> {
    const skills = await this.loadAllSkills();
    const queryTokens = query.toLowerCase().split(/\W+/).filter(Boolean);
    if (queryTokens.length === 0) return [];

    const scored = skills.map(skill => {
      let score = 0;
      const nameTokens = skill.name.toLowerCase().split(/\W+/).filter(Boolean);
      const descTokens = skill.description.toLowerCase().split(/\W+/).filter(Boolean);
      const tagTokens = skill.tags.map(t => t.toLowerCase());

      for (const token of queryTokens) {
        if (nameTokens.includes(token)) score += 5;
        if (descTokens.includes(token)) score += 2;
        if (tagTokens.includes(token)) score += 3;
      }

      return { skill, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.skill)
      .slice(0, limit);
  }
}
