import React from 'react';
import { Sun, Moon, MoreHorizontal, ChevronRight } from 'lucide-react';
import { ConnectionStatus } from '../../types/events';

interface TopHeaderProps {
  breadcrumbs?: string[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isRunning?: boolean;
  connectionStatus?: ConnectionStatus;
  isSimulatedPreview?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  breadcrumbs = ['Ops room', 'Workspace'],
  theme,
  onToggleTheme,
  isRunning = false,
  connectionStatus = 'connected',
  isSimulatedPreview = false,
}) => {
  return (
    <header
      style={{
        height: 'var(--header-height)',
        backgroundColor: 'var(--athena-surface)',
        borderBottom: '1px solid var(--athena-border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Breadcrumbs */}
      <nav style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb}>
            {idx > 0 && <ChevronRight size={12} color="var(--athena-text-muted)" />}
            <span
              style={{
                fontSize: '12px',
                fontWeight: idx === breadcrumbs.length - 1 ? 600 : 500,
                color: idx === breadcrumbs.length - 1 ? 'var(--athena-text)' : 'var(--athena-text-muted)',
              }}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </nav>

      {/* Right Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Simulated Preview Pill */}
        {isSimulatedPreview && (
          <div
            style={{
              padding: '3px 8px',
              backgroundColor: 'var(--athena-surface-raised)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              color: 'var(--athena-text-secondary)',
              letterSpacing: '0.06em',
            }}
          >
            SIMULATED PREVIEW
          </div>
        )}

        {/* Theme Toggle */}
        <button
          onClick={onToggleTheme}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '12px',
            color: 'var(--athena-text-secondary)',
            padding: '4px 8px',
            borderRadius: 'var(--radius-xs)',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--athena-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--athena-text-secondary)')}
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        {/* Status Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: isRunning ? 'var(--athena-success)' : 'var(--athena-text-muted)',
              boxShadow: isRunning ? '0 0 6px var(--athena-success)' : 'none',
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--athena-text-secondary)' }}>
            {isRunning ? 'Run in progress' : connectionStatus}
          </span>
        </div>

        {/* Options Menu */}
        <button
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            color: 'var(--athena-text-muted)',
            borderRadius: 'var(--radius-xs)',
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    </header>
  );
};

