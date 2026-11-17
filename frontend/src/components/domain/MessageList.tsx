import React from 'react';
import { Link } from 'react-router-dom';
import { GitBranch, ExternalLink } from 'lucide-react';
import { ChatMessage, ResearchTrack } from '../../types/api';
import { SubtaskTrackWidget } from './SubtaskTrackWidget';

const extractWorkflowId = (text?: string): string | null => {
  if (!text) return null;
  const match = text.match(/\/workflows\?id=([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  const match2 = text.match(/(?:workflow\s+id[:\s]+|workflowId[:\s'"]+|id:\s*)([a-zA-Z0-9_-]+)/i);
  if (match2 && match2[1] !== 'undefined' && match2[1] !== 'null') return match2[1];
  return null;
};

interface MessageListProps {
  messages: ChatMessage[];
  onOpenRun?: () => void;
  onSelectTrack?: (track: ResearchTrack) => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  onOpenRun,
  onSelectTrack,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '8px 0 24px 0',
        width: '100%',
        maxWidth: '880px',
        margin: '0 auto',
      }}
    >
      {messages.map((msg) => {
        const isUser = msg.sender === 'user';

        return (
          <div
            key={msg.id}
            style={{
              display: 'flex',
              gap: '14px',
              alignItems: 'flex-start',
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: isUser ? 'var(--athena-surface-raised)' : 'var(--athena-surface-raised)',
                border: '1px solid var(--athena-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '1px',
              }}
            >
              {isUser ? (
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text-secondary)' }}>
                  Y
                </span>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="var(--athena-accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3 L3 20 L21 20 Z" />
                  <path d="M12 9 L7.5 17 L16.5 17 Z" stroke="var(--athena-text-secondary)" strokeWidth="1.5" />
                </svg>
              )}
            </div>

            {/* Content Column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '4px',
                  lineHeight: 1,
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--athena-text)',
                  }}
                >
                  {isUser ? 'You' : msg.senderName || 'Athena'}
                </span>

                <span
                  style={{
                    fontSize: '11px',
                    color: 'var(--athena-text-muted)',
                  }}
                >
                  {msg.timestamp}
                </span>

                {!isUser && (
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      padding: '1px 5px',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--athena-text-muted)',
                      border: '1px solid var(--athena-border)',
                      backgroundColor: 'var(--athena-surface)',
                    }}
                  >
                    AGENT
                  </span>
                )}
              </div>

              {/* Message text */}
              <div
                style={{
                  fontSize: '13px',
                  color: 'var(--athena-text-secondary)',
                  lineHeight: 1.55,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {msg.content}
              </div>

              {/* Interactive Workflow Canvas Quick-Access */}
              {!isUser && (() => {
                const wfId = extractWorkflowId(msg.content);
                if (!wfId) return null;
                return (
                  <div style={{ marginTop: '12px' }}>
                    <Link
                      to={`/workflows?id=${encodeURIComponent(wfId)}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-sm, 6px)',
                        backgroundColor: 'rgba(59, 130, 246, 0.12)',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        color: '#60a5fa',
                        fontSize: '12px',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      <GitBranch size={14} />
                      <span>Open '{wfId}' in Workflow Canvas</span>
                      <ExternalLink size={12} style={{ opacity: 0.8 }} />
                    </Link>
                  </div>
                );
              })()}

              {/* Parallel Research Tracks widget if attached */}
              {msg.tracks && msg.tracks.length > 0 && (
                <SubtaskTrackWidget
                  tracks={msg.tracks}
                  onOpenRun={onOpenRun}
                  onSelectTrack={onSelectTrack}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

