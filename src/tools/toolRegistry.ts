import { Tool, ToolDefinition } from './toolTypes.js';

export interface ScoredTool {
  tool: Tool;
  score: number;
  matchedCapabilities: string[];
}

export interface ToolSearchOptions {
  limit?: number;
  capabilities?: string[];
  tags?: string[];
  minScore?: number;
}

export class SearchableToolRegistry {
  private toolsByName: Map<string, Tool> = new Map();
  private invertedIndex: Map<string, Set<string>> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  constructor(initialTools?: Tool[]) {
    if (initialTools) {
      for (const t of initialTools) {
        this.register(t);
      }
    }
  }

  public register(tool: Tool): void {
    const name = tool.definition.name;
    this.toolsByName.set(name, tool);

    // Index tokens from name and description
    const tokens = this.tokenize(`${name} ${tool.definition.description || ''}`);
    for (const token of tokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(name);
    }

    // Index capabilities
    const caps = tool.definition.capabilities || tool.manifest?.capabilities || tool.manifest?.permissions || [];
    for (const cap of caps) {
      const capKey = cap.toLowerCase();
      if (!this.capabilityIndex.has(capKey)) {
        this.capabilityIndex.set(capKey, new Set());
      }
      this.capabilityIndex.get(capKey)!.add(name);
    }

    // Index tags
    const tags = tool.definition.tags || tool.manifest?.tags || [];
    for (const tag of tags) {
      const tagKey = tag.toLowerCase();
      if (!this.tagIndex.has(tagKey)) {
        this.tagIndex.set(tagKey, new Set());
      }
      this.tagIndex.get(tagKey)!.add(name);
    }
  }

  public unregister(name: string): boolean {
    if (!this.toolsByName.has(name)) return false;
    this.toolsByName.delete(name);

    for (const set of this.invertedIndex.values()) set.delete(name);
    for (const set of this.capabilityIndex.values()) set.delete(name);
    for (const set of this.tagIndex.values()) set.delete(name);
    return true;
  }

  public get(name: string): Tool | undefined {
    return this.toolsByName.get(name);
  }

  public getAll(): Tool[] {
    return Array.from(this.toolsByName.values());
  }

  public size(): number {
    return this.toolsByName.size;
  }

  public search(query: string, options?: ToolSearchOptions): ScoredTool[] {
    const limit = options?.limit ?? 15;
    const minScore = options?.minScore ?? 0.1;
    const queryTokens = this.tokenize(query);
    const scores = new Map<string, { score: number; matchedCaps: string[] }>();

    // 1. Lexical and token matching over inverted index
    for (const token of queryTokens) {
      const matchingTools = this.invertedIndex.get(token);
      if (matchingTools) {
        for (const toolName of matchingTools) {
          const current = scores.get(toolName) || { score: 0, matchedCaps: [] };
          // Exact name match gets highest boost
          const tool = this.toolsByName.get(toolName);
          const isNameMatch = tool?.definition.name.toLowerCase().includes(token);
          current.score += isNameMatch ? 3.0 : 1.0;
          scores.set(toolName, current);
        }
      }
    }

    // 2. Capability boost
    if (options?.capabilities) {
      for (const cap of options.capabilities) {
        const matchingTools = this.capabilityIndex.get(cap.toLowerCase());
        if (matchingTools) {
          for (const toolName of matchingTools) {
            const current = scores.get(toolName) || { score: 0, matchedCaps: [] };
            current.score += 4.0;
            if (!current.matchedCaps.includes(cap)) current.matchedCaps.push(cap);
            scores.set(toolName, current);
          }
        }
      }
    }

    // 3. Tag boost
    if (options?.tags) {
      for (const tag of options.tags) {
        const matchingTools = this.tagIndex.get(tag.toLowerCase());
        if (matchingTools) {
          for (const toolName of matchingTools) {
            const current = scores.get(toolName) || { score: 0, matchedCaps: [] };
            current.score += 2.0;
            scores.set(toolName, current);
          }
        }
      }
    }

    const scoredList: ScoredTool[] = [];
    for (const [name, meta] of scores.entries()) {
      const tool = this.toolsByName.get(name);
      if (tool && meta.score >= minScore) {
        scoredList.push({
          tool,
          score: meta.score,
          matchedCapabilities: meta.matchedCaps
        });
      }
    }

    return scoredList
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }
}
