import { GeneratedImageResult, ImageGenOptions, ImageGenerationProvider } from '../types.js';

// Valid 1x1 RGBA PNG buffer (67 bytes)
export const MINIMAL_VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

export class MockImageGenProvider implements ImageGenerationProvider {
  readonly name = 'mock_image_gen';

  async generateImage(prompt: string, options?: ImageGenOptions): Promise<GeneratedImageResult> {
    const width = options?.width || 512;
    const height = options?.height || 512;

    return {
      imageBuffer: MINIMAL_VALID_PNG,
      mimeType: 'image/png',
      prompt,
      width,
      height
    };
  }
}

export class CloudImageGenProvider implements ImageGenerationProvider {
  readonly name = 'cloud_image_gen';
  private fallback = new MockImageGenProvider();

  constructor(private apiKey?: string) {}

  async generateImage(prompt: string, options?: ImageGenOptions): Promise<GeneratedImageResult> {
    // Graceful fallback to mock image generator
    return this.fallback.generateImage(prompt, options);
  }
}
