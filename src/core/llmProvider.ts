import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { Message, Part, ProviderType } from './types.js';

export interface LLMResponse {
  text?: string;
  functionCalls?: Array<{ name: string; args: any }>;
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

    const response = await this.ai.models.generateContent({
      model: params.model,
      contents: params.messages as any,
      config,
    });

    const candidate = response.candidates?.[0];
    const modelContent = candidate?.content;
    const finishReason = candidate?.finishReason || 'STOP';

    const functionCalls = response.functionCalls
      ? response.functionCalls
          .filter((call): call is { name: string; args?: any } => typeof call.name === 'string')
          .map((call) => ({
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
    let callCounter = 0;
    for (const msg of params.messages) {
      if (msg.role === 'user') {
        const textParts: string[] = [];
        const toolResponses: Array<{ name: string; response: any }> = [];

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

        for (const tr of toolResponses) {
          openAiMessages.push({
            role: 'tool',
            tool_call_id: `call_${callCounter++}`,
            content: typeof tr.response === 'string' ? tr.response : JSON.stringify(tr.response),
          });
        }
      } else if (msg.role === 'model') {
        const textParts: string[] = [];
        const functionCalls: Array<{ name: string; args: any }> = [];

        for (const p of msg.parts) {
          if ('text' in p && p.text) {
            textParts.push(p.text);
          } else if ('functionCall' in p && p.functionCall) {
            functionCalls.push(p.functionCall);
          }
        }

        if (functionCalls.length > 0) {
          const tool_calls: OpenAI.Chat.ChatCompletionMessageToolCall[] = functionCalls.map((fc) => ({
            id: `call_${callCounter++}`,
            type: 'function',
            function: {
              name: fc.name,
              arguments: JSON.stringify(fc.args || {}),
            },
          }));

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
    let functionCalls: Array<{ name: string; args: any }> | undefined = undefined;
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
            name: tc.function.name,
            args: parsedArgs,
          });
          parts.push({
            functionCall: {
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

export function createLLMProvider(
  providerType?: ProviderType,
  options?: { apiKey?: string; baseUrl?: string }
): LLMProvider {
  const type = providerType || (process.env.LLM_PROVIDER as ProviderType) || 'gemini';

  if (type === 'nvidia') {
    return new NvidiaProvider(options?.apiKey, options?.baseUrl);
  } else {
    return new GeminiProvider(options?.apiKey);
  }
}
