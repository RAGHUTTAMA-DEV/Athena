import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';

/**
 * P4B EmbeddingProvider.
 *
 * Extracts the V1 embedding fallback chain (Gemini embedContent, then the
 * OpenAI-compatible endpoint, optionally NVIDIA) that used to live inside
 * EpisodicMemory.generateEmbedding into a replaceable provider. Behavior is
 * identical; EpisodicMemory now delegates here.
 */

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  /** True when at least one backend is configured. */
  isConfigured(): boolean;
  /** Returns null (never throws for "not configured") when no backend exists. */
  embed(text: string): Promise<number[] | null>;
}

export class ConfiguredEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'configured-embedding-provider';

  private apiKey?: string;
  private ai: GoogleGenAI | null = null;
  private openAIClient: OpenAI | null = null;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY;
  }

  get model(): string {
    const geminiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      return process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';
    }
    return (
      process.env.EMBEDDING_MODEL ||
      (process.env.OPENAI_API_KEY ? 'text-embedding-3-small' : 'nvidia/nv-embedqa-e5-v5')
    );
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY);
  }

  async embed(text: string): Promise<number[] | null> {
    const geminiKey = this.apiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      if (!this.ai) {
        this.ai = new GoogleGenAI({ apiKey: geminiKey });
      }
      const response = await this.ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
        contents: text
      });
      if (response.embeddings && response.embeddings[0]?.values) {
        return response.embeddings[0].values;
      }
      throw new Error('Gemini embedding values missing from response');
    }

    const openaiKey = process.env.OPENAI_API_KEY || process.env.NVIDIA_API_KEY;
    if (openaiKey) {
      if (!this.openAIClient) {
        const baseURL = process.env.OPENAI_BASE_URL || (process.env.NVIDIA_API_KEY && !process.env.OPENAI_API_KEY ? (process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1') : undefined);
        this.openAIClient = new OpenAI({ apiKey: openaiKey, baseURL });
      }
      const model = process.env.EMBEDDING_MODEL || (process.env.OPENAI_API_KEY ? 'text-embedding-3-small' : 'nvidia/nv-embedqa-e5-v5');
      const response = await this.openAIClient.embeddings.create({
        model,
        input: text
      });
      if (response.data && response.data[0]?.embedding) {
        return response.data[0].embedding;
      }
      throw new Error('OpenAI embedding values missing from response');
    }

    return null;
  }
}
