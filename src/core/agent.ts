import { GoogleGenAI } from '@google/genai';
import { AgentConfig, Message, Part } from './types.js';
import { toolsRegistry } from '../tools/index.js';
import { EpisodicMemory } from './memory.js';
import { ProceduralMemory } from './procedural.js';
import * as fs from 'fs/promises';
import * as path from 'path';

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

  // Execute the agent run
  async run(
    userPrompt: string,
    history: Message[],
    onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void,
    confirm?: (toolName: string, args: any) => Promise<boolean>,
    sessionId?: string
  ): Promise<string> {
    // 1. Load Episodic History if sessionId is provided and local history is empty
    let episodicCount = 0;
    if (sessionId && this.memory && history.length === 0) {
      try {
        const dbHistory = await this.memory.loadHistory(sessionId);
        history.push(...dbHistory);
        episodicCount = dbHistory.length;
      } catch (err: any) {
        onUpdate?.({ type: 'error', message: `Failed to load history from database: ${err.message}` });
      }
    }

    // 2. Retrieve Semantic Memory (RAG)
    let retrievedFacts: any[] = [];
    if (this.memory) {
      try {
        retrievedFacts = await this.memory.searchSemanticFacts(userPrompt, 3, 0.65);
      } catch (err: any) {
        onUpdate?.({ type: 'error', message: `Failed to search semantic memory: ${err.message}` });
      }
    }

    // 3. Retrieve Procedural Memory (Skills)
    let retrievedSkills: any[] = [];
    if (this.procedural) {
      try {
        retrievedSkills = await this.procedural.searchSkills(userPrompt, 2);
      } catch (err: any) {
        onUpdate?.({ type: 'error', message: `Failed to search procedural memory: ${err.message}` });
      }
    }

    // 4. Fire memory retrieval status update
    const factDetails = retrievedFacts.map(f => `"${f.fact}" [score: ${f.score.toFixed(2)}]`).join(', ') || 'none';
    const skillDetails = retrievedSkills.map(s => s.name).join(', ') || 'none';
    onUpdate?.({
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
        retrievedSkills.map(s => `- skill: ${s.name}\n  Instructions:\n  ${s.content}`).join('\n\n');
    }

    // 6. Prepare the session messages
    // Working Memory = User Prompt + Chat History + System Prompt
    const currentRunHistory: Message[] = [...history];
    
    // Add the new user message to current run context
    currentRunHistory.push({
      role: 'user',
      parts: [{ text: userPrompt }]
    });

    // 7. Prepare function declarations for Gemini
    const functionDeclarations = Array.from(toolsRegistry.values()).map(tool => tool.definition);

    let turns = 0;
    while (turns < this.config.maxTurns) {
      turns++;
      
      try {
        onUpdate?.({ type: 'thought', message: `Thinking (Turn ${turns}/${this.config.maxTurns})...` });

        // Call Gemini API
        const response = await this.ai.models.generateContent({
          model: this.config.modelName,
          contents: currentRunHistory as any,
          config: {
            systemInstruction,
            tools: functionDeclarations.length > 0 ? [{ functionDeclarations } as any] : undefined,
          }
        });

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
          // Model wants to call tools
          const toolResponseParts: Part[] = [];

          for (const call of functionCalls) {
            if (!call.name) {
              continue;
            }

            onUpdate?.({
              type: 'tool_call',
              message: `Calling tool: ${call.name} with args: ${JSON.stringify(call.args)}`
            });

            const tool = toolsRegistry.get(call.name);
            if (!tool) {
              const errMsg = `Tool ${call.name} not found in registry.`;
              onUpdate?.({ type: 'error', message: errMsg });
              toolResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: { success: false, error: errMsg }
                }
              });
              continue;
            }

            // Check for confirmation for risky actions
            if (tool.requiresConfirmation) {
              if (confirm) {
                onUpdate?.({
                  type: 'thought',
                  message: `Tool "${call.name}" requires confirmation. Awaiting user response...`
                });
                try {
                  const isApproved = await confirm(call.name, call.args);
                  if (!isApproved) {
                    const deniedMsg = `Permission denied by user for tool: ${call.name}`;
                    onUpdate?.({ type: 'error', message: deniedMsg });
                    toolResponseParts.push({
                      functionResponse: {
                        name: call.name,
                        response: { success: false, error: 'Permission denied by user.' }
                      }
                    });
                    continue;
                  }
                } catch (confirmErr: any) {
                  const errMsg = `Confirmation process failed: ${confirmErr.message}`;
                  onUpdate?.({ type: 'error', message: errMsg });
                  toolResponseParts.push({
                    functionResponse: {
                      name: call.name,
                      response: { success: false, error: errMsg }
                    }
                  });
                  continue;
                }
              } else {
                // Deny by default if confirmation is required but no confirm callback was provided
                const blockedMsg = `Tool "${call.name}" blocked: Requires confirmation, but no confirmation callback was provided.`;
                onUpdate?.({ type: 'error', message: blockedMsg });
                toolResponseParts.push({
                  functionResponse: {
                    name: call.name,
                    response: { success: false, error: 'Blocked: Confirmation callback required.' }
                  }
                });
                continue;
              }
            }

            try {
              const result = await tool.execute(call.args, { confirm, memory: this.memory || undefined });
              onUpdate?.({
                type: 'tool_response',
                message: `Tool ${call.name} returned: ${JSON.stringify(result)}`
              });

              toolResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: result
                }
              });
            } catch (toolErr: any) {
              const errMsg = `Tool ${call.name} execution failed: ${toolErr.message}`;
              onUpdate?.({ type: 'error', message: errMsg });
              toolResponseParts.push({
                functionResponse: {
                  name: call.name,
                  response: { success: false, error: errMsg }
                }
              });
            }
          }

          // Push the tool responses back to the model as a user role message
          currentRunHistory.push({
            role: 'user',
            parts: toolResponseParts
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
            onUpdate?.({ type: 'error', message: `Failed to save message to database: ${err.message}` });
          }
        }

        return text;

      } catch (err: any) {
        onUpdate?.({ type: 'error', message: `API call failed: ${err.message}` });
        throw err;
      }
    }

    // If we exit the loop because we hit the maxTurns limit
    const warningText = `[Guardrail Alert] Max iterations (${this.config.maxTurns}) reached. Stopping run.`;
    onUpdate?.({ type: 'error', message: warningText });
    
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
        onUpdate?.({ type: 'error', message: `Failed to save guardrail alert to database: ${err.message}` });
      }
    }

    return warningText;
  }

  async clearHistory(sessionId: string): Promise<void> {
    if (this.memory) {
      await this.memory.clearHistory(sessionId);
    }
  }
}
