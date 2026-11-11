import React from 'react';
import { RunStatus } from '../../types/api';

interface StatusBadgeProps {
  status: RunStatus | string;
  size?: 'sm' | 'md';
  showDot?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'md',
  showDot = true,
}) => {
  const normalized = status.toLowerCase();

  let label = status;
  let color = 'var(--athena-text-muted)';
  let bg = 'var(--athena-surface-raised)';
  let borderColor = 'var(--athena-border)';
  let isPulsing = false;

  switch (normalized) {
    case 'created':
    case 'queued':
      label = 'Queued';
      color = 'var(--athena-text-muted)';
      bg = 'rgba(119, 125, 128, 0.1)';
      borderColor = 'var(--athena-border-subtle)';
      break;
    case 'planning':
      label = 'Planning';
      color = 'var(--athena-info)';
      bg = 'var(--athena-info-dim)';
      borderColor = 'rgba(145, 167, 183, 0.3)';
      isPulsing = true;
      break;
    case 'running':
      label = 'Running';
      color = 'var(--athena-success)';
      bg = 'var(--athena-success-dim)';
      borderColor = 'rgba(142, 173, 154, 0.3)';
      isPulsing = true;
      break;
    case 'waiting':
      label = 'Waiting';
      color = 'var(--athena-warning)';
      bg = 'var(--athena-warning-dim)';
      borderColor = 'rgba(197, 166, 106, 0.3)';
      break;
    case 'blocked':
      label = 'Blocked';
      color = 'var(--athena-danger)';
      bg = 'var(--athena-danger-dim)';
      borderColor = 'rgba(199, 125, 125, 0.3)';
      break;
    case 'approval_required':
    case 'waiting_for_approval':
      label = 'Needs approval';
      color = 'var(--athena-warning)';
      bg = 'var(--athena-warning-dim)';
      borderColor = 'rgba(197, 166, 106, 0.4)';
      isPulsing = true;
      break;
    case 'verifying':
      label = 'Verifying';
      color = 'var(--athena-info)';
      bg = 'var(--athena-info-dim)';
      borderColor = 'rgba(145, 167, 183, 0.3)';
      break;
    case 'reviewing':
      label = 'Reviewing';
      color = 'var(--athena-info)';
      bg = 'var(--athena-info-dim)';
      borderColor = 'rgba(145, 167, 183, 0.3)';
      break;
    case 'repairing':
      label = 'Repairing';
      color = 'var(--athena-warning)';
      bg = 'var(--athena-warning-dim)';
      borderColor = 'rgba(197, 166, 106, 0.3)';
      isPulsing = true;
      break;
    case 'completed':
      label = 'Completed';
      color = 'var(--athena-success)';
      bg = 'var(--athena-success-dim)';
      borderColor = 'rgba(142, 173, 154, 0.3)';
      break;
    case 'failed':
      label = 'Failed';
      color = 'var(--athena-danger)';
      bg = 'var(--athena-danger-dim)';
      borderColor = 'rgba(199, 125, 125, 0.3)';
      break;
    case 'cancelled':
      label = 'Cancelled';
      color = 'var(--athena-text-muted)';
      bg = 'rgba(119, 125, 128, 0.1)';
      borderColor = 'var(--athena-border)';
      break;
    case 'source checked':
      label = 'SOURCE CHECKED';
      color = 'var(--athena-success)';
      bg = 'transparent';
      borderColor = 'transparent';
      break;
    case 'review needed':
      label = 'REVIEW NEEDED';
      color = 'var(--athena-warning)';
      bg = 'transparent';
      borderColor = 'transparent';
      break;
    case 'in progress':
      label = 'IN PROGRESS';
      color = 'var(--athena-accent)';
      bg = 'transparent';
      borderColor = 'transparent';
      isPulsing = true;
      break;
  }

  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: isSmall ? '1px 6px' : '2px 8px',
        fontSize: isSmall ? '10px' : '11px',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        borderRadius: 'var(--radius-xs)',
        color,
        backgroundColor: bg,
        border: `1px solid ${borderColor}`,
        lineHeight: 1.2,
      }}
    >
      {showDot && (
        <span
          style={{
            width: isSmall ? '5px' : '6px',
            height: isSmall ? '5px' : '6px',
            borderRadius: '50%',
            backgroundColor: color,
            display: 'inline-block',
            opacity: isPulsing ? 0.9 : 0.7,
            boxShadow: isPulsing ? `0 0 6px ${color}` : 'none',
          }}
        />
      )}
      {label}
    </span>
  );
};

