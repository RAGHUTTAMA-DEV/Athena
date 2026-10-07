import { Message } from './types.js';
import { EpisodicMemory } from './memory.js';
import { ProceduralMemory, Skill } from './procedural.js';
import { ScopedMemoryItem, ContextBudget, AssembledContext, MemoryScope } from './memoryTypes.js';

export function estimateTokens(text: string): number {
  if (!text) return 0;
  // Standard rule-of-thumb: ~4 characters per token for English & code
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += m.role.length;
    for (const p of m.parts) {
      if ('text' in p && typeof p.text === 'string') {
        chars += p.text.length;
      } else if ('functionCall' in p) {
        chars += JSON.stringify(p.functionCall).length;
      } else if ('functionResponse' in p) {
        chars += JSON.stringify(p.functionResponse).length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

export interface ContextEngineOptions {
  userPrompt: string;
  history: Message[];
  systemPrompt: string;
  soul?: string;
  sessionId?: string;
  memory?: EpisodicMemory | null;
  procedural?: ProceduralMemory | null;
  budget?: ContextBudget;
  workspaceDir?: string;
  /** Active bindings. Facts bound to a different workspace are not retrieved. */
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
}

export class ContextEngine {
  private defaultBudget: Required<ContextBudget> = {
    maxContextTokens: 16000,
    systemPromptTokenLimit: 4000,
    memoryTokenLimit: 2000,
    skillsTokenLimit: 3000,
    historyTokenLimit: 7000
  };

  async assemble(opts: ContextEngineOptions): Promise<AssembledContext> {
    const budget = { ...this.defaultBudget, ...opts.budget };
    const workspaceDir = opts.workspaceDir || process.cwd();

    // 1. Build Base System Instruction
    let systemText = opts.systemPrompt;
    if (opts.soul) {
      systemText = `${opts.soul}\n\nOperational Instructions:\n${systemText}`;
    }

    const dateOptions: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };
    const currentDateTime = new Date().toLocaleDateString('en-US', dateOptions);

    systemText += `\n\nCurrent System Date and Time: ${currentDateTime}\nCurrent Working Directory: ${workspaceDir}`;
    systemText += `\n\nMEMORY CONTRACT: You have persistent multi-scope memory. Verified facts in [SCOPED MEMORY] and procedural skills in [PROCEDURAL SKILLS] are authoritative and calibrated by confidence scores. Never say your memory resets between sessions.`;

    // 2. Retrieve Scoped Memories within Budget
    const includedFacts: ScopedMemoryItem[] = [];
    let memoryBlock = '';
    let memoryTokens = 0;

    if (opts.memory) {
      try {
        const candidateFacts = await opts.memory.searchScopedMemory({
          query: opts.userPrompt,
          sessionId: opts.sessionId,
          limit: 10,
          threshold: 0.40,
          minConfidence: 0.20,
          ...(opts.workspaceId !== undefined ? { workspaceId: opts.workspaceId } : {}),
          ...(opts.projectId !== undefined ? { projectId: opts.projectId } : {}),
          ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {})
        });

        // Add candidate facts that fit within budget
        const factLines: string[] = [];
        for (const fact of candidateFacts) {
          const confidencePct = Math.round(fact.confidence * 100);
          const line = `- [${fact.scope.toUpperCase()} | Conf: ${confidencePct}% | Source: ${fact.provenance.source}] ${fact.fact}`;
          const lineTokens = estimateTokens(line);

          if (memoryTokens + lineTokens <= budget.memoryTokenLimit) {
            includedFacts.push(fact);
            factLines.push(line);
            memoryTokens += lineTokens;
          }
        }

        if (factLines.length > 0) {
          memoryBlock = `\n\n[SCOPED MEMORY]\n` + factLines.join('\n');
        }
      } catch (err: any) {
        console.warn(`[ContextEngine] Failed to retrieve scoped memory: ${err.message}`);
      }
    }

    // 3. Retrieve Procedural Skills within Budget
    const includedSkills: Skill[] = [];
    let skillsBlock = '';
    let skillsTokens = 0;

    if (opts.procedural) {
      try {
        const candidateSkills = await opts.procedural.searchSkills(opts.userPrompt, 4);
        const skillEntries: string[] = [];

        for (const skill of candidateSkills) {
          const formatted = `### Skill: ${skill.name}\n${skill.content}`;
          const skillTokenCost = estimateTokens(formatted);

          if (skillsTokens + skillTokenCost <= budget.skillsTokenLimit) {
            includedSkills.push(skill);
            skillEntries.push(formatted);
            skillsTokens += skillTokenCost;
          }
        }

        if (skillEntries.length > 0) {
          skillsBlock = `\n\n[PROCEDURAL SKILLS]\nCRITICAL DIRECTIVE: Follow the design principles, workflows, and standards in the following matched skill instructions:\n\n` +
            skillEntries.join('\n\n');
        }
      } catch (err: any) {
        console.warn(`[ContextEngine] Failed to retrieve procedural skills: ${err.message}`);
      }
    }

    // 4. Assemble Final System Instruction
    const fullSystemInstruction = systemText + memoryBlock + skillsBlock;
    const systemTokens = estimateTokens(fullSystemInstruction);

    // 5. Budget-Aware Conversation History Truncation
    const workingHistory: Message[] = [];
    let historyTokens = 0;

    // Iterate backwards from most recent message to preserve latest context
    const reversedHistory = [...opts.history].reverse();
    for (const msg of reversedHistory) {
      const msgTokens = estimateMessagesTokens([msg]);
      if (historyTokens + msgTokens <= budget.historyTokenLimit) {
        workingHistory.unshift(msg);
        historyTokens += msgTokens;
      } else {
        // Stop adding older messages when budget is reached
        break;
      }
    }

    return {
      systemInstruction: fullSystemInstruction,
      includedFacts,
      includedSkills,
      workingHistory,
      tokenEstimate: {
        system: systemTokens,
        memory: memoryTokens,
        skills: skillsTokens,
        history: historyTokens,
        total: systemTokens + historyTokens
      }
    };
  }
}
