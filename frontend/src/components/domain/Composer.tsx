import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, Lock, Loader2, X, FileText, Folder, GitBranch, Target, Activity } from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export interface ComposerAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string;
}

interface MentionOption {
  id: string;
  label: string;
  sublabel: string;
  insertText: string;
  kind: 'file' | 'folder' | 'repo' | 'goal' | 'run';
}

interface ComposerProps {
  onSendMessage: (text: string, attachments?: ComposerAttachment[]) => Promise<void> | void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
}

export const Composer: React.FC<ComposerProps> = ({
  onSendMessage,
  disabled = false,
  isSending = false,
  placeholder = 'Message Athena... (type @ to reference workspace files)',
}) => {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [content]);

  // Fetch @ mention options when typing @...
  useEffect(() => {
    if (mentionQuery === null) {
      setMentionOptions([]);
      return;
    }

    let cancelled = false;
    const cleanQ = mentionQuery.replace(/^(file:|folder:|goal:|run:)/i, '');

    const loadOptions = async () => {
      const options: MentionOption[] = [];

      if (!cleanQ || 'repo'.includes(cleanQ.toLowerCase())) {
        options.push({
          id: 'repo',
          label: '@repo',
          sublabel: 'Repository overview & structure',
          insertText: '@repo ',
          kind: 'repo',
        });
      }

      try {
        const [files, goals] = await Promise.allSettled([
          apiClient.listWorkspaceFiles(cleanQ),
          apiClient.listGoals(),
        ]);

        if (files.status === 'fulfilled') {
          for (const f of files.value.slice(0, 15)) {
            options.push({
              id: `${f.type}_${f.path}`,
              label: f.path,
              sublabel: f.type === 'folder' ? 'Workspace folder' : 'Workspace file',
              insertText: f.type === 'folder' ? `@folder:${f.path} ` : `@file:${f.path} `,
              kind: f.type,
            });
          }
        }

        if (goals.status === 'fulfilled') {
          for (const g of goals.value) {
            if (!cleanQ || g.title.toLowerCase().includes(cleanQ.toLowerCase()) || g.id.toLowerCase().includes(cleanQ.toLowerCase())) {
              options.push({
                id: `goal_${g.id}`,
                label: g.title,
                sublabel: `Goal · ${g.id}`,
                insertText: `@goal:${g.id} `,
                kind: 'goal',
              });
            }
          }
        }
      } catch {}

      if (!cancelled) {
        setMentionOptions(options);
        setSelectedIndex(0);
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [mentionQuery]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    const cursor = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursor);
    // Match an active @token right before cursor (preceded by start-of-string or whitespace)
    const match = textBeforeCursor.match(/(?:^|\s)@([^\s]*)$/);

    if (match) {
      const token = match[1];
      const atIdx = textBeforeCursor.lastIndexOf('@');
      setMentionQuery(token);
      setMentionStartIndex(atIdx);
    } else {
      setMentionQuery(null);
      setMentionStartIndex(-1);
    }
  };

  const insertMention = (option: MentionOption) => {
    if (mentionStartIndex < 0 || !textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart ?? content.length;
    const before = content.slice(0, mentionStartIndex);
    const after = content.slice(cursor);
    const updated = `${before}${option.insertText}${after}`;
    setContent(updated);
    setMentionQuery(null);
    setMentionStartIndex(-1);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = before.length + option.insertText.length;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const newAttachments: ComposerAttachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      try {
        const text = await file.text();
        newAttachments.push({
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          content: text.slice(0, 50000),
        });
      } catch {
        newAttachments.push({
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          content: `[Attached file: ${file.name}, ${file.size} bytes]`,
        });
      }
    }

    setAttachments((prev) => [...prev, ...newAttachments]);
    e.target.value = '';
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle @ mention popup navigation
    if (mentionQuery !== null && mentionOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % mentionOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionOptions[selectedIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    // Send on Enter (without Shift) or Cmd/Ctrl + Enter
    if ((e.key === 'Enter' && !e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if ((!trimmed && attachments.length === 0) || disabled || isSending) return;

    const outgoingText = trimmed || `Please inspect the attached file(s): ${attachments.map((a) => a.name).join(', ')}`;
    const outgoingAttachments = [...attachments];

    setContent('');
    setAttachments([]);
    setMentionQuery(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSendMessage(outgoingText, outgoingAttachments.length > 0 ? outgoingAttachments : undefined);
  };

  const renderIcon = (kind: MentionOption['kind']) => {
    switch (kind) {
      case 'folder':
        return <Folder size={13} color="var(--athena-warning)" />;
      case 'repo':
        return <GitBranch size={13} color="var(--athena-info)" />;
      case 'goal':
        return <Target size={13} color="var(--athena-success)" />;
      case 'run':
        return <Activity size={13} color="var(--athena-accent)" />;
      default:
        return <FileText size={13} color="var(--athena-accent)" />;
    }
  };

  return (
    <div style={{ width: '100%', maxWidth: '880px', margin: '0 auto', position: 'relative' }}>
      {/* @ Context Reference Autocomplete Popup */}
      {mentionQuery !== null && mentionOptions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            right: 0,
            marginBottom: '8px',
            backgroundColor: 'var(--athena-surface-raised)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
            maxHeight: '240px',
            overflowY: 'auto',
            zIndex: 50,
          }}
        >
          <div
            style={{
              padding: '6px 12px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--athena-text-muted)',
              borderBottom: '1px solid var(--athena-border-subtle)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Reference Workspace File / Context (↑↓ to select, Enter to insert)
          </div>
          {mentionOptions.map((opt, idx) => {
            const isActive = idx === selectedIndex;
            return (
              <button
                key={opt.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(opt);
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  backgroundColor: isActive ? 'var(--athena-surface-hover)' : 'transparent',
                  borderBottom: '1px solid var(--athena-border-subtle)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  {renderIcon(opt.kind)}
                  <span
                    style={{
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--athena-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {opt.label}
                  </span>
                </div>
                <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', flexShrink: 0, marginLeft: '12px' }}>
                  {opt.sublabel}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        style={{ display: 'none' }}
      />

      {/* Composer Box */}
      <div
        style={{
          backgroundColor: 'var(--athena-surface-raised)',
          border: '1px solid var(--athena-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '12px 14px 10px 14px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
        }}
      >
        {/* Attached File Chips */}
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
            {attachments.map((att, idx) => (
              <div
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 8px',
                  backgroundColor: 'var(--athena-surface-deep)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '11px',
                  color: 'var(--athena-text)',
                }}
              >
                <FileText size={12} color="var(--athena-accent)" />
                <span>{att.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  style={{ color: 'var(--athena-text-muted)', cursor: 'pointer', display: 'flex' }}
                  title="Remove attachment"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || isSending}
          placeholder={placeholder}
          rows={2}
          style={{
            width: '100%',
            resize: 'none',
            fontSize: '13.5px',
            color: 'var(--athena-text)',
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            lineHeight: 1.5,
            fontFamily: 'inherit',
          }}
        />

        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: '8px',
            paddingTop: '8px',
            borderTop: '1px solid var(--athena-border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isSending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: 'var(--athena-text-secondary)',
                cursor: 'pointer',
                padding: '3px 6px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--athena-text)';
                e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--athena-text-secondary)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title="Attach files from disk"
            >
              <Paperclip size={13} />
              <span>Attach</span>
            </button>

            <span
              style={{
                fontSize: '11px',
                color: 'var(--athena-text-muted)',
                letterSpacing: '0.01em',
              }}
            >
              Enter to send · @ to reference files
            </span>
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={(!content.trim() && attachments.length === 0) || disabled || isSending}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor:
                content.trim() || attachments.length > 0
                  ? 'var(--athena-accent)'
                  : 'var(--athena-surface)',
              color:
                content.trim() || attachments.length > 0 ? '#171819' : 'var(--athena-text-muted)',
              cursor:
                (content.trim() || attachments.length > 0) && !disabled && !isSending
                  ? 'pointer'
                  : 'default',
              border: '1px solid var(--athena-border)',
              transition: 'all 0.15s ease',
            }}
          >
            {isSending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          marginTop: '8px',
          fontSize: '11px',
          color: 'var(--athena-text-muted)',
        }}
      >
        <Lock size={11} />
        <span>Athena workspace — connected to local agent runtime via REST & SSE.</span>
      </div>
    </div>
  );
};
