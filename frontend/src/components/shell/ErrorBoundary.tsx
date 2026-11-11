import React from 'react';
import { useRouteError, isRouteErrorResponse } from 'react-router-dom';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export const RouteErrorBoundary: React.FC = () => {
  const error = useRouteError() as any;

  let errorMessage = 'An unexpected error occurred in the Athena UI.';
  if (isRouteErrorResponse(error)) {
    errorMessage = `${error.status} ${error.statusText}`;
  } else if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else if (error && typeof error === 'object' && 'message' in error) {
    errorMessage = String(error.message);
  }

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--athena-canvas)',
        color: 'var(--athena-text)',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '480px',
          width: '100%',
          backgroundColor: 'var(--athena-surface)',
          border: '1px solid var(--athena-danger)',
          borderRadius: 'var(--radius-sm)',
          padding: '24px',
        }}
      >
        <AlertTriangle size={28} color="var(--athena-danger)" style={{ marginBottom: '12px' }} />
        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
          Application View Error
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '16px', lineHeight: 1.5 }}>
          {errorMessage}
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            backgroundColor: 'var(--athena-accent)',
            color: '#171819',
            borderRadius: 'var(--radius-xs)',
            fontSize: '12px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={14} />
          <span>Reload Workspace</span>
        </button>
      </div>
    </div>
  );
};

