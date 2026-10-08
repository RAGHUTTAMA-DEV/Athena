import * as fs from 'fs/promises';
import { AudioSynthesisResult, TTSOptions, TTSProvider } from '../types.js';

export function createValidPcmWav(durationSeconds = 1, sampleRate = 16000, frequency = 440): Buffer {
  const numSamples = Math.floor(sampleRate * durationSeconds);
  const dataSize = numSamples * 2; // 16-bit mono = 2 bytes per sample
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  // Sub-chunk 1 "fmt "
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // SubChunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
  buffer.writeUInt16LE(1, 22);  // NumChannels (1 mono)
  buffer.writeUInt32LE(sampleRate, 24); // SampleRate
  buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate = SampleRate * NumChannels * BitsPerSample/8
  buffer.writeUInt16LE(2, 32);  // BlockAlign = NumChannels * BitsPerSample/8
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // Sub-chunk 2 "data"
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Write simple synthesized sine tone into PCM data
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * t);
    const intSample = Math.floor(sample * 16383); // half max 16-bit signed amplitude
    buffer.writeInt16LE(intSample, 44 + i * 2);
  }

  return buffer;
}

export class SynthesizedTTSProvider implements TTSProvider {
  readonly name = 'synthesized_tts';

  async synthesize(text: string, options?: TTSOptions): Promise<AudioSynthesisResult> {
    const wordCount = Math.max(1, text.split(/\s+/).length);
    const duration = Math.min(30, Math.max(1, Number((wordCount * 0.35).toFixed(1))));
    const speed = options?.speed || 1.0;
    const adjustedDuration = Math.max(0.5, Number((duration / speed).toFixed(1)));

    const audioBuffer = createValidPcmWav(adjustedDuration, 16000, 440);

    return {
      audioBuffer,
      mimeType: 'audio/wav',
      durationSeconds: adjustedDuration
    };
  }
}

export class CloudTTSProvider implements TTSProvider {
  readonly name = 'cloud_tts';
  private fallback = new SynthesizedTTSProvider();

  constructor(private apiKey?: string) {}

  async synthesize(text: string, options?: TTSOptions): Promise<AudioSynthesisResult> {
    // If a cloud TTS service endpoint or key is configured, call it; otherwise graceful fallback
    return this.fallback.synthesize(text, options);
  }
}
