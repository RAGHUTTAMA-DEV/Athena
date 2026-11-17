import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, Moon, ChevronRight } from 'lucide-react';
import { ConnectionStatus } from '../../types/events';

export interface BreadcrumbItem {
  label: string;
  path?: string;
}

interface TopHeaderProps {
  breadcrumbs?: (string | BreadcrumbItem)[];
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  isRunning?: boolean;
  connectionStatus?: ConnectionStatus;
  isSimulatedPreview?: boolean;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  breadcrumbs = [{ label: 'Athena', path: '/' }, { label: 'Workspace' }],
  theme,
  onToggleTheme,
  isRunning = false,
  connectionStatus = 'connected',
  isSimulatedPreview = false,
}) => {
  const navigate = useNavigate();

  const normalizedCrumbs: BreadcrumbItem[] = breadcrumbs.map((c) =>
    typeof c === 'string' ? { label: c } : c
  );

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
        {normalizedCrumbs.map((crumb, idx) => {
          const isLast = idx === normalizedCrumbs.length - 1;
          const isClickable = !isLast && Boolean(crumb.path);

          return (
            <React.Fragment key={`${crumb.label}-${idx}`}>
              {idx > 0 && <ChevronRight size={12} color="var(--athena-text-muted)" />}
              <span
                onClick={() => {
                  if (isClickable && crumb.path) {
                    navigate(crumb.path);
                  }
                }}
                style={{
                  fontSize: '12px',
                  fontWeight: isLast ? 600 : 500,
                  color: isLast ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                  cursor: isClickable ? 'pointer' : 'default',
                  transition: 'color 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (isClickable) e.currentTarget.style.color = 'var(--athena-text)';
                }}
                onMouseLeave={(e) => {
                  if (isClickable) e.currentTarget.style.color = 'var(--athena-text-muted)';
                }}
              >
                {crumb.label}
              </span>
            </React.Fragment>
          );
        })}
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
            cursor: 'pointer',
            backgroundColor: 'transparent',
            border: 'none',
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
      </div>
    </header>
  );
};

