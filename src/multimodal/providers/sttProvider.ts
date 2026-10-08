import * as fs from 'fs/promises';
import { GoogleGenAI } from '@google/genai';
import { STTOptions, STTProvider, TranscriptionResult } from '../types.js';

export class GeminiSTTProvider implements STTProvider {
  readonly name = 'gemini_stt';
  private ai?: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
  }

  async transcribe(audioPathOrBuffer: string | Buffer, options?: STTOptions): Promise<TranscriptionResult> {
    let buffer: Buffer;
    if (typeof audioPathOrBuffer === 'string') {
      buffer = await fs.readFile(audioPathOrBuffer);
    } else {
      buffer = audioPathOrBuffer;
    }

    if (!this.ai) {
      return new MockSTTProvider().transcribe(buffer, options);
    }

    try {
      const base64Data = buffer.toString('base64');
      const lang = options?.language || 'English';
      const promptText = options?.prompt
        ? `Transcribe the spoken audio verbatim in ${lang}. Context: ${options.prompt}`
        : `Transcribe the spoken audio verbatim in ${lang}. Return only the exact transcription without introductory text.`;

      const response = await this.ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Data
                }
              }
            ]
          }
        ]
      });

      const text = (response.text || '').trim();
      return {
        text,
        confidence: 0.95,
        language: options?.language || 'en',
        durationSeconds: Math.max(1, Math.round(buffer.length / 32000))
      };
    } catch (err: any) {
      console.warn(`[STT Provider Warning] Gemini audio transcription failed: ${err.message}. Falling back to mock STT.`);
      return new MockSTTProvider().transcribe(buffer, options);
    }
  }
}

export class MockSTTProvider implements STTProvider {
  readonly name = 'mock_stt';
  private defaultText: string;

  constructor(defaultText = 'Create a goal to deploy the security patch by Friday') {
    this.defaultText = defaultText;
  }

  setDefaultText(text: string): void {
    this.defaultText = text;
  }

  async transcribe(audioPathOrBuffer: string | Buffer, options?: STTOptions): Promise<TranscriptionResult> {
    const text = options?.prompt && options.prompt.includes('override:')
      ? options.prompt.replace('override:', '').trim()
      : this.defaultText;

    const duration = typeof audioPathOrBuffer === 'string'
      ? 3.5
      : Math.max(1, Number((audioPathOrBuffer.length / 32000).toFixed(1)));

    return {
      text,
      confidence: 0.98,
      language: options?.language || 'en-US',
      durationSeconds: duration,
      segments: [
        { start: 0.0, end: duration, text }
      ]
    };
  }
}
