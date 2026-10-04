import { EpisodicMemory } from './memory.js';
import { ProceduralMemory, parseFrontmatter } from './procedural.js';
import { LLMProvider } from './llmProvider.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export class MemoryConsolidator {
  private memory: EpisodicMemory;
  private procedural: ProceduralMemory;
  private provider: LLMProvider;
  private skillsPath: string;
  private modelName: string;

  constructor(
    memory: EpisodicMemory,
    procedural: ProceduralMemory,
    provider: LLMProvider,
    skillsPath: string,
    modelName: string = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  ) {
    this.memory = memory;
    this.procedural = procedural;
    this.provider = provider;
    this.skillsPath = path.resolve(skillsPath);
    this.modelName = modelName;
  }

  async consolidate(limit: number = 20): Promise<{ factsExtracted: number; skillsCreated: number }> {
    const unconsolidated = await this.memory.getUnconsolidatedMessages(limit);
    if (unconsolidated.length === 0) {
      return { factsExtracted: 0, skillsCreated: 0 };
    }

    // 1. Format the transcript of the unconsolidated messages
    let transcript = '';
    const messageIds: number[] = [];

    for (const msg of unconsolidated) {
      messageIds.push(msg.id);
      let textContent = '';
      try {
        const parts = JSON.parse(msg.content);
        if (Array.isArray(parts)) {
          textContent = parts
            .map((p: any) => {
              if (p.text) return p.text;
              if (p.functionCall) return `[Call Tool: ${p.functionCall.name} with args: ${JSON.stringify(p.functionCall.args)}]`;
              if (p.functionResponse) return `[Tool Response for ${p.functionResponse.name}: ${JSON.stringify(p.functionResponse.response)}]`;
              return JSON.stringify(p);
            })
            .join(' ');
        } else {
          textContent = JSON.stringify(parts);
        }
      } catch (e) {
        textContent = String(msg.content);
      }
      transcript += `[${new Date(msg.timestamp).toISOString()}] ${msg.role.toUpperCase()}: ${textContent}\n`;
    }

    let factsExtracted = 0;
    let skillsCreated = 0;

    // 2. Distill Semantic Facts
    try {
      const factPrompt = `You are the memory consolidation subsystem of Athena, a self-improving local AI agent.
Your task is to analyze the following recent chat history and extract durable, long-term facts about the user or the environment (e.g. user's preferences, project configurations, directories, custom tools/rules, user name, habits).

Guidelines:
- Do not extract transient facts (e.g. "user asked to calculate 5+5", "user is testing a tool").
- Only extract stable, reusable facts that would help the agent in future sessions.
- Format each fact as a single clear standalone sentence.
- If no long-term facts are found, output nothing (or "NO_FACTS").

Conversation History:
${transcript}

Return the facts, one per line. Do not include any intro/outro text.`;

      const response = await this.provider.generateContent({
        model: this.modelName,
        messages: [{ role: 'user', parts: [{ text: factPrompt }] }]
      });

      const text = response.text || '';
      const lines = text
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0 && l !== 'NO_FACTS');

      for (const line of lines) {
        await this.memory.saveSemanticFact(line, ['consolidated']);
        factsExtracted++;
      }
    } catch (err: any) {
      console.warn(`[Consolidation Warning] Failed to distill semantic facts: ${err.message}`);
    }

    // 3. Distill Procedural Skills
    try {
      const skillPrompt = `You are the procedural memory consolidation subsystem of Athena, a self-improving local AI agent.
Your task is to analyze the following recent chat history and determine if the agent successfully performed a multi-step workflow, followed a complex custom procedure, or solved a setup problem that can be generalized into a reusable skill.

If such a skill was demonstrated, generate a new SKILL.md file for the agent's procedural memory.
The SKILL.md file MUST contain a YAML frontmatter followed by markdown instructions.

Format:
---
name: "Short descriptive skill name"
description: "When and why this skill should be retrieved and used"
tags: ["keyword1", "keyword2"]
---
# Instructions
Provide detailed, step-by-step instructions on how to perform this skill. Include tips, command templates, or constraints.

If no reusable, generalizable skill was demonstrated, reply EXACTLY with:
NO_SKILL_LEARNED

Conversation History:
${transcript}`;

      const skillResponse = await this.provider.generateContent({
        model: this.modelName,
        messages: [{ role: 'user', parts: [{ text: skillPrompt }] }]
      });

      const text = skillResponse.text || '';
      if (text.trim() !== 'NO_SKILL_LEARNED' && text.includes('---')) {
        const { data } = parseFrontmatter(text);
        const name = data.name;
        if (name) {
          // Check for existing similar skills to prevent duplicate proliferation
          const similarSkills = await this.procedural.searchSkills(name, 2);
          const topSimilar = similarSkills[0];

          // If a highly relevant skill already exists, attempt merging/updating instead of creating duplicates
          if (topSimilar) {
            const mergePrompt = `You are the procedural skill refinement subsystem of Athena.
A new candidate skill has been distilled from recent conversations:

[NEW CANDIDATE SKILL]
${text}

An existing skill with a similar topic already exists in the skills library:
[EXISTING SKILL: ${topSimilar.name}]
File: ${topSimilar.filePath}
---
name: "${topSimilar.name}"
description: "${topSimilar.description}"
tags: ${JSON.stringify(topSimilar.tags)}
---
${topSimilar.content}

TASK:
Compare both skills.
1. If the candidate skill adds new steps, edge-case solutions, fixes, or optimizations to the existing skill, generate an UPDATED, unified, comprehensive SKILL.md combining the best of both.
2. If the existing skill already covers the candidate skill completely and needs no changes, reply EXACTLY with:
NO_UPDATE_NEEDED
3. If the candidate skill represents a completely distinct and independent workflow that should NOT be merged, reply EXACTLY with:
KEEP_SEPARATE

Output only the updated SKILL.md (with YAML frontmatter) or the single decision keyword.`;

            const mergeResponse = await this.provider.generateContent({
              model: this.modelName,
              messages: [{ role: 'user', parts: [{ text: mergePrompt }] }]
            });

            const mergeText = (mergeResponse.text || '').trim();
            if (mergeText.includes('---') && !mergeText.includes('NO_UPDATE_NEEDED') && !mergeText.includes('KEEP_SEPARATE')) {
              // Update the existing skill with enriched knowledge
              await fs.writeFile(topSimilar.filePath, mergeText, 'utf-8');
              skillsCreated++;
              console.log(`[Consolidation] Merged & refined existing skill "${topSimilar.name}"`);
            } else if (mergeText.includes('KEEP_SEPARATE')) {
              // Create as a distinct new skill
              const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.md';
              const filePath = path.join(this.skillsPath, filename);
              await fs.mkdir(this.skillsPath, { recursive: true });
              await fs.writeFile(filePath, text, 'utf-8');
              skillsCreated++;
            }
            // If NO_UPDATE_NEEDED, cleanly avoid duplicate skill creation
          } else {
            // Truly novel skill: create new file
            const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.md';
            const filePath = path.join(this.skillsPath, filename);
            await fs.mkdir(this.skillsPath, { recursive: true });
            await fs.writeFile(filePath, text, 'utf-8');
            skillsCreated++;
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Consolidation Warning] Failed to distill procedural skills: ${err.message}`);
    }

    // 4. Mark messages as consolidated so they aren't processed again
    await this.memory.markAsConsolidated(messageIds);

    return { factsExtracted, skillsCreated };
  }
}
