import * as fs from 'fs';
import * as path from 'path';
import {
  ContextRef,
  ContextRefType,
  ResolvedContextRef
} from './memoryTypes.js';
import { estimateTokens } from './contextEngine.js';

export interface ContextRefResolverOptions {
  workspaceDir?: string;
  maxTokensPerRef?: number;
  maxRepoTokens?: number;
  stores?: {
    run?: any;
    goal?: any;
    task?: any;
    memory?: any;
    project?: any;
  };
}

export class ContextRefResolver {
  private workspaceDir: string;
  private maxTokensPerRef: number;
  private maxRepoTokens: number;
  private stores: ContextRefResolverOptions['stores'];

  constructor(options: ContextRefResolverOptions = {}) {
    this.workspaceDir = options.workspaceDir || process.cwd();
    this.maxTokensPerRef = options.maxTokensPerRef || 2500;
    this.maxRepoTokens = options.maxRepoTokens || 2000;
    this.stores = options.stores || {};
  }

  /**
   * Parse @references from prompt text.
   * Matches forms:
   *   @file:path/to/file.ts or @file(path/to/file.ts)
   *   @repo or @repo:path/to/repo
   *   @folder:src or @folder(src)
   *   @run:run_123 or @goal:goal_123
   *   @task:task_123 or @session:sess_123
   *   @memory:fact_query or @artifact:art_123
   *   @project:1 or @url:https://example.com
   */
  parseReferences(prompt: string): ContextRef[] {
    const refs: ContextRef[] = [];
    if (!prompt) return refs;

    // Pattern for typed references
    const refRegex = /@(file|folder|repo|url|session|run|goal|task|memory|artifact|project)(?::([^\s)]+)|\(([^)]+)\)|(?=\s|$))/gi;
    let match: RegExpExecArray | null;

    while ((match = refRegex.exec(prompt)) !== null) {
      const type = match[1].toLowerCase() as ContextRefType;
      let target = (match[2] || match[3] || '').trim();
      target = target.replace(/[,.;:]+$/, '');
      refs.push({
        type,
        target,
        raw: match[0]
      });
    }

    return refs;
  }

  /**
   * Resolves all parsed context references into bounded structured strings.
   */
  async resolveReferences(refs: ContextRef[]): Promise<ResolvedContextRef[]> {
    const results: ResolvedContextRef[] = [];

    for (const ref of refs) {
      try {
        let resolved: ResolvedContextRef;
        switch (ref.type) {
          case 'file':
            resolved = await this.resolveFile(ref);
            break;
          case 'folder':
            resolved = await this.resolveFolder(ref);
            break;
          case 'repo':
            resolved = await this.resolveRepo(ref);
            break;
          case 'url':
            resolved = this.resolveUrl(ref);
            break;
          case 'run':
            resolved = await this.resolveRun(ref);
            break;
          case 'goal':
            resolved = await this.resolveGoal(ref);
            break;
          case 'task':
            resolved = await this.resolveTask(ref);
            break;
          case 'memory':
            resolved = await this.resolveMemory(ref);
            break;
          case 'session':
            resolved = this.resolveSession(ref);
            break;
          case 'artifact':
            resolved = this.resolveArtifact(ref);
            break;
          case 'project':
            resolved = await this.resolveProject(ref);
            break;
          default:
            resolved = {
              ref,
              content: `[Unsupported reference type: ${ref.type}]`,
              tokenCount: 10,
              truncated: false
            };
        }
        results.push(resolved);
      } catch (err: any) {
        results.push({
          ref,
          content: `[Reference Error: Failed to resolve ${ref.raw} - ${err.message}]`,
          tokenCount: 15,
          truncated: false
        });
      }
    }

    return results;
  }

  private async resolveFile(ref: ContextRef): Promise<ResolvedContextRef> {
    const targetPath = ref.target ? path.resolve(this.workspaceDir, ref.target) : '';
    if (!targetPath || !fs.existsSync(targetPath)) {
      return {
        ref,
        content: `[File Reference: File not found at '${ref.target}']`,
        tokenCount: 15,
        truncated: false
      };
    }

    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      return this.resolveFolder(ref);
    }

    const rawContent = fs.readFileSync(targetPath, 'utf8');
    const lines = rawContent.split('\n');
    let outputLines: string[] = [];
    let truncated = false;
    let accumulatedTokens = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineStr = `${i + 1}: ${lines[i]}`;
      const lineTokens = estimateTokens(lineStr);
      if (accumulatedTokens + lineTokens > this.maxTokensPerRef) {
        truncated = true;
        outputLines.push(`... [Truncated: ${lines.length - i} remaining lines omitted to stay within context budget]`);
        break;
      }
      outputLines.push(lineStr);
      accumulatedTokens += lineTokens;
    }

    const header = `--- File: ${ref.target} (${stat.size} bytes) ---\n`;
    const fullContent = header + outputLines.join('\n');

    return {
      ref,
      content: fullContent,
      tokenCount: estimateTokens(fullContent),
      truncated,
      metadata: { sizeBytes: stat.size, totalLines: lines.length }
    };
  }

  private async resolveFolder(ref: ContextRef): Promise<ResolvedContextRef> {
    const folderPath = ref.target ? path.resolve(this.workspaceDir, ref.target) : this.workspaceDir;
    if (!fs.existsSync(folderPath)) {
      return {
        ref,
        content: `[Folder Reference: Directory not found at '${ref.target}']`,
        tokenCount: 15,
        truncated: false
      };
    }

    const entries: string[] = [];
    let count = 0;
    const maxEntries = 40;

    const walk = (dir: string, depth: number) => {
      if (depth > 2 || count >= maxEntries) return;
      try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.') || item.name === 'node_modules' || item.name === 'dist') continue;
          count++;
          const relPath = path.relative(folderPath, path.join(dir, item.name));
          entries.push(`${item.isDirectory() ? '[DIR] ' : '      '}${relPath}`);
          if (item.isDirectory() && count < maxEntries) {
            walk(path.join(dir, item.name), depth + 1);
          }
        }
      } catch {}
    };

    walk(folderPath, 1);
    const content = `--- Folder: ${ref.target || '.'} ---\n` + entries.join('\n');
    return {
      ref,
      content,
      tokenCount: estimateTokens(content),
      truncated: count >= maxEntries
    };
  }

  /**
   * Section 49 / Exit Criterion 3:
   * Bounded @repo summary that strictly stays within context budget on large repositories.
   */
  private async resolveRepo(ref: ContextRef): Promise<ResolvedContextRef> {
    const repoPath = ref.target ? path.resolve(this.workspaceDir, ref.target) : this.workspaceDir;
    if (!fs.existsSync(repoPath)) {
      return {
        ref,
        content: `[Repo Reference: Repository root not found at '${ref.target}']`,
        tokenCount: 15,
        truncated: false
      };
    }

    const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', '.next', 'coverage', '.gemini']);
    const topLevelDirs: string[] = [];
    const topLevelFiles: string[] = [];
    let totalFileCount = 0;

    try {
      const rootItems = fs.readdirSync(repoPath, { withFileTypes: true });
      for (const item of rootItems) {
        if (ignoredDirs.has(item.name)) continue;
        if (item.isDirectory()) {
          topLevelDirs.push(item.name);
        } else {
          topLevelFiles.push(item.name);
          totalFileCount++;
        }
      }
    } catch {}

    // Extract package.json / project metadata if available
    let manifestInfo = '';
    const pkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        manifestInfo = `Package: ${pkg.name || 'unnamed'} v${pkg.version || '0.0.0'}\n` +
          `Main: ${pkg.main || 'index.js'}\n` +
          `Dependencies (${Object.keys(pkg.dependencies || {}).length}): ${Object.keys(pkg.dependencies || {}).slice(0, 15).join(', ')}`;
      } catch {}
    }

    // Extract README excerpt if available (first ~25 lines)
    let readmeExcerpt = '';
    const readmePath = path.join(repoPath, 'README.md');
    if (fs.existsSync(readmePath)) {
      try {
        const lines = fs.readFileSync(readmePath, 'utf8').split('\n').slice(0, 20);
        readmeExcerpt = `\nREADME Overview:\n${lines.join('\n')}`;
      } catch {}
    }

    const sections = [
      `=== Repository Summary: ${path.basename(repoPath)} ===`,
      `Root Directories: ${topLevelDirs.join(', ')}`,
      `Root Files: ${topLevelFiles.join(', ')}`,
      manifestInfo,
      readmeExcerpt
    ].filter(Boolean);

    let summary = sections.join('\n\n');
    let tokenCount = estimateTokens(summary);
    let truncated = false;

    // Enforce strict token cap
    if (tokenCount > this.maxRepoTokens) {
      truncated = true;
      const charsLimit = this.maxRepoTokens * 4;
      summary = summary.substring(0, charsLimit) + '\n... [Repo summary bounded to fit context budget]';
      tokenCount = estimateTokens(summary);
    }

    return {
      ref,
      content: summary,
      tokenCount,
      truncated,
      metadata: { repoPath, topLevelDirs }
    };
  }

  private resolveUrl(ref: ContextRef): ResolvedContextRef {
    return {
      ref,
      content: `[URL Reference: ${ref.target} (External resource)]`,
      tokenCount: 15,
      truncated: false
    };
  }

  private async resolveRun(ref: ContextRef): Promise<ResolvedContextRef> {
    if (this.stores?.run) {
      try {
        const run = await this.stores.run.get(ref.target);
        if (run) {
          const content = `[Run ${run.runId} | Status: ${run.status} | Task: ${run.task} | Turns: ${run.currentTurn}]`;
          return {
            ref,
            content,
            tokenCount: estimateTokens(content),
            truncated: false
          };
        }
      } catch {}
    }
    return {
      ref,
      content: `[Run Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private async resolveGoal(ref: ContextRef): Promise<ResolvedContextRef> {
    if (this.stores?.goal) {
      try {
        const goal = await this.stores.goal.get(ref.target);
        if (goal) {
          const content = `[Goal ${goal.id} | Title: "${goal.title}" | Status: ${goal.status} | Progress: ${Math.round(goal.progress * 100)}%]`;
          return {
            ref,
            content,
            tokenCount: estimateTokens(content),
            truncated: false
          };
        }
      } catch {}
    }
    return {
      ref,
      content: `[Goal Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private async resolveTask(ref: ContextRef): Promise<ResolvedContextRef> {
    if (this.stores?.task) {
      try {
        const task = await this.stores.task.get(ref.target);
        if (task) {
          const content = `[Task ${task.id} | Title: "${task.title}" | Status: ${task.status} | Attempts: ${task.attempts}]`;
          return {
            ref,
            content,
            tokenCount: estimateTokens(content),
            truncated: false
          };
        }
      } catch {}
    }
    return {
      ref,
      content: `[Task Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private async resolveMemory(ref: ContextRef): Promise<ResolvedContextRef> {
    if (this.stores?.memory) {
      try {
        const items = await this.stores.memory.search({
          query: ref.target,
          limit: 3
        });
        if (items.length > 0) {
          const facts = items.map((m: any) => `- [${m.scope}] ${m.fact}`).join('\n');
          const content = `[Memory Reference for "${ref.target}"]:\n${facts}`;
          return {
            ref,
            content,
            tokenCount: estimateTokens(content),
            truncated: false
          };
        }
      } catch {}
    }
    return {
      ref,
      content: `[Memory Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private resolveSession(ref: ContextRef): ResolvedContextRef {
    return {
      ref,
      content: `[Session Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private resolveArtifact(ref: ContextRef): ResolvedContextRef {
    return {
      ref,
      content: `[Artifact Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }

  private async resolveProject(ref: ContextRef): Promise<ResolvedContextRef> {
    if (this.stores?.project) {
      try {
        const numId = parseInt(ref.target, 10);
        if (!isNaN(numId)) {
          const p = await this.stores.project.get(numId);
          if (p) {
            const content = `[Project ${p.id}: "${p.name}" | Root: ${p.rootDirectory}]`;
            return {
              ref,
              content,
              tokenCount: estimateTokens(content),
              truncated: false
            };
          }
        }
      } catch {}
    }
    return {
      ref,
      content: `[Project Reference: ${ref.target}]`,
      tokenCount: 10,
      truncated: false
    };
  }
}
