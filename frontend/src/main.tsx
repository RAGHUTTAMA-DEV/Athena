import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './app/App';
import './styles/globals.css';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: any }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const msg =
        this.state.error instanceof Error
          ? this.state.error.message
          : typeof this.state.error === 'string'
          ? this.state.error
          : JSON.stringify(this.state.error);
      return (
        <div
          style={{
            height: '100vh',
            width: '100vw',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#171819',
            color: '#EDEEEF',
            fontFamily: 'Inter, sans-serif',
            padding: '24px',
          }}
        >
          <div
            style={{
              maxWidth: '480px',
              backgroundColor: '#1D1E20',
              border: '1px solid #C77D7D',
              borderRadius: '4px',
              padding: '24px',
              textAlign: 'center',
            }}
          >
            <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px' }}>
              Workspace Render Error
            </h2>
            <p style={{ fontSize: '12px', color: '#BFC2C3', marginBottom: '16px' }}>{msg}</p>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 16px',
                backgroundColor: '#A8B6AE',
                color: '#171819',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                border: 'none',
              }}
            >
              Reload Athena
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </React.StrictMode>
  );
}
