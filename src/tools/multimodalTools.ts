import * as path from 'path';
import * as fs from 'fs/promises';
import { Tool, ToolContext } from '../runtime/types.js';
import { MultiModalEngine } from '../multimodal/multimodalEngine.js';

function getOrEngine(context?: ToolContext): MultiModalEngine {
  const memory = context?.memory as any;
  if (memory && typeof memory.getMultimodalEngine === 'function') {
    return memory.getMultimodalEngine();
  }
  return new MultiModalEngine();
}

export const imageInspectTool: Tool = {
  definition: {
    name: 'imageInspect',
    description: 'Inspect and analyze an image or screenshot using multimodal vision intelligence, detecting text, labels, and UI elements.',
    parameters: {
      type: 'OBJECT',
      properties: {
        imagePath: {
          type: 'STRING',
          description: 'Local file path to the image or screenshot to inspect.'
        },
        prompt: {
          type: 'STRING',
          description: 'Optional question or focus prompt for the visual analysis.'
        }
      },
      required: ['imagePath']
    }
  },
  manifest: {
    name: 'imageInspect',
    version: '1.0.0',
    description: 'Inspect and analyze an image or screenshot using vision intelligence',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['fs:read'],
    tags: ['multimodal', 'vision', 'image', 'ocr', 'inspection'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    try {
      const imgPath = String(args.imagePath || '').trim();
      if (!imgPath) {
        return { success: false, error: 'imagePath is required' };
      }

      const resolvedPath = path.resolve(imgPath);
      await fs.access(resolvedPath);

      const engine = getOrEngine(context);
      const res = await engine.analyzeImage(resolvedPath, args.prompt);

      return {
        success: true,
        imagePath: resolvedPath,
        description: res.description,
        detectedText: res.detectedText,
        labels: res.labels,
        uiElements: res.uiElements,
        artifactId: res.artifact?.id
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

export const imageGenerateTool: Tool = {
  definition: {
    name: 'imageGenerate',
    description: 'Generate an image asset from a text description and save it to the multimodal artifact store.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Text description of the desired image to generate.'
        },
        width: {
          type: 'NUMBER',
          description: 'Optional image width in pixels (e.g. 512, 1024).'
        },
        height: {
          type: 'NUMBER',
          description: 'Optional image height in pixels (e.g. 512, 1024).'
        }
      },
      required: ['prompt']
    }
  },
  manifest: {
    name: 'imageGenerate',
    version: '1.0.0',
    description: 'Generate an image asset from a text description',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['fs:write'],
    tags: ['multimodal', 'image', 'generation', 'assets'],
    maxOutputBytes: 8192
  },
  execute: async (args: any, context?: ToolContext) => {
    try {
      const prompt = String(args.prompt || '').trim();
      if (!prompt) {
        return { success: false, error: 'prompt is required' };
      }

      const engine = getOrEngine(context);
      const res = await engine.generateImage(prompt, {
        width: args.width ? Number(args.width) : undefined,
        height: args.height ? Number(args.height) : undefined
      });

      return {
        success: true,
        prompt: res.prompt,
        filePath: res.filePath,
        mimeType: res.mimeType,
        artifactId: res.artifact?.id
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

export const voiceTranscribeTool: Tool = {
  definition: {
    name: 'voiceTranscribe',
    description: 'Transcribe spoken speech audio from an audio file into text using Speech-to-Text (STT).',
    parameters: {
      type: 'OBJECT',
      properties: {
        audioPath: {
          type: 'STRING',
          description: 'Local file path to the audio file (WAV, MP3) to transcribe.'
        },
        language: {
          type: 'STRING',
          description: 'Optional language code (e.g. en, fr, de).'
        },
        prompt: {
          type: 'STRING',
          description: 'Optional context prompt to guide transcription vocabulary.'
        }
      },
      required: ['audioPath']
    }
  },
  manifest: {
    name: 'voiceTranscribe',
    version: '1.0.0',
    description: 'Transcribe spoken speech audio into text using Speech-to-Text',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['fs:read'],
    tags: ['multimodal', 'voice', 'stt', 'audio', 'transcription'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    try {
      const audioPath = String(args.audioPath || '').trim();
      if (!audioPath) {
        return { success: false, error: 'audioPath is required' };
      }

      const resolvedPath = path.resolve(audioPath);
      await fs.access(resolvedPath);

      const engine = getOrEngine(context);
      const res = await engine.transcribeAudio(resolvedPath, {
        language: args.language,
        prompt: args.prompt
      });

      return {
        success: true,
        text: res.text,
        confidence: res.confidence,
        durationSeconds: res.durationSeconds,
        language: res.language,
        artifactId: res.artifact?.id
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

export const voiceSpeakTool: Tool = {
  definition: {
    name: 'voiceSpeak',
    description: 'Synthesize speech audio from text using Text-to-Speech (TTS) and save to a WAV audio file.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'Text string to synthesize into spoken speech.'
        },
        speed: {
          type: 'NUMBER',
          description: 'Speech speed multiplier (e.g. 1.0 for normal, 1.25 for faster).'
        },
        voice: {
          type: 'STRING',
          description: 'Optional voice identity identifier.'
        }
      },
      required: ['text']
    }
  },
  manifest: {
    name: 'voiceSpeak',
    version: '1.0.0',
    description: 'Synthesize speech audio from text using Text-to-Speech',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['fs:write'],
    tags: ['multimodal', 'voice', 'tts', 'speech', 'audio'],
    maxOutputBytes: 8192
  },
  execute: async (args: any, context?: ToolContext) => {
    try {
      const text = String(args.text || '').trim();
      if (!text) {
        return { success: false, error: 'text is required' };
      }

      const engine = getOrEngine(context);
      const res = await engine.synthesizeSpeech(text, {
        speed: args.speed ? Number(args.speed) : undefined,
        voice: args.voice
      });

      return {
        success: true,
        audioPath: res.filePath,
        durationSeconds: res.durationSeconds,
        mimeType: res.mimeType,
        artifactId: res.artifact?.id
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};

export const voiceGoalCreateTool: Tool = {
  definition: {
    name: 'voiceGoalCreate',
    description: 'Process spoken voice audio input directly through Athena core autonomy to create a persistent Goal and planned Tasks.',
    parameters: {
      type: 'OBJECT',
      properties: {
        audioPath: {
          type: 'STRING',
          description: 'Local file path to the voice audio file.'
        },
        voiceResponse: {
          type: 'BOOLEAN',
          description: 'Whether to synthesize a spoken audio confirmation response (default: true).'
        }
      },
      required: ['audioPath']
    }
  },
  manifest: {
    name: 'voiceGoalCreate',
    version: '1.0.0',
    description: 'Process spoken voice input into a persistent planned goal via Athena core',
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 30000,
    permissions: ['fs:read', 'goal:create'],
    tags: ['multimodal', 'voice', 'autonomy', 'goal', 'core'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    try {
      const audioPath = String(args.audioPath || '').trim();
      if (!audioPath) {
        return { success: false, error: 'audioPath is required' };
      }

      const agent = (context as any)?.agent;
      if (!agent) {
        return { success: false, error: 'Agent instance is required in context to process voice goal' };
      }

      const resolvedPath = path.resolve(audioPath);
      await fs.access(resolvedPath);

      const engine = getOrEngine(context);
      const res = await engine.processVoiceRequest(resolvedPath, agent, {
        voiceResponse: args.voiceResponse !== false
      });

      return {
        success: true,
        transcript: res.transcript.text,
        goalId: res.goal.id,
        goalTitle: res.goal.title,
        taskCount: res.tasks.length,
        audioResponsePath: res.audioResponse?.filePath
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
};
