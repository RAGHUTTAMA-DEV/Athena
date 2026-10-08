import OpenAI from 'openai';
import { LLMProvider, LLMResponse } from './llmProvider.js';
import { Message, Part, ProviderType } from '../runtime/types.js';

export interface OllamaProviderOptions {
  model?: string;
  baseUrl?: string;
  baseURL?: string;
  mockResponse?: LLMResponse;
  isMock?: boolean;
  allowOfflineFallback?: boolean;
}

export class OllamaProvider implements LLMProvider {
  public name: ProviderType = 'ollama';
  public provider: ProviderType = 'ollama';
  public model: string = 'llama3:8b';
  private client: OpenAI;
  private baseURL: string;
  private isMock: boolean;
  private allowOfflineFallback: boolean;
  private mockResponse?: LLMResponse;

  constructor(options?: OllamaProviderOptions | string) {
    if (typeof options === 'string') {
      this.baseURL = options;
      this.isMock = false;
      this.allowOfflineFallback = false;
    } else {
      this.baseURL = options?.baseURL || options?.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      this.model = options?.model || 'llama3:8b';
      this.isMock = options?.isMock ?? false;
      this.allowOfflineFallback = options?.allowOfflineFallback ?? false;
      this.mockResponse = options?.mockResponse;
    }

    const v1Url = this.baseURL.endsWith('/v1') ? this.baseURL : `${this.baseURL.replace(/\/$/, '')}/v1`;
    this.client = new OpenAI({
      baseURL: v1Url,
      apiKey: 'ollama', // Ollama does not require a real API key
    });
  }

  getBaseURL(): string {
    return this.baseURL;
  }

  setMockResponse(resp: LLMResponse): void {
    this.mockResponse = resp;
    this.isMock = true;
  }

  async chat(
    messages: Array<{ role: string; content: string }>,
    tools?: any[]
  ): Promise<{ content: string; toolCalls?: any[] }> {
    const formattedMessages: Message[] = messages.map(m => ({
      role: m.role as any,
      parts: [{ text: m.content }]
    }));
    const resp = await this.generateContent({
      model: this.model,
      messages: formattedMessages,
      tools
    });
    return {
      content: resp.text || '',
      toolCalls: resp.functionCalls
    };
  }

  async generateContent(params: {
    model: string;
    systemInstruction?: string;
    messages: Message[];
    tools?: any[];
  }): Promise<LLMResponse> {
    if (this.isMock && this.mockResponse) {
      return this.mockResponse;
    }

    try {
      const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

      if (params.systemInstruction) {
        openAiMessages.push({
          role: 'system',
          content: params.systemInstruction,
        });
      }

      // Convert Athena Messages to OpenAI Chat format
      const pendingToolCalls: Array<{ id: string; name: string }> = [];

      for (let msgIdx = 0; msgIdx < params.messages.length; msgIdx++) {
        const msg = params.messages[msgIdx];
        if (msg.role === 'user') {
          const textParts: string[] = [];
          const toolResponses: Array<{ id?: string; name: string; response: any }> = [];

          for (const p of msg.parts) {
            if ('text' in p && p.text) {
              textParts.push(p.text);
            } else if ('functionResponse' in p && p.functionResponse) {
              toolResponses.push(p.functionResponse);
            }
          }

          if (textParts.length > 0) {
            openAiMessages.push({
              role: 'user',
              content: textParts.join('\n'),
            });
          }

          for (let trIdx = 0; trIdx < toolResponses.length; trIdx++) {
            const tr = toolResponses[trIdx];
            let toolCallId = tr.id;
            if (!toolCallId) {
              const pendingIdx = pendingToolCalls.findIndex(ptc => ptc.name === tr.name);
              if (pendingIdx !== -1) {
                toolCallId = pendingToolCalls.splice(pendingIdx, 1)[0].id;
              } else if (pendingToolCalls.length > 0) {
                toolCallId = pendingToolCalls.shift()!.id;
              } else {
                toolCallId = `call_${msgIdx}_${trIdx}`;
              }
            } else {
              const pendingIdx = pendingToolCalls.findIndex(ptc => ptc.id === toolCallId);
              if (pendingIdx !== -1) {
                pendingToolCalls.splice(pendingIdx, 1);
              }
            }

            openAiMessages.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response),
            });
          }
        } else if (msg.role === 'model') {
          const textParts: string[] = [];
          const functionCalls: Array<{ id?: string; name: string; args: any }> = [];

          for (const p of msg.parts) {
            if ('text' in p && p.text) {
              textParts.push(p.text);
            } else if ('functionCall' in p && p.functionCall) {
              functionCalls.push(p.functionCall);
            }
          }

          if (functionCalls.length > 0) {
            const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = functionCalls.map((fc, fcIdx) => {
              const callId = fc.id || `call_${msgIdx}_${fcIdx}`;
              pendingToolCalls.push({ id: callId, name: fc.name });
              return {
                id: callId,
                type: 'function',
                function: {
                  name: fc.name,
                  arguments: JSON.stringify(fc.args || {}),
                },
              };
            });

            openAiMessages.push({
              role: 'assistant',
              content: textParts.length > 0 ? textParts.join('\n') : null,
              tool_calls,
            });
          } else {
            openAiMessages.push({
              role: 'assistant',
              content: textParts.join('\n'),
            });
          }
        }
      }

      // Convert clean tool function declarations to OpenAI tools format
      let openAiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = undefined;
      if (params.tools && params.tools.length > 0) {
        openAiTools = params.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.parameters || { type: 'object', properties: {} },
          },
        }));
      }

      const requestPayload: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: params.model || process.env.OLLAMA_MODEL || 'llama3.2',
        messages: openAiMessages,
        ...(openAiTools && openAiTools.length > 0 ? { tools: openAiTools } : {}),
      };

      const completion = await this.client.chat.completions.create(requestPayload);
      const choice = completion.choices?.[0];
      const message = choice?.message;
      const finishReason = choice?.finish_reason || 'stop';

      const functionCalls = message?.tool_calls
        ? message.tool_calls.map((tc: any) => {
            let parsedArgs = {};
            try {
              parsedArgs = JSON.parse(tc.function?.arguments || '{}');
            } catch {
              parsedArgs = {};
            }
            return {
              id: tc.id,
              name: tc.function?.name || '',
              args: parsedArgs,
            };
          })
        : undefined;

      const text = message?.content || undefined;
      const parts: Part[] = [];
      if (text) {
        parts.push({ text });
      }
      if (functionCalls) {
        for (const fc of functionCalls) {
          parts.push({
            functionCall: {
              id: fc.id,
              name: fc.name,
              args: fc.args,
            },
          });
        }
      }

      const usageMetadata = completion.usage
        ? {
            input: completion.usage.prompt_tokens,
            output: completion.usage.completion_tokens,
            total: completion.usage.total_tokens,
          }
        : undefined;

      return {
        text,
        functionCalls,
        parts: parts.length > 0 ? parts : undefined,
        finishReason,
        usageMetadata,
      };
    } catch (err: any) {
      if (this.isMock || this.allowOfflineFallback) {
        return {
          text: `[Ollama Mock] Processed response for model "${params.model}".`,
          finishReason: 'stop',
          usageMetadata: { input: 50, output: 25, total: 75 }
        };
      }
      throw new Error(`[OllamaProvider] Failed to connect to Ollama at ${this.baseURL}: ${err.message}`);
    }
  }
}
