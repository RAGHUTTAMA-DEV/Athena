import * as fs from 'fs/promises';
import { GoogleGenAI } from '@google/genai';
import { VisionAnalysisResult, VisionProvider } from '../types.js';

export class GeminiVisionProvider implements VisionProvider {
  readonly name = 'gemini_vision';
  private ai?: GoogleGenAI;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    }
  }

  async analyzeImage(imagePathOrBuffer: string | Buffer, prompt = 'Describe this image, extract any visible text, and identify any user interface elements or errors.'): Promise<VisionAnalysisResult> {
    let buffer: Buffer;
    if (typeof imagePathOrBuffer === 'string') {
      buffer = await fs.readFile(imagePathOrBuffer);
    } else {
      buffer = imagePathOrBuffer;
    }

    if (!this.ai) {
      return new MockVisionProvider().analyzeImage(buffer, prompt);
    }

    try {
      const base64Data = buffer.toString('base64');
      const response = await this.ai.models.generateContent({
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'image/png',
                  data: base64Data
                }
              }
            ]
          }
        ]
      });

      const text = response.text || '';
      return {
        description: text,
        detectedText: text,
        labels: ['image', 'visual_analysis']
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
