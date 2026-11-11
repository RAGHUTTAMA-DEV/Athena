import React from 'react';
import { Activity, ArrowRight } from 'lucide-react';
import { ResearchTrack } from '../../types/api';
import { StatusBadge } from '../primitives/StatusBadge';

interface SubtaskTrackWidgetProps {
  title?: string;
  countLabel?: string;
  tracks?: ResearchTrack[];
  onOpenRun?: () => void;
  onSelectTrack?: (track: ResearchTrack) => void;
}

export const SubtaskTrackWidget: React.FC<SubtaskTrackWidgetProps> = ({
  title = 'Parallel research',
  countLabel = '3 assigned',
  tracks = [
    { id: '1', name: 'AWS - EU regions', status: 'SOURCE CHECKED' },
    { id: '2', name: 'Azure - log scope', status: 'REVIEW NEEDED' },
    { id: '3', name: 'Google Cloud - EU', status: 'IN PROGRESS' },
  ],
  onOpenRun,
  onSelectTrack,
}) => {
  return (
    <div
      style={{
        marginTop: '12px',
        backgroundColor: 'var(--athena-surface-deep)',
        border: '1px solid var(--athena-border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        width: '100%',
        maxWidth: '820px',
      }}
    >
      {/* Widget Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid var(--athena-border-subtle)',
          fontSize: '12px',
          color: 'var(--athena-text-secondary)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Activity size={14} color="var(--athena-accent)" />
          <span style={{ fontWeight: 500, color: 'var(--athena-text)' }}>
            {title} <span style={{ color: 'var(--athena-text-muted)' }}>/ {countLabel}</span>
          </span>
        </div>

        {onOpenRun && (
          <button
            onClick={onOpenRun}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--athena-text-secondary)',
              cursor: 'pointer',
              padding: '2px 6px',
              borderRadius: 'var(--radius-xs)',
              transition: 'color 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--athena-text)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--athena-text-secondary)')}
          >
            <span>Open run</span>
            <ArrowRight size={12} />
          </button>
        )}
      </div>

      {/* Tracks Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${tracks.length}, 1fr)`,
          backgroundColor: 'var(--athena-surface)',
        }}
      >
        {tracks.map((track, idx) => (
          <div
            key={track.id}
            onClick={() => onSelectTrack?.(track)}
            style={{
              padding: '12px 14px',
              borderRight: idx < tracks.length - 1 ? '1px solid var(--athena-border-subtle)' : 'none',
              cursor: onSelectTrack ? 'pointer' : 'default',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (onSelectTrack) e.currentTarget.style.background = 'var(--athena-surface-hover)';
            }}
            onMouseLeave={(e) => {
              if (onSelectTrack) e.currentTarget.style.background = 'var(--athena-surface)';
            }}
          >
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--athena-text)',
                marginBottom: '6px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {track.name}
            </div>
            <StatusBadge status={track.status} size="sm" showDot={false} />
          </div>
        ))}
      </div>
    </div>
  );
};

