import { Chunk } from './researchTypes.js';

/**
 * P4B structure-aware chunker.
 *
 * Chunks respect Markdown/heading structure first, then paragraph, then
 * sentence boundaries, with a configurable overlap so retrieval queries
 * that span a boundary still hit both sides. Large documents are ALWAYS
 * reduced to chunks here — they go through retrieval, never wholesale
 * into the model context (spec section 25).
 */

export interface ChunkOptions {
  /** Target chunk size in characters (default 4000 ≈ 1000 tokens). */
  maxChars?: number;
  /** Overlapping characters between adjacent chunks (default 300). */
  overlapChars?: number;
  /** Hard minimum chunk size — smaller remainders merge forward. */
  minChars?: number;
}

const HEADING_RE = /^(#{1,6}\s+.+|[A-Z][A-Z\s\d.,'&()/-]{8,})$/;

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? 4000;
  const overlap = Math.min(options.overlapChars ?? 300, Math.floor(maxChars / 4));
  const minChars = options.minChars ?? 200;

  if (text.length <= maxChars) {
    return text.trim()
      ? [{ index: 0, text: text.trim(), charStart: 0, charEnd: text.length }]
      : [];
  }

  const sections = splitBySections(text);
  const chunks: Chunk[] = [];
  let buffer = '';
  let bufferStart = 0;
  let currentSection: string | undefined;

  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length >= Math.min(minChars, 40)) {
      chunks.push({
        index: chunks.length,
        text: trimmed,
        section: currentSection,
        charStart: bufferStart,
        charEnd: bufferStart + buffer.length
      });
    }
    // Seed the next buffer with the overlap tail of this one.
    if (overlap > 0 && trimmed.length > overlap) {
      buffer = trimmed.slice(-overlap);
      bufferStart += buffer.length;
    } else {
      buffer = '';
    }
  };

  for (const section of sections) {
    currentSection = section.heading;
    const paragraphs = section.body.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    for (const paragraph of paragraphs) {
      // Paragraph fits: append.
      if (buffer.length + paragraph.length + 1 <= maxChars) {
        if (buffer.length > 0) buffer += '\n\n';
        else bufferStart = section.start;
        buffer += paragraph;
        continue;
      }

      // Paragraph alone exceeds maxChars: sentence-split it.
      if (paragraph.length > maxChars) {
        for (const sentence of splitSentences(paragraph, maxChars)) {
          if (buffer.length + sentence.length + 1 > maxChars && buffer.length > 0) {
            flush();
          }
          if (buffer.length > 0) buffer += ' ';
          buffer += sentence;
        }
        continue;
      }

      // Paragraph doesn't fit: flush and start a new buffer.
      flush();
      buffer = paragraph;
      bufferStart = section.start;
    }
  }

  if (buffer.trim().length >= Math.min(minChars, 40)) {
    chunks.push({
      index: chunks.length,
      text: buffer.trim(),
      section: currentSection,
      charStart: bufferStart,
      charEnd: bufferStart + buffer.length
    });
  }

  return chunks;
}

interface Section {
  heading?: string;
  body: string;
  start: number;
}

function splitBySections(text: string): Section[] {
  const lines = text.split('\n');
  const sections: Section[] = [];
  let currentHeading: string | undefined;
  let currentLines: string[] = [];

  const push = () => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) {
      sections.push({ heading: currentHeading, body, start: 0 });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (HEADING_RE.test(trimmed) && trimmed.length < 120) {
      push();
      currentHeading = trimmed.replace(/^#+\s*/, '');
    } else {
      currentLines.push(line);
    }
  }
  push();

  if (sections.length === 0 && text.trim().length > 0) {
    sections.push({ body: text, start: 0 });
  }
  return sections;
}

function splitSentences(paragraph: string, maxChars: number): string[] {
  const sentences = paragraph
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const out: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current.length + sentence.length + 1 > maxChars && current.length > 0) {
      out.push(current);
      current = '';
    }
    if (sentence.length > maxChars) {
      // Degenerate case: hard-split a single over-long "sentence".
      for (let i = 0; i < sentence.length; i += maxChars) {
        out.push(sentence.slice(i, i + maxChars));
      }
    } else {
      current = current.length > 0 ? `${current} ${sentence}` : sentence;
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}
