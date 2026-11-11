import React, { useState, useRef, useEffect } from 'react';
import { Paperclip, Send, Lock, Loader2, X, FileText, Folder, GitBranch, Target, Activity, Image as ImageIcon, BookOpen, AlertCircle, Database, Check } from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export interface ComposerAttachment {
  localId?: string;
  attachmentId?: string;
  documentId?: string;
  name: string;
  mimeType: string;
  size: number;
  filePath?: string;
  sidecarPath?: string;
  format?: string;
  pageCount?: number;
  charCount?: number;
  chunkCount?: number;
  mediaCount?: number;
  hasIndexPage?: boolean;
  ocrUsed?: boolean;
  deduplicated?: boolean;
  status?: 'uploading' | 'ready' | 'error';
  errorMessage?: string;
  content?: string;
}

interface MentionOption {
  id: string;
  label: string;
  sublabel: string;
  insertText: string;
  kind: 'file' | 'folder' | 'repo' | 'goal' | 'run' | 'document';
  docRecord?: any;
}

interface ComposerProps {
  sessionId?: string;
  onSendMessage: (text: string, attachments?: ComposerAttachment[]) => Promise<void> | void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
}

export const Composer: React.FC<ComposerProps> = ({
  sessionId,
  onSendMessage,
  disabled = false,
  isSending = false,
  placeholder = 'Message Athena... (type @ to reference workspace files)',
}) => {
  const draftStorageKey = `athena_composer_draft_${sessionId || 'default'}`;

  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [draftHydrated, setDraftHydrated] = useState(false);

  const [showKnowledgePicker, setShowKnowledgePicker] = useState(false);
  const [knowledgeDocs, setKnowledgeDocs] = useState<any[]>([]);
  const [isLoadingKnowledge, setIsLoadingKnowledge] = useState(false);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hydrate persisted composer draft (prompt text + unsubmitted chips) per sessionId
  useEffect(() => {
    setDraftHydrated(false);
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setContent(typeof parsed.content === 'string' ? parsed.content : '');
        if (Array.isArray(parsed.attachments)) {
          setAttachments(parsed.attachments.filter((a: any) => a && a.name && a.status !== 'uploading'));
        } else {
          setAttachments([]);
        }
      } else {
        setContent('');
        setAttachments([]);
      }
    } catch {
      setContent('');
      setAttachments([]);
    }
    setDraftHydrated(true);
  }, [draftStorageKey]);

  // Persist draft across tab switches / reloads until sent or removed
  useEffect(() => {
    if (!draftHydrated) return;
    try {
      const persistableAttachments = attachments.filter((a) => a.status !== 'uploading');
      if (!content && persistableAttachments.length === 0) {
        localStorage.removeItem(draftStorageKey);
      } else {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({ content, attachments: persistableAttachments })
        );
      }
    } catch {}
  }, [content, attachments, draftStorageKey, draftHydrated]);

  const loadKnowledgeDocs = async () => {
    setIsLoadingKnowledge(true);
    try {
      const docs = await apiClient.listResearchDocuments();
      setKnowledgeDocs(docs);
    } catch {
    } finally {
      setIsLoadingKnowledge(false);
    }
  };

  useEffect(() => {
    if (showKnowledgePicker) {
      loadKnowledgeDocs();
    }
  }, [showKnowledgePicker]);

  const docToAttachment = (doc: any): ComposerAttachment => ({
    localId: `kdoc_${doc.id}`,
    documentId: doc.id,
    name: doc.title || doc.sourceUri?.split(/[\\/]/).pop() || doc.id,
    mimeType: doc.format === 'pdf' ? 'application/pdf' : doc.format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/octet-stream',
    size: doc.charCount || 0,
    filePath: doc.metadata?.filePath || doc.sourceUri,
    sidecarPath: doc.metadata?.sidecarPath,
    format: doc.format,
    pageCount: doc.metadata?.pageCount,
    charCount: doc.charCount,
    chunkCount: doc.chunkCount,
    mediaCount: Array.isArray(doc.metadata?.mediaAssets) ? doc.metadata.mediaAssets.length : 0,
    hasIndexPage: Boolean(doc.metadata?.hasIndexPage),
    ocrUsed: Boolean(doc.metadata?.ocr),
    deduplicated: true,
    status: 'ready',
  });

  const attachFromKnowledge = (doc: any) => {
    setAttachments((prev) => {
      if (prev.some((a) => a.documentId === doc.id)) return prev;
      return [...prev, docToAttachment(doc)];
    });
  };

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
        const [files, goals, docs] = await Promise.allSettled([
          apiClient.listWorkspaceFiles(cleanQ),
          apiClient.listGoals(),
          apiClient.listResearchDocuments(),
        ]);

        if (docs.status === 'fulfilled') {
          for (const d of docs.value) {
            const title = d.title || d.sourceUri || d.id;
            if (!cleanQ || title.toLowerCase().includes(cleanQ.toLowerCase())) {
              const tags = [
                d.format ? String(d.format).toUpperCase() : 'DOC',
                d.metadata?.pageCount ? `${d.metadata.pageCount}p` : '',
                Array.isArray(d.metadata?.mediaAssets) && d.metadata.mediaAssets.length > 0
                  ? `${d.metadata.mediaAssets.length} photo(s)`
                  : '',
              ].filter(Boolean);
              options.push({
                id: `doc_${d.id}`,
                label: title,
                sublabel: `Knowledge · ${tags.join(' · ')}`,
                insertText: '',
                kind: 'document',
                docRecord: d,
              });
            }
          }
        }

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

    if (option.kind === 'document' && option.docRecord) {
      attachFromKnowledge(option.docRecord);
      setContent(`${before}${after}`.replace(/^\s+/, ''));
    } else {
      const updated = `${before}${option.insertText}${after}`;
      setContent(updated);
    }

    setMentionQuery(null);
    setMentionStartIndex(-1);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = option.kind === 'document' ? before.length : before.length + option.insertText.length;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  const processFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const pendingItems: ComposerAttachment[] = files.map((file, idx) => ({
      localId: `att_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      name: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploading',
    }));

    setAttachments((prev) => [...prev, ...pendingItems]);

    await Promise.all(
      files.map(async (file, idx) => {
        const localId = pendingItems[idx].localId!;
        try {
          const uploaded = await apiClient.uploadAttachment(file, sessionId);
          setAttachments((prev) =>
            prev.map((att) =>
              att.localId === localId
                ? {
                    ...att,
                    attachmentId: uploaded.attachmentId,
                    documentId: uploaded.documentId,
                    name: uploaded.name || file.name,
                    mimeType: uploaded.mimeType || att.mimeType,
                    size: uploaded.size || file.size,
                    filePath: uploaded.filePath,
                    sidecarPath: uploaded.sidecarPath,
                    format: uploaded.format,
                    pageCount: uploaded.pageCount,
                    charCount: uploaded.charCount,
                    chunkCount: uploaded.chunkCount,
                    mediaCount: uploaded.mediaCount,
                    hasIndexPage: uploaded.hasIndexPage,
                    ocrUsed: uploaded.ocrUsed,
                    deduplicated: uploaded.deduplicated,
                    status: 'ready',
                  }
                : att
            )
          );
        } catch (err: any) {
          setAttachments((prev) =>
            prev.map((att) =>
              att.localId === localId
                ? {
                    ...att,
                    status: 'error',
                    errorMessage: err?.message || 'Upload failed',
                  }
                : att
            )
          );
        }
      })
    );
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processFiles(e.target.files);
    }
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

  const hasUploading = attachments.some((a) => a.status === 'uploading');

  const handleSubmit = async () => {
    const trimmed = content.trim();
    const readyAttachments = attachments.filter((a) => a.status !== 'error');
    if ((!trimmed && readyAttachments.length === 0) || disabled || isSending || hasUploading) return;

    const outgoingText = trimmed || `Please analyze the attached file(s): ${readyAttachments.map((a) => a.name).join(', ')}`;
    const outgoingAttachments = [...readyAttachments];

    setContent('');
    setAttachments([]);
    setMentionQuery(null);
    setShowKnowledgePicker(false);
    try {
      localStorage.removeItem(draftStorageKey);
    } catch {}
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    await onSendMessage(outgoingText, outgoingAttachments.length > 0 ? outgoingAttachments : undefined);
  };

  const renderIcon = (kind: MentionOption['kind']) => {
    switch (kind) {
      case 'document':
        return <Database size={13} color="var(--athena-accent)" />;
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
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && !disabled && !isSending) {
            processFiles(e.dataTransfer.files);
          }
        }}
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
            {attachments.map((att, idx) => {
              const metaTags: string[] = [];
              if (att.format) metaTags.push(att.format.toUpperCase());
              if (att.pageCount) metaTags.push(`${att.pageCount}p`);
              if (att.mediaCount && att.mediaCount > 0) metaTags.push(`${att.mediaCount} photo${att.mediaCount > 1 ? 's' : ''}`);
              if (att.hasIndexPage) metaTags.push('Index');
              if (att.ocrUsed) metaTags.push('OCR/Vision');
              if (att.deduplicated) metaTags.push('In Knowledge');

              const isImg = att.mimeType.startsWith('image/') || att.format === 'image';

              return (
                <div
                  key={att.localId || idx}
                  title={att.errorMessage || att.filePath || att.name}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    backgroundColor: 'var(--athena-surface-deep)',
                    border: `1px solid ${att.status === 'error' ? 'var(--athena-danger, #ef4444)' : 'var(--athena-border)'}`,
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '11px',
                    color: 'var(--athena-text)',
                  }}
                >
                  {att.status === 'uploading' ? (
                    <Loader2 size={12} className="animate-spin" color="var(--athena-accent)" />
                  ) : att.status === 'error' ? (
                    <AlertCircle size={12} color="var(--athena-danger, #ef4444)" />
                  ) : isImg ? (
                    <ImageIcon size={12} color="var(--athena-accent)" />
                  ) : att.hasIndexPage ? (
                    <BookOpen size={12} color="var(--athena-accent)" />
                  ) : (
                    <FileText size={12} color="var(--athena-accent)" />
                  )}
                  <span style={{ fontWeight: 500 }}>{att.name}</span>
                  {att.status === 'uploading' && (
                    <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                      Analyzing & indexing...
                    </span>
                  )}
                  {att.status === 'error' && (
                    <span style={{ fontSize: '10px', color: 'var(--athena-danger, #ef4444)' }}>
                      {att.errorMessage || 'Failed'}
                    </span>
                  )}
                  {att.status === 'ready' && metaTags.length > 0 && (
                    <span
                      style={{
                        fontSize: '10px',
                        color: 'var(--athena-text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      · {metaTags.join(' · ')}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    style={{ color: 'var(--athena-text-muted)', cursor: 'pointer', display: 'flex' }}
                    title="Remove attachment"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
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

            <button
              type="button"
              onClick={() => setShowKnowledgePicker((p) => !p)}
              disabled={disabled || isSending}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '12px',
                color: showKnowledgePicker ? 'var(--athena-accent)' : 'var(--athena-text-secondary)',
                backgroundColor: showKnowledgePicker ? 'var(--athena-surface-hover)' : 'transparent',
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
                if (!showKnowledgePicker) {
                  e.currentTarget.style.color = 'var(--athena-text-secondary)';
                  e.currentTarget.style.backgroundColor = 'transparent';
                }
              }}
              title="Attach already-uploaded files from Knowledge Base"
            >
              <Database size={13} />
              <span>From Knowledge</span>
            </button>

            {showKnowledgePicker && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 10px)',
                  left: 0,
                  width: '380px',
                  maxWidth: '85vw',
                  backgroundColor: 'var(--athena-surface-raised)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-sm)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
                  zIndex: 60,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--athena-border-subtle)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: 'var(--athena-text)',
                  }}
                >
                  <span>Attach from Knowledge ({knowledgeDocs.length})</span>
                  <button
                    type="button"
                    onClick={() => setShowKnowledgePicker(false)}
                    style={{ color: 'var(--athena-text-muted)', cursor: 'pointer', display: 'flex' }}
                  >
                    <X size={12} />
                  </button>
                </div>
                <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                  {isLoadingKnowledge ? (
                    <div style={{ padding: '16px', fontSize: '11px', color: 'var(--athena-text-muted)', textAlign: 'center' }}>
                      Loading indexed documents...
                    </div>
                  ) : knowledgeDocs.length === 0 ? (
                    <div style={{ padding: '16px', fontSize: '11px', color: 'var(--athena-text-muted)', textAlign: 'center' }}>
                      No documents in Knowledge yet. Upload a file via Attach.
                    </div>
                  ) : (
                    knowledgeDocs.map((doc) => {
                      const alreadyAttached = attachments.some((a) => a.documentId === doc.id);
                      const isSessionDoc =
                        sessionId &&
                        (doc.metadata?.sessionId === sessionId ||
                          (Array.isArray(doc.metadata?.sessionIds) && doc.metadata.sessionIds.includes(sessionId)));
                      const metaParts: string[] = [];
                      if (doc.format) metaParts.push(String(doc.format).toUpperCase());
                      if (doc.metadata?.pageCount) metaParts.push(`${doc.metadata.pageCount}p`);
                      if (Array.isArray(doc.metadata?.mediaAssets) && doc.metadata.mediaAssets.length > 0) {
                        metaParts.push(`${doc.metadata.mediaAssets.length} photo(s)`);
                      }
                      if (doc.metadata?.hasIndexPage) metaParts.push('Index');

                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => attachFromKnowledge(doc)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderBottom: '1px solid var(--athena-border-subtle)',
                            textAlign: 'left',
                            cursor: alreadyAttached ? 'default' : 'pointer',
                            backgroundColor: alreadyAttached ? 'var(--athena-surface-deep)' : 'transparent',
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--athena-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {doc.title || doc.sourceUri}
                            </div>
                            <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                              {metaParts.join(' · ') || 'Document'}
                              {isSessionDoc ? ' · uploaded in this chat' : ''}
                            </div>
                          </div>
                          <span style={{ fontSize: '10px', marginLeft: '10px', color: alreadyAttached ? 'var(--athena-success)' : 'var(--athena-accent)', display: 'inline-flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
                            {alreadyAttached ? (
                              <>
                                <Check size={11} />
                                Attached
                              </>
                            ) : (
                              'Attach'
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

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
            disabled={(!content.trim() && attachments.length === 0) || disabled || isSending || hasUploading}
            title={hasUploading ? 'Waiting for attachment parsing & indexing to finish...' : 'Send message'}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-sm)',
              backgroundColor:
                (content.trim() || attachments.length > 0) && !hasUploading
                  ? 'var(--athena-accent)'
                  : 'var(--athena-surface)',
              color:
                (content.trim() || attachments.length > 0) && !hasUploading ? '#171819' : 'var(--athena-text-muted)',
              cursor:
                (content.trim() || attachments.length > 0) && !disabled && !isSending && !hasUploading
                  ? 'pointer'
                  : 'default',
              border: '1px solid var(--athena-border)',
              transition: 'all 0.15s ease',
            }}
          >
            {isSending || hasUploading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
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
