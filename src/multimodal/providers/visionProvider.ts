import * as fs from 'fs/promises';
import * as path from 'path';
import { GoogleGenAI } from '@google/genai';
import { VisionAnalysisResult, VisionProvider } from '../types.js';

export function detectVisualMimeType(buffer: Buffer, filePath?: string): string {
  if (buffer.length >= 4) {
    if (buffer.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return 'image/webp';
    }
  }
  if (filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.bmp') return 'image/bmp';
  }
  return 'image/png';
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = 'gemini_vision';
  private ai?: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.ai);
  }

  async inspectBufferStrict(
    buffer: Buffer,
    mimeType?: string,
    prompt = 'Extract all readable text verbatim and describe any photos, signatures, stamps, seals, or visual anomalies.'
  ): Promise<string> {
    if (!this.ai) {
      throw new Error('GEMINI_API_KEY is not configured for vision inspection.');
    }
    const resolvedMime = mimeType || detectVisualMimeType(buffer);
    const base64Data = buffer.toString('base64');
    const response = await this.ai.models.generateContent({
      model: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: resolvedMime,
                data: base64Data
              }
            }
          ]
        }
      ]
    });
    const text = (response.text || '').trim();
    if (!text) {
      throw new Error('Gemini vision returned empty content.');
    }
    return text;
  }

  async analyzeImage(imagePathOrBuffer: string | Buffer, prompt = 'Describe this image, extract any visible text, and identify any user interface elements or errors.'): Promise<VisionAnalysisResult> {
    let buffer: Buffer;
    let sourcePath: string | undefined;
    if (typeof imagePathOrBuffer === 'string') {
      sourcePath = imagePathOrBuffer;
      buffer = await fs.readFile(imagePathOrBuffer);
    } else {
      buffer = imagePathOrBuffer;
    }

    if (!this.ai) {
      return new MockVisionProvider().analyzeImage(buffer, prompt);
    }

    try {
      const mimeType = detectVisualMimeType(buffer, sourcePath);
      const text = await this.inspectBufferStrict(buffer, mimeType, prompt);
      return {
        description: text,
        detectedText: text,
        labels: [mimeType === 'application/pdf' ? 'pdf_visual' : 'image', 'visual_analysis']
      };
    } catch (err: any) {
      console.warn(`[Vision Provider Warning] Gemini vision call failed: ${err.message}. Falling back to local analyzer.`);
      return new MockVisionProvider().analyzeImage(buffer, prompt);
    }
  }

  async detectText(imagePathOrBuffer: string | Buffer): Promise<string> {
    const analysis = await this.analyzeImage(imagePathOrBuffer, 'Extract all readable text from this image verbatim.');
    return analysis.detectedText || analysis.description;
  }
}

export class MockVisionProvider implements VisionProvider {
  readonly name = 'mock_vision';

  async analyzeImage(imagePathOrBuffer: string | Buffer, prompt?: string): Promise<VisionAnalysisResult> {
    const description = typeof imagePathOrBuffer === 'string'
      ? `Visual analysis of image at ${imagePathOrBuffer}`
      : `Visual analysis of image buffer (${imagePathOrBuffer.length} bytes)`;

    return {
      description,
      detectedText: 'Detected text: Login Dashboard, Error 404: Not Found, Submit Button',
      labels: ['screenshot', 'ui', 'error_banner', 'button'],
      uiElements: [
        { label: 'Submit Button', type: 'button', boundingBox: [100, 200, 140, 320], confidence: 0.95 },
        { label: 'Error Banner', type: 'banner', boundingBox: [20, 50, 60, 500], confidence: 0.98 }
      ],
      metadata: { mock: true, inspectedAt: Date.now() }
    };
  }

  async detectText(imagePathOrBuffer: string | Buffer): Promise<string> {
    return 'Login Dashboard, Error 404: Not Found, Submit Button';
  }
}
