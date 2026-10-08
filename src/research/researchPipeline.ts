import { PromptDefense } from '../security/promptDefense.js';
import { searchWebTool } from '../tools/searchWeb.js';
import { stripHtml } from './documentParser.js';
import {
  ResearchFinding,
  ResearchReport,
  ResearchReport as Report,
  SourceRecord
} from './researchTypes.js';

/**
 * P4B Web Research pipeline (spec section 23):
 * search → retrieve → extract → reason → cross-check → synthesize → cite.
 *
 * Every synthesized statement carries an explicit epistemic label:
 *   - `source`: extractive statement quoted from one cited source
 *   - `inference`: pipeline-derived statement about cross-source agreement
 *   - `uncertainty`: conflicting or single-source claims that could not be
 *     corroborated
 *
 * All retrieved web content is untrusted: it passes through PromptDefense
 * before any statement extraction, and detected injection payloads are
 * neutralized + reported.
 */

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface RetrievedPage {
  url: string;
  title: string;
  text: string;
  injectionThreats: string[];
}

export type SearchFn = (query: string) => Promise<SearchResultItem[]>;
export type FetchFn = (url: string) => Promise<{ content: string; mimeType?: string }>;

export interface ResearchEngineDeps {
  /** Injectable for tests; defaults to the production searchWeb tool. */
  searchFn?: SearchFn;
  /** Injectable for tests; defaults to a bounded fetch of the raw page. */
  fetchFn?: FetchFn;
  promptDefense?: PromptDefense;
}

export interface ResearchOptions {
  maxSources?: number;
  maxCharsPerPage?: number;
  maxFindingsPerSource?: number;
  /** Fetch timeout per page in ms. */
  fetchTimeoutMs?: number;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are',
  'was', 'were', 'be', 'been', 'with', 'as', 'by', 'at', 'from', 'that',
  'this', 'it', 'its', 'their', 'they', 'which', 'who', 'what', 'when',
  'where', 'how', 'why', 'can', 'could', 'will', 'would', 'should', 'may',
  'about', 'into', 'than', 'then', 'also', 'has', 'have', 'had', 'not', 'no'
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z"'(\[]|\d)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 400);
}

export class ResearchEngine {
  private searchFn: SearchFn;
  private fetchFn: FetchFn;
  private defense: PromptDefense;

  constructor(deps: ResearchEngineDeps = {}) {
    this.searchFn = deps.searchFn || defaultSearch;
    this.fetchFn = deps.fetchFn || defaultFetch;
    this.defense = deps.promptDefense || PromptDefense.getInstance();
  }

  async research(query: string, options: ResearchOptions = {}): Promise<ResearchReport> {
    const maxSources = options.maxSources ?? 4;
    const maxCharsPerPage = options.maxCharsPerPage ?? 20000;
    const maxFindingsPerSource = options.maxFindingsPerSource ?? 3;
    const stages: string[] = ['search'];
    const notes: string[] = [];

    // --- Stage 1: search ---
    const searchResults = await this.searchFn(query);
    if (searchResults.length === 0) {
      return {
        query,
        sources: [],
        findings: [],
        crossChecked: false,
        generatedAt: Date.now(),
        stages,
        notes: ['Search returned no results.']
      };
    }

    // --- Stage 2: retrieve (all page content is untrusted) ---
    stages.push('retrieve');
    const retrieved: RetrievedPage[] = [];
    const seenUrls = new Set<string>();
    for (const result of searchResults) {
      if (retrieved.length >= maxSources) break;
      const normalizedUrl = result.url.replace(/[#?].*$/, '');
      if (seenUrls.has(normalizedUrl)) continue;
      seenUrls.add(normalizedUrl);

      try {
        const { content, mimeType } = await this.fetchFn(result.url);
        const isHtml =
          (mimeType && mimeType.includes('html')) || /^\s*<(!doctype|html|head|body|div|p)\b/i.test(content);
        const rawText = isHtml ? stripHtml(content) : content;
        const analysis = this.defense.analyzeAndSanitize(rawText.slice(0, maxCharsPerPage));
        if (analysis.hasInjection) {
          notes.push(
            `Injection payload neutralized on ${result.url} (threats: ${analysis.threats.join(', ')}).`
          );
        }
        retrieved.push({
          url: result.url,
          title: result.title,
          text: analysis.sanitizedContent,
          injectionThreats: analysis.threats
        });
      } catch (err: any) {
        notes.push(`Failed to retrieve ${result.url}: ${err?.message || String(err)}`);
      }
    }

    if (retrieved.length === 0) {
      return {
        query,
        sources: [],
        findings: [],
        crossChecked: false,
        generatedAt: Date.now(),
        stages,
        notes: [...notes, 'No sources could be retrieved.']
      };
    }

    // --- Stage 3: extract (key sentences per source) ---
    stages.push('extract');
    const sources: SourceRecord[] = retrieved.map((page, i) => ({
      index: i + 1,
      title: page.title,
      url: page.url,
      retrievedAt: Date.now(),
      contentChars: page.text.length
    }));

    const queryTerms = new Set(tokenize(query));
    interface Candidate {
      statement: string;
      sourceIndex: number;
      terms: Set<string>;
      similarityGroup?: number;
    }
    const candidates: Candidate[] = [];
    for (const page of retrieved) {
      const sentences = splitSentences(page.text);
      const scored = sentences
        .map((sentence) => {
          const terms = new Set(tokenize(sentence));
          let overlap = 0;
          for (const t of queryTerms) if (terms.has(t)) overlap++;
          return { sentence, terms, score: overlap / Math.max(queryTerms.size, 1) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, maxFindingsPerSource);
      for (const s of scored) {
        if (s.score > 0) {
          candidates.push({
            statement: s.sentence,
            sourceIndex: sources.find((src) => src.url === page.url)!.index,
            terms: s.terms
          });
        }
      }
    }

    // --- Stage 4: reason + cross-check (corroboration & conflict) ---
    stages.push('cross-check');
    const findings: ResearchFinding[] = [];
    const used = new Set<number>();

    // 4a. Corroboration: cluster candidates across DIFFERENT sources whose
    // statements are token-wise near-duplicates. These become merged
    // `source` findings with multiple citations (higher confidence).
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      const group = [i];
      for (let j = i + 1; j < candidates.length; j++) {
        if (used.has(j)) continue;
        if (candidates[j].sourceIndex === candidates[i].sourceIndex) continue;
        if (jaccard(candidates[i].terms, candidates[j].terms) >= 0.35) {
          group.push(j);
          used.add(j);
        }
      }
      used.add(i);
      const citations = [...new Set(group.map((g) => candidates[g].sourceIndex))].sort((a, b) => a - b);
      if (citations.length >= 2) {
        findings.push({
          statement: candidates[i].statement,
          label: 'source',
          citations,
          confidence: 0.9
        });
      }
    }

    // 4b. Single-source extractive statements not corroborated.
    for (let i = 0; i < candidates.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      findings.push({
        statement: candidates[i].statement,
        label: 'uncertainty',
        citations: [candidates[i].sourceIndex],
        confidence: 0.6
      });
    }

    // 4c. Conflict detection: same unit/term reported with different values
    // across sources → explicit uncertainty finding with both citations.
    const valueMentions = new Map<string, Map<string, Set<number>>>();
    for (const page of retrieved) {
      const valueMatches = page.text.matchAll(/(\d[\d.,]*\s*(?:%|percent|million|billion|usd|gb|kg|km|degrees?|years?|°\s?c))\b/gi);
      for (const m of valueMatches) {
        const termContext = nearestKeyword(m.input!, m.index!, queryTerms);
        if (!termContext) continue;
        if (!valueMentions.has(termContext)) valueMentions.set(termContext, new Map());
        const bag = valueMentions.get(termContext)!;
        const val = m[1].toLowerCase().replace(/,/g, '');
        if (!bag.has(val)) bag.set(val, new Set());
        bag.get(val)!.add(sources.find((s) => s.url === page.url)!.index);
      }
    }
    for (const [term, values] of valueMentions) {
      if (values.size >= 2) {
        const descriptions = [...values.entries()].map(([val, srcs]) => `${val} [${[...srcs].join(', ')}]`);
        findings.push({
          statement: `Retrieved sources report conflicting values for "${term}": ${descriptions.join(' vs ')}. The correct value could not be determined from the retrieved content alone.`,
          label: 'uncertainty',
          citations: [...new Set([...values.values()].flatMap((s) => [...s]))].sort((a, b) => a - b),
          confidence: 0.3
        });
      }
    }

    // 4d. Inference: coverage synthesis the pipeline itself derives.
    stages.push('reason');
    const sourceTermSets = retrieved.map((page) => new Set(tokenize(`${page.title} ${page.text.slice(0, 2000)}`)));
    const sharedTerms = new Set<string>();
    for (const term of queryTerms) {
      if (sourceTermSets.filter((s) => s.has(term)).length >= 2) sharedTerms.add(term);
    }
    if (sharedTerms.size > 0) {
      const covering = sources.map((s) => s.index);
      findings.push({
        statement: `Multiple retrieved sources independently cover the topics: ${[...sharedTerms].slice(0, 8).join(', ')}. This cross-source agreement was computed by the research pipeline, not stated by any single source.`,
        label: 'inference',
        citations: covering,
        confidence: 0.7
      });
    }

    // --- Stage 5: synthesize + cite ---
    stages.push('synthesize');
    findings.sort((a, b) => b.confidence - a.confidence);

    const report: Report = {
      query,
      sources,
      findings,
      crossChecked: findings.some((f) => f.label === 'source' && f.citations.length >= 2),
      generatedAt: Date.now(),
      stages,
      notes
    };
    return report;
  }
}

function nearestKeyword(text: string, index: number, keywords: Set<string>): string | null {
  const window = text.slice(Math.max(0, index - 80), index + 80).toLowerCase();
  for (const kw of keywords) {
    if (window.includes(kw)) return kw;
  }
  return null;
}

/** Default search: reuse the V1 searchWeb tool (DuckDuckGo → Yahoo fallback). */
async function defaultSearch(query: string): Promise<SearchResultItem[]> {
  const result = (await searchWebTool.execute({ query })) as any;
  if (!result || result.success !== true || !Array.isArray(result.results)) {
    return [];
  }
  return result.results as SearchResultItem[];
}

/** Default fetch: bounded raw-page fetch with a timeout. */
const DEFAULT_FETCH_TIMEOUT_MS = 15000;

async function defaultFetch(url: string): Promise<{ content: string; mimeType?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const mimeType = response.headers.get('content-type') || undefined;
    const content = await response.text();
    return { content, mimeType };
  } finally {
    clearTimeout(timeout);
  }
}
