import React, { useState, useEffect } from 'react';
import {
  X,
  CheckCircle,
  AlertCircle,
  Key,
  Shield,
  RefreshCw,
  ExternalLink,
  GitBranch,
  Mail,
  MessageSquare,
  Search,
  Check,
  ChevronRight,
  Info
} from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  category: string;
  authType: 'oauth2' | 'api_key';
  connected: boolean;
  authSource?: 'vault' | 'environment' | null;
  maskedToken?: string | null;
  scopes?: string[];
  expiresAt?: number;
}

interface IntegrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  integrations: IntegrationStatus[];
  onRefreshIntegrations: () => Promise<void>;
  initialServiceId?: string;
}

export const IntegrationsModal: React.FC<IntegrationsModalProps> = ({
  isOpen,
  onClose,
  integrations,
  onRefreshIntegrations,
  initialServiceId = 'github'
}) => {
  const [activeId, setActiveId] = useState<string>(initialServiceId);
  const [tokenInput, setTokenInput] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    valid: boolean;
    username?: string;
    name?: string;
    message?: string;
    scopes?: string;
  } | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    if (initialServiceId) {
      setActiveId(initialServiceId);
    }
  }, [initialServiceId]);

  useEffect(() => {
    setTokenInput('');
    setTestResult(null);
    setShowManualInput(false);
  }, [activeId]);

  if (!isOpen) return null;

  const current = integrations.find((i) => i.id === activeId) || integrations[0];

  const getServiceIcon = (id: string) => {
    switch (id) {
      case 'github':
        return <GitBranch size={16} color="var(--athena-info, #91A7B7)" />;
      case 'gmail':
        return <Mail size={16} color="var(--athena-warning, #C5A66A)" />;
      case 'slack':
        return <MessageSquare size={16} color="#B89FD4" />;
      case 'linear':
        return <CheckCircle size={16} color="var(--athena-accent, #A8B6AE)" />;
      case 'brave':
        return <Search size={16} color="var(--athena-success, #8EAD9A)" />;
      default:
        return <Key size={16} color="var(--athena-text-muted)" />;
    }
  };

  const handleTestExisting = async () => {
    if (!current) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.testIntegration(current.id);
      setTestResult(res);
    } catch (err: any) {
      setTestResult({
        valid: false,
        message: err.message || 'Connection test failed'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveToken = async () => {
    if (!current || !tokenInput.trim()) return;
    setIsSaving(true);
    setTestResult(null);
    try {
      await apiClient.saveIntegrationCredentials(current.id, {
        accessToken: tokenInput.trim()
      });
      // Test immediately to verify
      const test = await apiClient.testIntegration(current.id, tokenInput.trim()).catch(() => null);
      if (test) {
        setTestResult(test);
      }
      setTokenInput('');
      setShowManualInput(false);
      await onRefreshIntegrations();
    } catch (err: any) {
      alert(`Failed to save credential: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!current) return;
    if (!confirm(`Disconnect ${current.name}? Workflows depending on this integration may fail.`)) return;
    try {
      await apiClient.disconnectIntegration(current.id);
      setTestResult(null);
      await onRefreshIntegrations();
    } catch (err: any) {
      alert(`Disconnect failed: ${err.message}`);
    }
  };

  const handleOAuthConnect = async () => {
    if (!current) return;
    try {
      const res = await apiClient.getIntegrationAuthUrl(current.id);
      window.open(res.authUrl, '_blank', 'width=600,height=700');
    } catch (err: any) {
      alert(`OAuth initialization failed: ${err.message}. You can enter a Personal Access Token / API Key directly instead.`);
      setShowManualInput(true);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(3px)'
    }}>
      <div style={{
        width: '760px',
        maxHeight: '85vh',
        backgroundColor: 'var(--athena-surface)',
        border: '1px solid var(--athena-border)',
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 25px 35px -5px rgba(0, 0, 0, 0.7)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--athena-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--athena-surface-deep)'
        }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--athena-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={16} color="var(--athena-accent)" />
              Integrations & Credential Vault
            </div>
            <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', marginTop: '2px' }}>
              Encrypted AES-256-GCM storage with auto-detection for environment variables (<code style={{ color: 'var(--athena-accent)' }}>GITHUB_TOKEN</code>, etc.)
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--athena-text-muted)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Split: Sidebar + Detail */}
        <div style={{ display: 'flex', flex: 1, minHeight: '380px', overflow: 'hidden' }}>
          {/* Left Service Roster */}
          <div style={{
            width: '240px',
            borderRight: '1px solid var(--athena-border)',
            backgroundColor: 'var(--athena-surface-deep)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            padding: '8px',
            overflowY: 'auto'
          }}>
            {integrations.map((integ) => {
              const isSelected = integ.id === activeId;
              return (
                <button
                  key={integ.id}
                  onClick={() => setActiveId(integ.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-xs)',
                    backgroundColor: isSelected ? 'var(--athena-surface)' : 'transparent',
                    border: `1px solid ${isSelected ? 'var(--athena-border)' : 'transparent'}`,
                    color: isSelected ? 'var(--athena-text)' : 'var(--athena-text-secondary)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.1s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getServiceIcon(integ.id)}
                    <span style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 500 }}>{integ.name}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: integ.connected ? 'var(--athena-success)' : '#585f67',
                        boxShadow: integ.connected ? '0 0 5px var(--athena-success)' : 'none'
                      }}
                    />
                    {integ.authSource === 'environment' && (
                      <span style={{ fontSize: '9px', padding: '1px 4px', backgroundColor: 'var(--athena-surface-elevated)', borderRadius: '2px', color: 'var(--athena-text-muted)' }}>
                        ENV
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right Detail Pane */}
          {current && (
            <div style={{ flex: 1, padding: '20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Service Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {getServiceIcon(current.id)}
                    <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--athena-text)' }}>{current.name}</div>
                    <span style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)',
                      backgroundColor: 'var(--athena-surface-elevated)',
                      color: 'var(--athena-text-muted)',
                      letterSpacing: '0.5px'
                    }}>
                      {current.category}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', marginTop: '4px' }}>
                    {current.description}
                  </div>
                </div>
              </div>

              {/* Status Banner */}
              <div style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: current.connected ? 'rgba(142, 173, 154, 0.1)' : 'var(--athena-surface-elevated)',
                border: `1px solid ${current.connected ? 'var(--athena-success)' : 'var(--athena-border)'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    backgroundColor: current.connected ? 'var(--athena-success)' : '#73787e',
                    boxShadow: current.connected ? '0 0 8px var(--athena-success)' : 'none'
                  }} />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 600, color: current.connected ? 'var(--athena-success)' : 'var(--athena-text)' }}>
                      {current.connected ? 'Authenticated & Active' : 'Not Connected'}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', marginTop: '2px' }}>
                      {current.connected ? (
                        <>
                          Source: <strong style={{ color: 'var(--athena-text)' }}>{current.authSource === 'environment' ? 'Environment Variable' : 'Encrypted Vault'}</strong>
                          {current.maskedToken && <span> • Masked Key: <code style={{ color: 'var(--athena-accent)' }}>{current.maskedToken}</code></span>}
                        </>
                      ) : (
                        'Workflows requiring this service will prompt or fail until authenticated.'
                      )}
                    </div>
                  </div>
                </div>

                {current.connected && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={handleTestExisting}
                      disabled={isTesting}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 10px',
                        backgroundColor: 'var(--athena-surface)',
                        border: '1px solid var(--athena-border)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--athena-text)',
                        fontSize: '11px',
                        cursor: isTesting ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <RefreshCw size={11} className={isTesting ? 'spin' : ''} />
                      {isTesting ? 'Testing...' : 'Test Connection'}
                    </button>
                    {current.authSource === 'vault' && (
                      <button
                        onClick={handleDisconnect}
                        style={{
                          padding: '4px 8px',
                          backgroundColor: 'transparent',
                          border: '1px solid var(--athena-danger)',
                          borderRadius: 'var(--radius-xs)',
                          color: 'var(--athena-danger)',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Test Verification Feedback */}
              {testResult && (
                <div style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: testResult.valid ? 'rgba(142, 173, 154, 0.15)' : 'rgba(196, 114, 114, 0.15)',
                  border: `1px solid ${testResult.valid ? 'var(--athena-success)' : 'var(--athena-danger)'}`,
                  fontSize: '11px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  {testResult.valid ? (
                    <>
                      <CheckCircle size={14} color="var(--athena-success)" />
                      <div style={{ color: 'var(--athena-text)' }}>
                        <strong>Verification Successful:</strong> Connected
                        {testResult.username ? ` as @${testResult.username}` : ''}
                        {testResult.scopes ? ` (Scopes: ${testResult.scopes})` : ''}
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} color="var(--athena-danger)" />
                      <div style={{ color: 'var(--athena-danger)' }}>
                        <strong>Verification Failed:</strong> {testResult.message}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Configuration / Token Entry Area */}
              {(!current.connected || showManualInput) && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  padding: '14px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'var(--athena-surface-deep)',
                  border: '1px solid var(--athena-border-subtle)'
                }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                    Configure {current.name} Credentials
                  </div>

                  {current.id === 'github' && (
                    <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', lineHeight: '1.4' }}>
                      <Info size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }} />
                      Provide a GitHub Personal Access Token (classic with <code style={{ color: 'var(--athena-accent)' }}>repo</code> scope, or fine-grained token with Pull Requests & Contents permissions).
                      Alternatively, set <code style={{ color: 'var(--athena-accent)' }}>GITHUB_TOKEN</code> in your environment.
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder={current.id === 'github' ? 'ghp_... or github_pat_...' : `Enter ${current.name} API Key / Token`}
                      style={{
                        flex: 1,
                        padding: '7px 10px',
                        backgroundColor: 'var(--athena-canvas)',
                        border: '1px solid var(--athena-border)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--athena-text)',
                        fontSize: '11px',
                        fontFamily: 'monospace'
                      }}
                    />
                    <button
                      onClick={handleSaveToken}
                      disabled={isSaving || !tokenInput.trim()}
                      style={{
                        padding: '7px 14px',
                        backgroundColor: 'var(--athena-accent)',
                        border: 'none',
                        borderRadius: 'var(--radius-xs)',
                        color: '#171819',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: !tokenInput.trim() || isSaving ? 'not-allowed' : 'pointer',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {isSaving ? 'Encrypting & Saving...' : 'Save & Verify'}
                    </button>
                  </div>

                  {current.authType === 'oauth2' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '4px' }}>
                      <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>Or use OAuth:</span>
                      <button
                        onClick={handleOAuthConnect}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          padding: '4px 10px',
                          backgroundColor: 'var(--athena-surface)',
                          border: '1px solid var(--athena-border)',
                          borderRadius: 'var(--radius-xs)',
                          color: 'var(--athena-text)',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        <ExternalLink size={11} /> Connect via Browser OAuth
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* If connected and manual input is hidden, offer "Update Token" */}
              {current.connected && !showManualInput && (
                <div>
                  <button
                    onClick={() => setShowManualInput(true)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--athena-accent)',
                      fontSize: '11px',
                      cursor: 'pointer',
                      padding: 0,
                      textDecoration: 'underline'
                    }}
                  >
                    Replace or update credentials manually
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
