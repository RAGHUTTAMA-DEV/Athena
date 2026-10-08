import fs from 'fs';
import path from 'path';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import Tesseract from 'tesseract.js';
import { DocumentFormat, ParsedDocument } from './researchTypes.js';
import { CapabilityRegistry, CapabilityStatus } from '../tools/capabilityRegistry.js';

/**
 * P4B Document Intelligence parser.
 *
 * Real extraction for PDF (pdf.js via pdf-parse), DOCX (mammoth), XLSX
 * (sheetjs), CSV (papaparse), HTML (tag stripping) and plain
 * text/Markdown. Images and scanned documents go through tesseract.js OCR,
 * which is registered as an `experimental` capability in the capability
 * registry — never advertised as fully real.
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.pnm', '.pbm']);

export function detectFormat(source: string, mimeType?: string): DocumentFormat {
  const ext = path.extname(source.split('?')[0]).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mimeType) {
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'docx';
    if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) return 'xlsx';
    if (mimeType.includes('csv')) return 'csv';
    if (mimeType.includes('html')) return 'html';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.includes('markdown')) return 'markdown';
  }
  return 'text';
}

export class DocumentParser {
  constructor(private capabilities: CapabilityRegistry = CapabilityRegistry.getInstance()) {}

  /** Parse a local file. */
  async parseFile(filePath: string): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);
    const format = detectFormat(filePath);
    return this.parseBuffer(buffer, format, { source: filePath });
  }

  /** Parse raw bytes with a known format. */
  async parseBuffer(
    buffer: Buffer,
    format: DocumentFormat,
    context: { source?: string; mimeType?: string } = {}
  ): Promise<ParsedDocument> {
    switch (format) {
      case 'pdf': {
        const parser = new PDFParse({ data: buffer });
        try {
          const textResult = await parser.getText();
          return {
            format,
            text: normalizeWhitespace(textResult.text),
            pageCount: textResult.total,
            metadata: { pages: textResult.pages.length }
          };
        } finally {
          await parser.destroy();
        }
      }
      case 'docx': {
        const result = await mammoth.extractRawText({ buffer });
        return { format, text: normalizeWhitespace(result.value) };
      }
      case 'xlsx': {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets: string[] = [];
        for (const name of workbook.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
          sheets.push(`## Sheet: ${name}\n${csv}`);
        }
        return {
          format,
          text: normalizeWhitespace(sheets.join('\n\n')),
          sheets: workbook.SheetNames,
          metadata: { sheetNames: workbook.SheetNames }
        };
      }
      case 'csv': {
        const csvText = buffer.toString('utf-8');
        const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
        return {
          format,
          text: normalizeWhitespace(csvText),
          rows: parsed.data.length
        };
      }
      case 'html': {
        return { format, text: stripHtml(buffer.toString('utf-8')) };
      }
      case 'image': {
        return this.ocr(buffer, context.source);
      }
      case 'markdown':
      case 'text': {
        return { format, text: normalizeWhitespace(buffer.toString('utf-8')) };
      }
      default: {
        // Exhaustiveness guard
        throw new Error(`Unsupported document format: ${format satisfies never}`);
      }
    }
  }

  /**
   * OCR for scanned documents/images — experimental capability. On failure
   * the capability status stays honest (`experimental` with reason or
   * `unsupported`) and a typed error propagates; the caller never receives
   * fabricated text.
   */
  async ocr(buffer: Buffer, source?: string): Promise<ParsedDocument> {
    const entry = this.capabilities.get('documents.ocr');
    const previousStatus: CapabilityStatus = entry?.status || 'experimental';
    try {
      this.capabilities.setStatus('documents.ocr', 'experimental');
      const worker = await Tesseract.createWorker('eng');
      try {
        const { data } = await worker.recognize(buffer);
        const text = typeof data.text === 'string' ? data.text : '';
        if (!text.trim()) {
          throw new Error('OCR produced no text');
        }
        return { format: 'image', text: normalizeWhitespace(text), ocr: true, metadata: { source } };
      } finally {
        await worker.terminate();
      }
    } catch (err: any) {
      this.capabilities.setStatus(
        'documents.ocr',
        'experimental',
        `Last OCR attempt failed: ${err?.message || String(err)}`
      );
      // Restore the pre-existing status (experimental by default).
      this.capabilities.setStatus('documents.ocr', previousStatus);
      throw new Error(
        `OCR failed for ${source || 'image buffer'} (capability is experimental): ${err?.message || String(err)}`
      );
    }
  }
}

export function stripHtml(html: string): string {
  return normalizeWhitespace(
    html
      // Drop script/style blocks entirely — their content is not document text.
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|table|ul|ol|section|article|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
