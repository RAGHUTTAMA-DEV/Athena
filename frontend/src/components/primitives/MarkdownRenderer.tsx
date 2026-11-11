import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
}

const CodeBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <div
      style={{
        margin: '12px 0',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--athena-border)',
        backgroundColor: '#121314',
        overflow: 'hidden',
      }}
    >
      {/* Code Editor Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          backgroundColor: 'var(--athena-surface-raised)',
          borderBottom: '1px solid var(--athena-border-subtle)',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--athena-text-muted)',
        }}
      >
        <span style={{ textTransform: 'lowercase', fontWeight: 500 }}>
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            color: copied ? 'var(--athena-success)' : 'var(--athena-text-secondary)',
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 'var(--radius-xs)',
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>

      {/* Code Body */}
      <pre
        style={{
          margin: 0,
          padding: '12px 14px',
          overflowX: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          lineHeight: 1.55,
          color: '#E1E3E6',
          tabSize: 2,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
};

function renderInline(text: string): React.ReactNode[] {
  // Tokenize inline markdown: code spans, bold, italic, links
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(pattern);

  return parts.map((part, idx) => {
    if (!part) return null;

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return (
        <code
          key={idx}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            backgroundColor: 'var(--athena-surface-raised)',
            border: '1px solid var(--athena-border-subtle)',
            color: 'var(--athena-accent)',
            padding: '1px 5px',
            borderRadius: 'var(--radius-xs)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (
      (part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
    ) {
      return (
        <strong key={idx} style={{ fontWeight: 600, color: 'var(--athena-text)' }}>
          {renderInline(part.slice(2, -2))}
        </strong>
      );
    }

    if (
      (part.startsWith('*') && part.endsWith('*') && part.length >= 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length >= 2)
    ) {
      return (
        <em key={idx} style={{ fontStyle: 'italic', color: 'var(--athena-text-secondary)' }}>
          {renderInline(part.slice(1, -1))}
        </em>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      const safeHref = href.startsWith('http://') || href.startsWith('https://') || href.startsWith('/') ? href : '#';
      return (
        <a
          key={idx}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--athena-info)',
            textDecoration: 'underline',
            textUnderlineOffset: '2px',
          }}
        >
          {label}
        </a>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  if (!content) return null;

  // Split out fenced code blocks first
  const blocks: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\r?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', content: content.slice(lastIndex, match.index) });
    }
    blocks.push({ type: 'code', lang: match[1] || '', content: match[2].replace(/\r?\n$/, '') });
    lastIndex = fenceRegex.lastIndex;
  }

  if (lastIndex < content.length) {
    blocks.push({ type: 'text', content: content.slice(lastIndex) });
  }

  const renderTextBlock = (raw: string, blockKey: number) => {
    const lines = raw.split(/\r?\n/);
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        i++;
        continue;
      }

      // Horizontal Rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        elements.push(
          <hr
            key={`${blockKey}-hr-${i}`}
            style={{
              border: 'none',
              borderTop: '1px solid var(--athena-border-subtle)',
              margin: '14px 0',
            }}
          />
        );
        i++;
        continue;
      }

      // Headings
      const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = headingMatch[2];
        const sizes: Record<number, { fontSize: string; marginTop: string; border?: boolean }> = {
          1: { fontSize: '18px', marginTop: '16px', border: true },
          2: { fontSize: '16px', marginTop: '14px', border: true },
          3: { fontSize: '14px', marginTop: '12px' },
          4: { fontSize: '13px', marginTop: '10px' },
        };
        const styleCfg = sizes[level] || sizes[3];

        elements.push(
          <div
            key={`${blockKey}-h-${i}`}
            style={{
              fontSize: styleCfg.fontSize,
              fontWeight: 700,
              color: 'var(--athena-text)',
              marginTop: elements.length === 0 ? '0px' : styleCfg.marginTop,
              marginBottom: '6px',
              paddingBottom: styleCfg.border ? '4px solid var(--athena-border-subtle)' : undefined,
              borderBottom: styleCfg.border ? '1px solid var(--athena-border-subtle)' : undefined,
              lineHeight: 1.35,
            }}
          >
            {renderInline(text)}
          </div>
        );
        i++;
        continue;
      }

      // GFM Table
      if (
        trimmed.startsWith('|') &&
        i + 1 < lines.length &&
        /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])
      ) {
        const parseRow = (rowStr: string) =>
          rowStr
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((cell) => cell.trim());

        const headers = parseRow(line);
        i += 2; // Skip header & separator
        const rows: string[][] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          rows.push(parseRow(lines[i]));
          i++;
        }

        elements.push(
          <div
            key={`${blockKey}-tbl-${i}`}
            style={{
              margin: '12px 0',
              overflowX: 'auto',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '12px',
                textAlign: 'left',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: 'var(--athena-surface-raised)' }}>
                  {headers.map((h, hIdx) => (
                    <th
                      key={hIdx}
                      style={{
                        padding: '8px 12px',
                        fontWeight: 600,
                        color: 'var(--athena-text)',
                        borderBottom: '1px solid var(--athena-border)',
                      }}
                    >
                      {renderInline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rIdx) => (
                  <tr
                    key={rIdx}
                    style={{
                      backgroundColor: rIdx % 2 === 0 ? 'var(--athena-surface)' : 'var(--athena-surface-deep)',
                    }}
                  >
                    {headers.map((_, cIdx) => (
                      <td
                        key={cIdx}
                        style={{
                          padding: '7px 12px',
                          color: 'var(--athena-text-secondary)',
                          borderBottom:
                            rIdx < rows.length - 1 ? '1px solid var(--athena-border-subtle)' : 'none',
                        }}
                      >
                        {renderInline(row[cIdx] || '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }

      // Blockquote
      if (trimmed.startsWith('>')) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('>')) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          i++;
        }
        elements.push(
          <blockquote
            key={`${blockKey}-bq-${i}`}
            style={{
              margin: '10px 0',
              padding: '8px 14px',
              borderLeft: '3px solid var(--athena-accent)',
              backgroundColor: 'var(--athena-surface-deep)',
              color: 'var(--athena-text-secondary)',
              borderRadius: '0 var(--radius-xs) var(--radius-xs) 0',
            }}
          >
            {renderInline(quoteLines.join(' '))}
          </blockquote>
        );
        continue;
      }

      // Unordered List
      if (/^(\s*)([-*+])\s+/.test(line)) {
        const items: Array<{ indent: number; text: string }> = [];
        while (i < lines.length && /^(\s*)([-*+])\s+/.test(lines[i])) {
          const m = lines[i].match(/^(\s*)([-*+])\s+(.*)$/);
          if (m) {
            items.push({ indent: m[1].length, text: m[3] });
          }
          i++;
        }
        elements.push(
          <ul
            key={`${blockKey}-ul-${i}`}
            style={{
              margin: '6px 0 10px 0',
              paddingLeft: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {items.map((item, idx) => (
              <li
                key={idx}
                style={{
                  marginLeft: item.indent >= 2 ? '16px' : '0',
                  color: 'var(--athena-text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                {renderInline(item.text)}
              </li>
            ))}
          </ul>
        );
        continue;
      }

      // Ordered List
      if (/^(\s*)\d+\.\s+/.test(line)) {
        const items: Array<{ indent: number; text: string }> = [];
        while (i < lines.length && /^(\s*)\d+\.\s+/.test(lines[i])) {
          const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
          if (m) {
            items.push({ indent: m[1].length, text: m[2] });
          }
          i++;
        }
        elements.push(
          <ol
            key={`${blockKey}-ol-${i}`}
            style={{
              margin: '6px 0 10px 0',
              paddingLeft: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {items.map((item, idx) => (
              <li
                key={idx}
                style={{
                  marginLeft: item.indent >= 2 ? '16px' : '0',
                  color: 'var(--athena-text-secondary)',
                  lineHeight: 1.55,
                }}
              >
                {renderInline(item.text)}
              </li>
            ))}
          </ol>
        );
        continue;
      }

      // Regular Paragraph
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4})\s+/.test(lines[i].trim()) &&
        !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
        !lines[i].trim().startsWith('>') &&
        !/^(\s*)([-*+])\s+/.test(lines[i]) &&
        !/^(\s*)\d+\.\s+/.test(lines[i]) &&
        !lines[i].trim().startsWith('|')
      ) {
        paraLines.push(lines[i]);
        i++;
      }

      elements.push(
        <p
          key={`${blockKey}-p-${i}`}
          style={{
            margin: '6px 0',
            color: 'var(--athena-text-secondary)',
            lineHeight: 1.6,
          }}
        >
          {renderInline(paraLines.join(' '))}
        </p>
      );
    }

    return <div key={blockKey}>{elements}</div>;
  };

  return (
    <div style={{ fontSize: '13.5px', lineHeight: 1.6, wordBreak: 'break-word' }}>
      {blocks.map((b, idx) =>
        b.type === 'code' ? (
          <CodeBlock key={idx} language={b.lang || ''} code={b.content} />
        ) : (
          renderTextBlock(b.content, idx)
        )
      )}
    </div>
  );
};

