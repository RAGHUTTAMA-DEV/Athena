import * as fs from 'fs/promises';
import * as path from 'path';

export interface Skill {
  filePath: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'her', 'here',
  'how', 'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'its', 'just', 'like', 'me', 'more',
  'most', 'my', 'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'out', 'over', 'own', 'same',
  'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this',
  'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself', 'yourselves',
  'good', 'proper', 'take', 'give', 'check', 'out', 'later', 'come', 'back', 'use', 'things'
]);

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function tokensMatch(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (t1.length > 3 && t2.length > 3) {
    const dist = levenshteinDistance(t1, t2);
    if (t1.length <= 6 && dist <= 1) return true;
    if (t1.length > 6 && dist <= 2) return true;
  }
  return false;
}

export function parseFrontmatter(fileContent: string): { data: Record<string, any>; content: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    const purposeMatch = fileContent.match(/\*\*Purpose:\*\*\s*([^\n\r]+)/i) || fileContent.match(/^#[^\n]*\n+([^\n\r]+)/m);
    const fallbackDesc = purposeMatch ? purposeMatch[1].trim() : '';
    return { data: { description: fallbackDesc }, content: fileContent };
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
    const cleanQuery = query.toLowerCase();
    const rawTokens = cleanQuery.split(/\W+/).filter(Boolean);
    const filteredTokens = rawTokens.filter(t => t.length > 1 && !STOP_WORDS.has(t));
    
    const queryTokens = filteredTokens.length > 0 ? filteredTokens : rawTokens.filter(t => t.length > 1);
    if (queryTokens.length === 0) return [];

    const normQuery = cleanQuery.replace(/[-_]/g, ' ');

    const scored = skills.map(skill => {
      let score = 0;
      const normName = skill.name.toLowerCase().replace(/[-_]/g, ' ');
      const nameTokens = skill.name.toLowerCase().split(/\W+/).filter(Boolean);
      const descTokens = skill.description.toLowerCase().split(/\W+/).filter(Boolean).filter(t => !STOP_WORDS.has(t));
      const tagTokens = skill.tags.map(t => t.toLowerCase()).filter(t => !STOP_WORDS.has(t));

      // 1. Exact or normalized name phrase match bonus
      if (normQuery.includes(normName)) {
        score += 100;
      } else {
        const matchingParts = nameTokens.filter(nToken => 
          queryTokens.some(qToken => tokensMatch(qToken, nToken))
        );
        if (matchingParts.length === nameTokens.length && nameTokens.length > 0) {
          score += 80;
        }
      }

      // 2. Token-level matching with fuzzy matching
      for (const qToken of queryTokens) {
        if (nameTokens.some(nToken => tokensMatch(qToken, nToken))) {
          score += 15;
        }
        if (tagTokens.some(tToken => tokensMatch(qToken, tToken))) {
          score += 8;
        }
        if (descTokens.some(dToken => tokensMatch(qToken, dToken))) {
          score += 4;
        }
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

