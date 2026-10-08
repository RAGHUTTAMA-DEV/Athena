import * as fs from 'fs/promises';
import * as path from 'path';
import {
  VisionProvider,
  VisionAnalysisResult,
  STTProvider,
  TranscriptionResult,
  STTOptions,
  TTSProvider,
  AudioSynthesisResult,
  TTSOptions,
  ImageGenerationProvider,
  GeneratedImageResult,
  ImageGenOptions
} from './types.js';
import { GeminiVisionProvider, MockVisionProvider } from './providers/visionProvider.js';
import { GeminiSTTProvider, MockSTTProvider } from './providers/sttProvider.js';
import { SynthesizedTTSProvider, CloudTTSProvider } from './providers/ttsProvider.js';
import { MockImageGenProvider, CloudImageGenProvider, MINIMAL_VALID_PNG } from './providers/imageGenProvider.js';
import { MultimodalArtifact, MultimodalStore } from '../storage/stores/types.js';
import { Goal, Task } from '../autonomy/goalTypes.js';
import { Agent } from '../runtime/agent.js';
import { BrowserEngine } from '../browser/browserEngine.js';

export interface MultiModalEngineOptions {
  store?: MultimodalStore;
  visionProvider?: VisionProvider;
  sttProvider?: STTProvider;
  ttsProvider?: TTSProvider;
  imageGenProvider?: ImageGenerationProvider;
  storageDir?: string;
}

export class MultiModalEngine {
  private store?: MultimodalStore;
  private visionProvider: VisionProvider;
  private sttProvider: STTProvider;
  private ttsProvider: TTSProvider;
  private imageGenProvider: ImageGenerationProvider;
  private storageDir: string;

  constructor(options?: MultiModalEngineOptions) {
    this.store = options?.store;
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY);

    this.visionProvider = options?.visionProvider || (hasApiKey ? new GeminiVisionProvider() : new MockVisionProvider());
    this.sttProvider = options?.sttProvider || (hasApiKey ? new GeminiSTTProvider() : new MockSTTProvider());
    this.ttsProvider = options?.ttsProvider || new SynthesizedTTSProvider();
    this.imageGenProvider = options?.imageGenProvider || new MockImageGenProvider();
    this.storageDir = options?.storageDir
      ? path.resolve(options.storageDir)
      : path.resolve(process.cwd(), 'scratch', 'multimodal');
  }

  setStore(store: MultimodalStore): void {
    this.store = store;
  }

  getVisionProvider(): VisionProvider {
    return this.visionProvider;
  }

  setVisionProvider(provider: VisionProvider): void {
    this.visionProvider = provider;
  }

  getSTTProvider(): STTProvider {
    return this.sttProvider;
  }

  setSTTProvider(provider: STTProvider): void {
    this.sttProvider = provider;
  }

  getTTSProvider(): TTSProvider {
    return this.ttsProvider;
  }

  setTTSProvider(provider: TTSProvider): void {
    this.ttsProvider = provider;
  }

  getImageGenProvider(): ImageGenerationProvider {
    return this.imageGenProvider;
  }

  setImageGenProvider(provider: ImageGenerationProvider): void {
    this.imageGenProvider = provider;
  }

  // --- VISION METHODS ---

  async analyzeImage(
    imagePathOrBuffer: string | Buffer,
    prompt?: string,
    metadata?: Record<string, any>
  ): Promise<VisionAnalysisResult & { artifact?: MultimodalArtifact }> {
    const analysis = await this.visionProvider.analyzeImage(imagePathOrBuffer, prompt);

    let artifact: MultimodalArtifact | undefined;
    if (this.store) {
      let filePath: string;
      if (typeof imagePathOrBuffer === 'string') {
        filePath = imagePathOrBuffer;
      } else {
        await fs.mkdir(path.join(this.storageDir, 'images'), { recursive: true });
        filePath = path.join(this.storageDir, 'images', `image_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
        await fs.writeFile(filePath, imagePathOrBuffer);
      }

      artifact = await this.store.saveArtifact({
        id: `img_art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaType: 'image',
        mimeType: 'image/png',
        filePath,
        source: 'vision_analysis',
        caption: analysis.description,
        metadata: {
          ...metadata,
          labels: analysis.labels,
          detectedText: analysis.detectedText,
          uiElements: analysis.uiElements
        },
        createdAt: Date.now()
      });
    }

    return {
      ...analysis,
      artifact
    };
  }

  async detectText(imagePathOrBuffer: string | Buffer): Promise<string> {
    return this.visionProvider.detectText(imagePathOrBuffer);
  }

  // --- SPEECH METHODS (STT & TTS) ---

  async transcribeAudio(
    audioPathOrBuffer: string | Buffer,
    options?: STTOptions,
    metadata?: Record<string, any>
  ): Promise<TranscriptionResult & { artifact?: MultimodalArtifact }> {
    const transcript = await this.sttProvider.transcribe(audioPathOrBuffer, options);

    let artifact: MultimodalArtifact | undefined;
    if (this.store) {
      let filePath: string;
      if (typeof audioPathOrBuffer === 'string') {
        filePath = audioPathOrBuffer;
      } else {
        await fs.mkdir(path.join(this.storageDir, 'audio'), { recursive: true });
        filePath = path.join(this.storageDir, 'audio', `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
        await fs.writeFile(filePath, audioPathOrBuffer);
      }

      artifact = await this.store.saveArtifact({
        id: `audio_art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaType: 'audio',
        mimeType: 'audio/wav',
        filePath,
        source: 'stt_transcription',
        transcription: transcript.text,
        caption: `Transcription (${transcript.language || 'en'})`,
        metadata: {
          ...metadata,
          confidence: transcript.confidence,
          durationSeconds: transcript.durationSeconds,
          segments: transcript.segments
        },
        createdAt: Date.now()
      });
    }

    return {
      ...transcript,
      artifact
    };
  }

  async synthesizeSpeech(
    text: string,
    options?: TTSOptions,
    metadata?: Record<string, any>
  ): Promise<AudioSynthesisResult & { artifact?: MultimodalArtifact }> {
    const synthesis = await this.ttsProvider.synthesize(text, options);

    await fs.mkdir(path.join(this.storageDir, 'tts'), { recursive: true });
    const filePath = path.join(this.storageDir, 'tts', `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
    await fs.writeFile(filePath, synthesis.audioBuffer);
    synthesis.filePath = filePath;

    let artifact: MultimodalArtifact | undefined;
    if (this.store) {
      artifact = await this.store.saveArtifact({
        id: `tts_art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaType: 'audio',
        mimeType: synthesis.mimeType,
        filePath,
        source: 'tts_synthesis',
        transcription: text,
        caption: `Synthesized speech: ${text.slice(0, 60)}`,
        metadata: {
          ...metadata,
          speed: options?.speed,
          voice: options?.voice,
          durationSeconds: synthesis.durationSeconds
        },
        createdAt: Date.now()
      });
    }

    return {
      ...synthesis,
      artifact
    };
  }

  // --- IMAGE GENERATION METHODS ---

  async generateImage(
    prompt: string,
    options?: ImageGenOptions,
    metadata?: Record<string, any>
  ): Promise<GeneratedImageResult & { artifact?: MultimodalArtifact }> {
    const generated = await this.imageGenProvider.generateImage(prompt, options);

    await fs.mkdir(path.join(this.storageDir, 'generated'), { recursive: true });
    const filePath = path.join(this.storageDir, 'generated', `gen_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
    await fs.writeFile(filePath, generated.imageBuffer);
    generated.filePath = filePath;

    let artifact: MultimodalArtifact | undefined;
    if (this.store) {
      artifact = await this.store.saveArtifact({
        id: `gen_art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        mediaType: 'image',
        mimeType: generated.mimeType,
        filePath,
        source: 'image_generation',
        caption: prompt,
        metadata: {
          ...metadata,
          width: generated.width,
          height: generated.height
        },
        createdAt: Date.now()
      });
    }

    return {
      ...generated,
      artifact
    };
  }

  // --- EXIT CRITERION 1: VOICE REQUEST CREATES GOAL THROUGH NORMAL CORE PATH ---

  /**
   * Voice audio transcribes via STT, routes through Athena core, and creates
   * a persistent goal with tasks in SQLite.
   */
  async processVoiceRequest(
    audioInput: string | Buffer,
    agent: Agent,
    options?: {
      prompt?: string;
      voiceResponse?: boolean;
      goalPriority?: any;
    }
  ): Promise<{
    transcript: TranscriptionResult;
    goal: Goal;
    tasks: Task[];
    audioResponse?: AudioSynthesisResult;
    audioArtifact?: MultimodalArtifact;
  }> {
    // 1. Transcribe the audio input
    const transResult = await this.transcribeAudio(audioInput, { prompt: options?.prompt });
    const rawText = transResult.text.trim();

    // 2. Format goal title & description from spoken request
    let goalTitle = rawText;
    if (/^create\s+a?\s*goal\s+(to|for)\s+/i.test(goalTitle)) {
      goalTitle = goalTitle.replace(/^create\s+a?\s*goal\s+(to|for)\s+/i, '');
    }
    // Capitalize first letter
    if (goalTitle.length > 0) {
      goalTitle = goalTitle.charAt(0).toUpperCase() + goalTitle.slice(1);
    }

    const description = `Spoken request transcribed via STT: "${rawText}"`;

    // 3. Normal core path: createGoal via agent
    const goal = await agent.createGoal({
      title: goalTitle,
      description,
      priority: options?.goalPriority || 'normal',
      metadata: {
        source: 'voice',
        transcriptionConfidence: transResult.confidence,
        durationSeconds: transResult.durationSeconds,
        audioArtifactId: transResult.artifact?.id
      }
    });

    // 4. Normal core path: plan goal into tasks in SQLite
    const tasks = await agent.planGoal(goal.id);

    // 5. Synthesize voice confirmation if requested (default: true)
    let audioResponse: AudioSynthesisResult | undefined;
    if (options?.voiceResponse !== false) {
      const confirmationText = `Created goal: ${goal.title}. Planned ${tasks.length} tasks for execution.`;
      audioResponse = await this.synthesizeSpeech(confirmationText, { speed: 1.0 });
    }

    return {
      transcript: transResult,
      goal,
      tasks,
      audioResponse,
      audioArtifact: transResult.artifact
    };
  }

  // --- EXIT CRITERION 2: SCREENSHOT -> BROWSER -> VERIFY E2E ---

  /**
   * Athena analyzes a screenshot with vision, navigates in browser, performs
   * action, takes a new screenshot, and verifies outcome.
   */
  async handleScreenshotToBrowserAction(
    screenshotPathOrBuffer: string | Buffer,
    actionIntent: {
      targetUrl?: string;
      action?: 'click' | 'doubleClick' | 'type' | 'pressKey' | 'hover';
      selector?: string;
      value?: string;
      expectedText?: string;
      description?: string;
    },
    browserEngine?: BrowserEngine
  ): Promise<{
    initialAnalysis: VisionAnalysisResult;
    initialArtifact?: MultimodalArtifact;
    browserResult?: any;
    verificationScreenshotPath: string;
    verificationAnalysis: VisionAnalysisResult;
    verificationArtifact?: MultimodalArtifact;
    verified: boolean;
  }> {
    // 1. Analyze initial screenshot with vision
    const initialResult = await this.analyzeImage(
      screenshotPathOrBuffer,
      actionIntent.description || 'Analyze screenshot and identify interactive UI components and action targets.'
    );

    let verificationScreenshotPath = '';
    let browserResult: any = null;

    if (browserEngine) {
      // 2. Perform browser actions
      if (actionIntent.targetUrl) {
        browserResult = await browserEngine.navigate({ url: actionIntent.targetUrl });
      }

      if (actionIntent.action && actionIntent.selector) {
        browserResult = await browserEngine.executeAction({
          action: actionIntent.action as any,
          selector: actionIntent.selector,
          value: actionIntent.value
        });
      }

      // 3. Take new screenshot
      await fs.mkdir(path.join(this.storageDir, 'verification'), { recursive: true });
      const targetPath = path.join(this.storageDir, 'verification', `verify_${Date.now()}.png`);
      const shot = await browserEngine.captureScreenshot({ path: targetPath });
      verificationScreenshotPath = shot.savedPath;
    } else {
      // Mock / fallback browser verification screenshot
      await fs.mkdir(path.join(this.storageDir, 'verification'), { recursive: true });
      verificationScreenshotPath = path.join(this.storageDir, 'verification', `verify_mock_${Date.now()}.png`);
      await fs.writeFile(verificationScreenshotPath, MINIMAL_VALID_PNG);
      browserResult = { simulated: true, action: actionIntent.action, targetUrl: actionIntent.targetUrl };
    }

    // 4. Verify outcome via vision analysis
    const verificationResult = await this.analyzeImage(
      verificationScreenshotPath,
      `Verify action outcome. Expected outcome: ${actionIntent.expectedText || actionIntent.action || 'success'}.`
    );

    // Verification check: verify whether expectedText appears or UI analysis confirms
    const verified = actionIntent.expectedText
      ? ((verificationResult.detectedText || '').toLowerCase().includes(actionIntent.expectedText.toLowerCase()) ||
         (verificationResult.description || '').toLowerCase().includes(actionIntent.expectedText.toLowerCase()))
      : true;

    return {
      initialAnalysis: initialResult,
      initialArtifact: initialResult.artifact,
      browserResult,
      verificationScreenshotPath,
      verificationAnalysis: verificationResult,
      verificationArtifact: verificationResult.artifact,
      verified
    };
  }
}
