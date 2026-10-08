import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { ResearchEngine } from '../research/researchPipeline.js';

/**
 * P4B researchWeb: full web research pipeline
 * (search → retrieve → extract → reason → cross-check → synthesize → cite).
 * Output distinguishes source / inference / uncertainty per statement, with
 * 1-based citations into the sources list.
 */
export const researchWebTool: Tool = {
  definition: {
    name: 'researchWeb',
    description:
      'Run a full web research pipeline for a query: search, retrieve pages, extract key statements, cross-check across sources, and synthesize a cited report. Every finding is labeled source, inference, or uncertainty with explicit citations.',
    capabilities: ['research'],
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The research question to investigate on the web.'
        },
        maxSources: {
          type: 'INTEGER',
          description: 'Maximum number of sources to retrieve and cite (default 4).'
        }
      },
      required: ['query']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { query: string; maxSources?: number }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }
    const engine: ResearchEngine = (context.memory as EpisodicMemory).getResearchEngine();
    const report = await engine.research(args.query, { maxSources: args.maxSources });

    return {
      success: true,
      query: report.query,
      stages: report.stages,
      crossChecked: report.crossChecked,
      sources: report.sources,
      findings: report.findings.map((f) => ({
        statement: f.statement,
        label: f.label,
        citations: f.citations,
        confidence: f.confidence
      })),
      notes: report.notes
    };
  }
};
