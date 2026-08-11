import { GoogleGenAI } from '@google/genai';
import { AgentConfig, Message, Part } from './types.js';
import { toolsRegistry } from '../tools/index.js';
import { EpisodicMemory } from './memory.js';
import { ProceduralMemory } from './procedural.js';
import { MemoryConsolidator } from './consolidation.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';


export class Agent {
  private ai: GoogleGenAI;
  private config: AgentConfig;
  private soul: string = '';
  private memory: EpisodicMemory | null = null;
  private procedural: ProceduralMemory | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not defined in the environment variables.');
    }
    this.ai = new GoogleGenAI({ apiKey });
  }

  // Load the soul persona from file system
  async init() {
    const skillsPath = this.config.skillsPath || './skills';
    this.procedural = new ProceduralMemory(path.resolve(skillsPath));

    if (this.config.soulPath) {
      try {
        const resolvedPath = path.resolve(this.config.soulPath);
        this.soul = await fs.readFile(resolvedPath, 'utf-8');
      } catch (err: any) {
        console.warn(`[Agent Warning] Failed to load SOUL.md from ${this.config.soulPath}: ${err.message}`);
      }
    }
    if (this.config.dbPath) {
      try {
        const resolvedPath = path.resolve(this.config.dbPath);
        this.memory = new EpisodicMemory(resolvedPath);
        await this.memory.init();
      } catch (err: any) {
        console.warn(`[Agent Warning] Failed to initialize SQLite database at ${this.config.dbPath}: ${err.message}`);
      }
    }
  }

  async run(
    userPrompt: string,
    history: Message[],
    onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void,
    confirm?: (toolName: string, args: any) => Promise<boolean>,
    sessionId?: string
  ): Promise<string> {
    return startActiveObservation(
      this.config.taskId || 'agent-run',
      async (traceSpan) => {
        traceSpan.update({
          input: userPrompt,
          metadata: {
            modelName: this.config.modelName,
            maxTurns: this.config.maxTurns,
            depth: this.config.depth || 0,
            taskId: this.config.taskId,
          }
        });

        const finalResult = await propagateAttributes(
          {
            sessionId: sessionId || 'default-session',
            tags: [this.config.taskId || 'agent-run'],
            metadata: {
              depth: String(this.config.depth || 0)
            }
          },
          async () => {
            return this.runInternal(userPrompt, history, onUpdate, confirm, sessionId);
          }
        );

        traceSpan.update({ output: finalResult });
        return finalResult;
      }
    );
  }

  private async runInternal(
    userPrompt: string,
    history: Message[],
    onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void,
    confirm?: (toolName: string, args: any) => Promise<boolean>,
    sessionId?: string
  ): Promise<string> {
    const logPrefix = this.config.taskId ? `[${this.config.taskId}] ` : '';
    const safeOnUpdate = (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => {
      if (onUpdate) {
        onUpdate({
          type: status.type,
          message: logPrefix ? `${logPrefix}${status.message}` : status.message
        });
      }
    };

    // Serialized confirmation handler to avoid interleaved confirmation requests
    let confirmChain = Promise.resolve();
    const serializedConfirm = async (toolName: string, args: any): Promise<boolean> => {
      let resolveConfirm: (val: boolean) => void;
      const confirmPromise = new Promise<boolean>((resolve) => {
        resolveConfirm = resolve;
      });

      confirmChain = confirmChain.then(async () => {
        if (!confirm) {
          resolveConfirm(false);
          return;
        }
        try {
          const approved = await confirm(toolName, args);
          resolveConfirm(approved);
        } catch (err) {
          resolveConfirm(false);
        }
      });

      return confirmPromise;
    };

    // 1. Load Episodic History if sessionId is provided and local history is empty
    let episodicCount = 0;
    if (sessionId && this.memory && history.length === 0) {
      try {
        const dbHistory = await this.memory.loadHistory(sessionId);
        history.push(...dbHistory);
        episodicCount = dbHistory.length;
      } catch (err: any) {
        safeOnUpdate({ type: 'error', message: `Failed to load history from database: ${err.message}` });
      }
    }

    // 2. Retrieve Semantic Memory (RAG)
    let retrievedFacts: any[] = [];
    if (this.memory) {
      try {
        retrievedFacts = await this.memory.searchSemanticFacts(userPrompt, 3, 0.65);
      } catch (err: any) {
        safeOnUpdate({ type: 'error', message: `Failed to search semantic memory: ${err.message}` });
      }
    }

    // 3. Retrieve Procedural Memory (Skills)
    let retrievedSkills: any[] = [];
    if (this.procedural) {
      try {
        retrievedSkills = await this.procedural.searchSkills(userPrompt, 3);
      } catch (err: any) {
        safeOnUpdate({ type: 'error', message: `Failed to search procedural memory: ${err.message}` });
      }
    }

    // 4. Fire memory retrieval status update
    const factDetails = retrievedFacts.map(f => `"${f.fact}" [score: ${f.score.toFixed(2)}]`).join(', ') || 'none';
    const skillDetails = retrievedSkills.map(s => s.name).join(', ') || 'none';
    safeOnUpdate({
      type: 'memory',
      message: `Memory retrieved:\n` +
               `  - Episodic: loaded ${episodicCount} past turns for session.\n` +
               `  - Semantic: matched ${retrievedFacts.length} facts (${factDetails})\n` +
               `  - Procedural: matched ${retrievedSkills.length} skills (${skillDetails})`
    });

    // 5. Build system instruction (System Prompt + SOUL.md + Date/Time + Semantic/Procedural context)
    let systemInstruction = this.config.systemPrompt;
    if (this.soul) {
      systemInstruction = `${this.soul}\n\nOperational Instructions:\n${systemInstruction}`;
    }
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    };
    const currentDateTime = new Date().toLocaleDateString('en-US', options);
    systemInstruction = `${systemInstruction}\n\nCurrent System Date and Time: ${currentDateTime}`;

    if (retrievedFacts.length > 0) {
      systemInstruction = `${systemInstruction}\n\n[RELEVANT FACTS (Semantic Memory)]\n` + 
        retrievedFacts.map(f => `- ${f.fact}`).join('\n');
    }
    if (retrievedSkills.length > 0) {
      systemInstruction = `${systemInstruction}\n\n[RELEVANT SKILLS (Procedural Memory)]\n` +
        `CRITICAL DIRECTIVE: The user has requested or triggered procedural skill(s). You MUST strictly follow the design principles, workflows, guidelines, and output standards in the skill instructions below:\n\n` +
        retrievedSkills.map(s => `### Skill: ${s.name}\n${s.content}`).join('\n\n');
    }

    // 6. Prepare the session messages
    // Working Memory = User Prompt + Chat History + System Prompt
    const currentRunHistory: Message[] = [...history];
    
    // Add the new user message to current run context
    currentRunHistory.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    // 7. Prepare function declarations for Gemini (scoped to allowedTools)
    const functionDeclarations = Array.from(toolsRegistry.values())
      .filter(tool => !this.config.allowedTools || this.config.allowedTools.includes(tool.definition.name))
      .map(tool => tool.definition);

    let currentMaxTurns = this.config.maxTurns;
    let turns = 0;
    while (turns < currentMaxTurns) {
      turns++;
      
      // Before generation, prune older browser responses in currentRunHistory to free up tokens
      pruneBrowserHistory(currentRunHistory);
      
      try {
        safeOnUpdate({ type: 'thought', message: `Thinking (Turn ${turns}/${currentMaxTurns})...` });

        // Call Gemini API wrapped in a Langfuse generation span
        const response = await startActiveObservation(
          `gemini-generation-turn-${turns}`,
          async (generation) => {
            generation.update({
              input: JSON.stringify(currentRunHistory),
              model: this.config.modelName,
            });

            const res = await this.ai.models.generateContent({
              model: this.config.modelName,
              contents: currentRunHistory as any,
              config: {
                systemInstruction,
                tools: functionDeclarations.length > 0 ? [{ functionDeclarations } as any] : undefined,
              }
            });

            const usage = res.usageMetadata ? {
              input: res.usageMetadata.promptTokenCount || 0,
              output: res.usageMetadata.candidatesTokenCount || 0,
              total: res.usageMetadata.totalTokenCount || 0,
            } : undefined;

            generation.update({
              output: JSON.stringify(res.candidates?.[0]?.content || {}),
              usageDetails: usage,
            });

            return res;
          },
          { asType: 'generation' }
        );

        // Add model response to history
        const modelContent = response.candidates?.[0]?.content;
        if (!modelContent) {
          throw new Error('Model returned an empty response.');
        }

        // Keep the model's message in the current run history
        currentRunHistory.push({
          role: 'model',
          parts: modelContent.parts as Part[]
        });

        // Check for function calls
        const functionCalls = response.functionCalls;
        if (functionCalls && functionCalls.length > 0) {
          // Model wants to call tools concurrently
          const toolResponseParts: Part[] = new Array(functionCalls.length);

          const tasks = functionCalls.map((call, idx) => async () => {
            if (!call.name) {
              toolResponseParts[idx] = {
                functionResponse: {
                  name: '',
                  response: { success: false, error: 'Empty function call name.' }
                }
              };
              return;
            }

            safeOnUpdate({
              type: 'tool_call',
              message: `Calling tool: ${call.name} with args: ${JSON.stringify(call.args)}`
            });

            // Enforce tool scoping
            const isAllowed = !this.config.allowedTools || this.config.allowedTools.includes(call.name);
            const tool = isAllowed ? toolsRegistry.get(call.name) : null;
            if (!tool) {
              const errMsg = !isAllowed
                ? `Tool "${call.name}" is not permitted for this agent run.`
                : `Tool "${call.name}" not found in registry.`;
              safeOnUpdate({ type: 'error', message: errMsg });
              toolResponseParts[idx] = {
                functionResponse: {
                  name: call.name,
                  response: { success: false, error: errMsg }
                }
              };
              return;
            }

            // Dynamically increase turns if a browser tool is executed
            if (call.name === 'browserNavigate' || call.name === 'browserAction') {
              currentMaxTurns = Math.max(currentMaxTurns, 25);
            }

            // Check for confirmation for risky actions
            if (tool.requiresConfirmation) {
              safeOnUpdate({
                type: 'thought',
                message: `Tool "${call.name}" requires confirmation. Awaiting user response...`
              });
              try {
                const isApproved = await serializedConfirm(call.name, call.args);
                if (!isApproved) {
                  const deniedMsg = `Permission denied by user for tool: ${call.name}`;
                  safeOnUpdate({ type: 'error', message: deniedMsg });
                  toolResponseParts[idx] = {
                    functionResponse: {
                      name: call.name,
                      response: { success: false, error: 'Permission denied by user.' }
                    }
                  };
                  return;
                }
              } catch (confirmErr: any) {
                const errMsg = `Confirmation process failed: ${confirmErr.message}`;
                safeOnUpdate({ type: 'error', message: errMsg });
                toolResponseParts[idx] = {
                  functionResponse: {
                    name: call.name,
                    response: { success: false, error: errMsg }
                  }
                };
                return;
              }
            }

            try {
              const toolContext = {
                confirm,
                memory: this.memory || undefined,
                depth: this.config.depth || 0,
                parentRunId: sessionId,
                onUpdate: safeOnUpdate
              };

              const result = await startActiveObservation(
                `tool-${call.name}`,
                async (toolSpan) => {
                  toolSpan.update({
                    input: JSON.stringify(call.args),
                  });

                  const res = await tool.execute(call.args, toolContext);

                  toolSpan.update({
                    output: JSON.stringify(res),
                  });

                  return res;
                }
              );
              safeOnUpdate({
                type: 'tool_response',
                message: `Tool ${call.name} returned: ${JSON.stringify(result)}`
              });

              toolResponseParts[idx] = {
                functionResponse: {
                  name: call.name,
                  response: result
                }
              };
            } catch (toolErr: any) {
              const errMsg = `Tool ${call.name} execution failed: ${toolErr.message}`;
              safeOnUpdate({ type: 'error', message: errMsg });
              toolResponseParts[idx] = {
                functionResponse: {
                  name: call.name,
                  response: { success: false, error: errMsg }
                }
              };
            }
          });

          // Run tool calls concurrently, capped at 3
          await runWithConcurrencyLimit(tasks, 3);

          // Push the tool responses back to the model as a user role message
          currentRunHistory.push({
            role: 'user',
            parts: toolResponseParts.filter(Boolean)
          });

          // Continue the loop to let the model process the tool responses
          continue;
        }

        // No function calls, this is the final answer!
        const text = response.text || '';
        
        // Push the user prompt and final model response to the persistent history
        history.push({
          role: 'user',
          parts: [{ text: userPrompt }]
        });
        history.push({
          role: 'model',
          parts: [{ text }]
        });

        // Save to SQLite database if sessionId is provided and database is active
        if (sessionId && this.memory) {
          try {
            await this.memory.saveMessage(sessionId, 'user', [{ text: userPrompt }]);
            await this.memory.saveMessage(sessionId, 'model', [{ text }]);
          } catch (err: any) {
            safeOnUpdate({ type: 'error', message: `Failed to save message to database: ${err.message}` });
          }
        }

        // Trigger background consolidation check
        this.triggerBackgroundConsolidation().catch(err => {
          console.error('[Agent Consolidation Error]', err);
        });

        return text;

      } catch (err: any) {
        safeOnUpdate({ type: 'error', message: `API call failed: ${err.message}` });
        throw err;
      }
    }

    // If we exit the loop because we hit the maxTurns limit
    const warningText = `[Guardrail Alert] Max iterations (${currentMaxTurns}) reached. Stopping run.`;
    safeOnUpdate({ type: 'error', message: warningText });
    
    // Add warning as final model turn so the user sees it
    history.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });
    history.push({
      role: 'model',
      parts: [{ text: warningText }]
    });

    // Save to SQLite database if sessionId is provided and database is active
    if (sessionId && this.memory) {
      try {
        await this.memory.saveMessage(sessionId, 'user', [{ text: userPrompt }]);
        await this.memory.saveMessage(sessionId, 'model', [{ text: warningText }]);
      } catch (err: any) {
        safeOnUpdate({ type: 'error', message: `Failed to save guardrail alert to database: ${err.message}` });
      }
    }

    // Trigger background consolidation check
    this.triggerBackgroundConsolidation().catch(err => {
      console.error('[Agent Consolidation Error]', err);
    });

    return warningText;
  }

  // Trigger background consolidation if threshold is met
  private async triggerBackgroundConsolidation(): Promise<void> {
    if (!this.memory || !this.procedural) return;

    try {
      const unconsolidatedCount = await this.memory.getUnconsolidatedCount();
      const threshold = this.config.consolidationThreshold !== undefined ? this.config.consolidationThreshold : 10;
      
      if (unconsolidatedCount >= threshold) {
        const consolidator = new MemoryConsolidator(
          this.memory,
          this.procedural,
          this.ai,
          this.config.skillsPath || './skills',
          this.config.modelName
        );

        // Run asynchronously without awaiting so the agent run returns quickly
        consolidator.consolidate().then(result => {
          if (result.factsExtracted > 0 || result.skillsCreated > 0) {
            console.log(`[Background Consolidation Done] Extracted ${result.factsExtracted} facts, created ${result.skillsCreated} skills.`);
          }
        }).catch(err => {
          if (err.message?.includes('SQLITE_MISUSE') || err.message?.includes('closed') || err.code === 'SQLITE_MISUSE') {
            // Silence DB closed errors since consolidation is asynchronous and database may close before it completes
            return;
          }
          console.error('[Background Consolidation Error]', err);
        });
      }
    } catch (err: any) {
      console.warn(`[Background Consolidation Trigger Failed] ${err.message}`);
    }
  }

  async clearHistory(sessionId: string): Promise<void> {
    if (this.memory) {
      await this.memory.clearHistory(sessionId);
    }
  }

  async getSessionsList(): Promise<{ sessionId: string; messageCount: number; lastActive: number }[]> {
    if (this.memory) {
      return this.memory.getSessionsList();
    }
    return [];
  }

  async renameSession(oldSessionId: string, newSessionId: string): Promise<void> {
    if (this.memory) {
      await this.memory.renameSession(oldSessionId, newSessionId);
    }
  }
}

async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < tasks.length) {
      const index = currentIndex++;
      results[index] = await tasks[index]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

function pruneBrowserHistory(history: Message[]): void {
  // Find all browser tool response parts in the history
  const browserResponses: { messageIdx: number; partIdx: number; part: any }[] = [];

  history.forEach((msg, mIdx) => {
    msg.parts.forEach((part, pIdx) => {
      if (part && 'functionResponse' in part) {
        const name = part.functionResponse.name;
        if (name === 'browserNavigate' || name === 'browserAction') {
          browserResponses.push({ messageIdx: mIdx, partIdx: pIdx, part });
        }
      }
    });
  });

  // If we have more than one browser response, prune all except the last one
  if (browserResponses.length > 1) {
    for (let i = 0; i < browserResponses.length - 1; i++) {
      const { part } = browserResponses[i];
      if (part.functionResponse?.response) {
        const resp = part.functionResponse.response;
        if (resp.interactiveElements) {
          // Replace interactiveElements with a compact placeholder to release token context
          resp.interactiveElements = [
            { note: "Interactive elements pruned from older history to save tokens." }
          ];
        }
      }
    }
  }
}
