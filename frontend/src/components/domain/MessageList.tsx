import React from 'react';
import { ChatMessage, ResearchTrack } from '../../types/api';
import { SubtaskTrackWidget } from './SubtaskTrackWidget';

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

