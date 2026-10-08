import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { Message, Part, ProviderType } from '../runtime/types.js';

export interface LLMResponse {
  text?: string;
  functionCalls?: Array<{ id?: string; name: string; args: any }>;
  parts?: Part[];
  finishReason?: string;
  usageMetadata?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface LLMProvider {
  name: ProviderType;
  generateContent(params: {
    model: string;
    systemInstruction?: string;
    messages: Message[];
    tools?: any[]; // array of clean functionDeclarations
  }): Promise<LLMResponse>;
}

export class GeminiProvider implements LLMProvider {
  public name: ProviderType = 'gemini';
  private ai: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not defined in the environment variables.');
    }
    this.ai = new GoogleGenAI({ apiKey: key });
  }

  async generateContent(params: {
    model: string;
    systemInstruction?: string;
    messages: Message[];
    tools?: any[];
  }): Promise<LLMResponse> {
    const config: any = {};
    if (params.systemInstruction) {
      config.systemInstruction = params.systemInstruction;
    }
    if (params.tools && params.tools.length > 0) {
      config.tools = [{ functionDeclarations: params.tools }];
    }

    // Sanitize messages for Gemini to ensure clean structure without extra metadata fields
    const sanitizedMessages = params.messages.map(msg => ({
      role: msg.role,
      parts: msg.parts.map(p => {
        if ('functionResponse' in p && p.functionResponse) {
          return {
            functionResponse: {
              name: p.functionResponse.name,
              response: p.functionResponse.response
            }
          };
        }
        if ('functionCall' in p && p.functionCall) {
          return {
            functionCall: {
              name: p.functionCall.name,
              args: p.functionCall.args
            }
          };
        }
        return p;
      })
    }));

    const response = await this.ai.models.generateContent({
      model: params.model,
      contents: sanitizedMessages as any,
      config,
    });

    const candidate = response.candidates?.[0];
    const modelContent = candidate?.content;
    const finishReason = candidate?.finishReason || 'STOP';

    const functionCalls = response.functionCalls
      ? response.functionCalls
          .filter((call): call is { name: string; args?: any } => typeof call.name === 'string')
          .map((call) => ({
            id: (call as any).id,
            name: call.name,
            args: call.args || {},
          }))
      : undefined;

    const usageMetadata = response.usageMetadata ? {
      input: response.usageMetadata.promptTokenCount || 0,
      output: response.usageMetadata.candidatesTokenCount || 0,
      total: response.usageMetadata.totalTokenCount || 0,
    } : undefined;

    return {
      text: response.text || undefined,
      functionCalls,
      parts: modelContent?.parts as Part[] | undefined,
      finishReason,
      usageMetadata,
    };
  }
}

export class NvidiaProvider implements LLMProvider {
  public name: ProviderType = 'nvidia';
  private client: OpenAI;

  constructor(apiKey?: string, baseURL?: string) {
    const key = apiKey || process.env.NVIDIA_API_KEY;
    if (!key) {
      throw new Error('NVIDIA_API_KEY is not defined in the environment variables.');
    }
    const url = baseURL || process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1';
    this.client = new OpenAI({
      apiKey: key,
      baseURL: url,
    });
  }

  async generateContent(params: {
    model: string;
    systemInstruction?: string;
    messages: Message[];
    tools?: any[];
  }): Promise<LLMResponse> {
    const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

    if (params.systemInstruction) {
      openAiMessages.push({
        role: 'system',
        content: params.systemInstruction,
      });
    }

    // Convert Athena Messages to OpenAI ChatCompletionMessageParam array
    // Maintain a queue of pending tool calls to correlate with tool responses
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

    // Convert functionDeclarations (Gemini format) to OpenAI tools format
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
      model: params.model,
      messages: openAiMessages,
      ...(openAiTools && openAiTools.length > 0 ? { tools: openAiTools } : {}),
      temperature: 1,
      top_p: 1,
    };

    const completion = await this.client.chat.completions.create(requestPayload);

    const choice = completion.choices?.[0];
    const message = choice?.message;
    const finishReason = choice?.finish_reason || 'stop';

    let text: string | undefined = undefined;
    let functionCalls: Array<{ id?: string; name: string; args: any }> | undefined = undefined;
    const parts: Part[] = [];

    if (message?.content) {
      text = message.content;
      parts.push({ text: message.content });
    }

    if (message?.tool_calls && message.tool_calls.length > 0) {
      functionCalls = [];
      for (const tc of message.tool_calls) {
        if (tc.type === 'function' && tc.function) {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch (e) {
            parsedArgs = {};
          }
          functionCalls.push({
            id: tc.id,
            name: tc.function.name,
            args: parsedArgs,
          });
          parts.push({
            functionCall: {
              id: tc.id,
              name: tc.function.name,
              args: parsedArgs,
            },
          });
        }
      }
    }

    const usageMetadata = completion.usage ? {
      input: completion.usage.prompt_tokens || 0,
      output: completion.usage.completion_tokens || 0,
      total: completion.usage.total_tokens || 0,
    } : undefined;

    return {
      text,
      functionCalls,
      parts: parts.length > 0 ? parts : undefined,
      finishReason,
      usageMetadata,
    };
  }
}

export interface FallbackProviderOptions {
  primary: LLMProvider;
  fallback: LLMProvider;
  fallbackModel?: string;
  cooldownMs?: number;
  onFallback?: (error: any, fromProvider: string, toProvider: string) => void;
}

export class FallbackLLMProvider implements LLMProvider {
  public name: ProviderType;
  public primary: LLMProvider;
  public fallback: LLMProvider;
  private primaryFailedUntil: number = 0;
  private cooldownMs: number;
  private fallbackModel?: string;
  private onFallback?: (error: any, fromProvider: string, toProvider: string) => void;

  constructor(options: FallbackProviderOptions) {
    this.primary = options.primary;
    this.fallback = options.fallback;
    this.name = this.primary.name;
    this.cooldownMs = options.cooldownMs || 60000;
    this.fallbackModel = options.fallbackModel;
    this.onFallback = options.onFallback;
  }

  isPrimaryCoolingDown(): boolean {
    return Date.now() < this.primaryFailedUntil;
  }

  reset(): void {
    this.primaryFailedUntil = 0;
  }

  async generateContent(params: {
    model: string;
    systemInstruction?: string;
    messages: Message[];
    tools?: any[];
  }): Promise<LLMResponse> {
    const isCoolingDown = this.isPrimaryCoolingDown();

    if (!isCoolingDown) {
      try {
        return await this.primary.generateContent(params);
      } catch (err: any) {
        const errMsg = (err.message || String(err)).toLowerCase();
        const status = err.status || err.statusCode || err.response?.status;
        const isEligibleForFailover =
          status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504 ||
          errMsg.includes('429') ||
          errMsg.includes('rate limit') ||
          errMsg.includes('resource_exhausted') ||
          errMsg.includes('timeout') ||
          errMsg.includes('network error') ||
          errMsg.includes('econnreset') ||
          errMsg.includes('service unavailable');

        if (!isEligibleForFailover) {
          throw err;
        }

        this.primaryFailedUntil = Date.now() + this.cooldownMs;
        if (this.onFallback) {
          this.onFallback(err, this.primary.name, this.fallback.name);
        } else {
          console.warn(
            `[FallbackLLMProvider] Primary provider "${this.primary.name}" failed (${err.message}). Failing over to "${this.fallback.name}" for ${this.cooldownMs}ms.`
          );
        }
      }
    }

    const fallbackParams = {
      ...params,
      model: this.fallbackModel || (this.fallback.name === 'nvidia' ? 'meta/llama-3.1-70b-instruct' : params.model)
    };
    return await this.fallback.generateContent(fallbackParams);
  }
}

import { OllamaProvider } from './ollamaProvider.js';
export { OllamaProvider } from './ollamaProvider.js';

export function createLLMProvider(
  providerType?: ProviderType,
  options?: {
    apiKey?: string;
    baseUrl?: string;
    enableFallback?: boolean;
    fallbackApiKey?: string;
    ollamaBaseUrl?: string;
  }
): LLMProvider {
  const type = providerType || (process.env.LLM_PROVIDER as ProviderType) || 'gemini';

  let primary: LLMProvider;
  if (type === 'ollama') {
    primary = new OllamaProvider({ baseURL: options?.ollamaBaseUrl || options?.baseUrl });
  } else if (type === 'nvidia') {
    primary = new NvidiaProvider(options?.apiKey, options?.baseUrl);
  } else {
    primary = new GeminiProvider(options?.apiKey);
  }

  if (options?.enableFallback || process.env.ENABLE_LLM_FALLBACK === 'true') {
    const fallbackType = type === 'gemini' ? 'nvidia' : 'gemini';
    const hasFallbackKey = fallbackType === 'nvidia' ? (options?.fallbackApiKey || process.env.NVIDIA_API_KEY) : process.env.GEMINI_API_KEY;
    if (hasFallbackKey) {
      try {
        const fallback = fallbackType === 'nvidia'
          ? new NvidiaProvider(options?.fallbackApiKey)
          : new GeminiProvider();
        return new FallbackLLMProvider({ primary, fallback });
      } catch (e) {
        // If fallback provider initialization fails, return primary
      }
    }
  }

  return primary;
}

