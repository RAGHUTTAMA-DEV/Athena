export interface VisionUIElement {
  label: string;
  type?: string;
  boundingBox?: [number, number, number, number]; // [ymin, xmin, ymax, xmax]
  confidence?: number;
}

export interface VisionAnalysisResult {
  description: string;
  detectedText?: string;
  labels?: string[];
  uiElements?: VisionUIElement[];
  metadata?: Record<string, any>;
}

export interface VisionProvider {
  readonly name: string;
  analyzeImage(imagePathOrBuffer: string | Buffer, prompt?: string): Promise<VisionAnalysisResult>;
  detectText(imagePathOrBuffer: string | Buffer): Promise<string>;
}

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResult {
  text: string;
  confidence?: number;
  language?: string;
  durationSeconds?: number;
  segments?: TranscriptionSegment[];
}

export interface STTOptions {
  language?: string;
  prompt?: string;
}

export interface STTProvider {
  readonly name: string;
  transcribe(audioPathOrBuffer: string | Buffer, options?: STTOptions): Promise<TranscriptionResult>;
}

export interface AudioSynthesisResult {
  audioBuffer: Buffer;
  mimeType: string;
  durationSeconds?: number;
  filePath?: string;
}

export interface TTSOptions {
  voice?: string;
  speed?: number;
  format?: 'wav' | 'mp3' | 'ogg';
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, options?: TTSOptions): Promise<AudioSynthesisResult>;
}

export interface GeneratedImageResult {
  imageBuffer: Buffer;
  mimeType: string;
  filePath?: string;
  prompt: string;
  width?: number;
  height?: number;
}

export interface ImageGenOptions {
  width?: number;
  height?: number;
  style?: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generateImage(prompt: string, options?: ImageGenOptions): Promise<GeneratedImageResult>;
}
