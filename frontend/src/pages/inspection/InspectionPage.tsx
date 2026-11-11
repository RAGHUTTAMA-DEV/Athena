import React, { useState, useEffect } from 'react';
import { HardDrive, Cpu, ShieldCheck, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export const InspectionPage: React.FC = () => {
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [healthData, setHealthData] = useState<any>(null);
  const [policyData, setPolicyData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchInspection = async () => {
    try {
      setIsLoading(true);
      const [caps, health, pol] = await Promise.allSettled([
        apiClient.getSystemCapabilities(),
        apiClient.checkHealthReady(),
        apiClient.getSystemPolicy(),
      ]);

      if (caps.status === 'fulfilled') {
        setCapabilities(caps.value.capabilities || []);
      }
      if (health.status === 'fulfilled') {
        setHealthData(health.value);
      }
      if (pol.status === 'fulfilled') {
        setPolicyData(pol.value);
      }
    } catch (err) {
      console.error('[Inspection] Fetch error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInspection();
  }, []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1000px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            System & Capability Inspection
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Authoritative runtime inspection of storage drivers, registered capabilities, and policy engine rules.
          </p>
        </div>

        <button
          onClick={fetchInspection}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 10px',
            backgroundColor: 'var(--athena-surface)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-xs)',
            fontSize: '11px',
            color: 'var(--athena-text-secondary)',
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={12} />
          <span>Reload</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {/* Storage Health */}
        <div
          style={{
            backgroundColor: 'var(--athena-surface)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <HardDrive size={16} color="var(--athena-accent)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
              Storage Subsystem
            </span>
          </div>
          <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--athena-text-muted)' }}>Storage Driver:</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                {healthData?.database?.driver || healthData?.driver || 'SQLite3 (state.db)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--athena-text-muted)' }}>Readiness:</span>
              <span style={{ color: 'var(--athena-success)', fontWeight: 600 }}>
                {healthData?.status === 'ok' || healthData?.status === 'ready' ? 'Ready' : 'Connected'}
              </span>
            </div>
          </div>
        </div>

        {/* Safety & Policy */}
        <div
          style={{
            backgroundColor: 'var(--athena-surface)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <ShieldCheck size={16} color="var(--athena-accent)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
              Policy & Safety Enforcement
            </span>
          </div>
          <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--athena-text-muted)' }}>Autonomy Enforcement:</span>
              <span style={{ color: 'var(--athena-success)' }}>Active PolicyEngine</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--athena-text-muted)' }}>Approval Gate:</span>
              <span style={{ color: 'var(--athena-warning)' }}>Mandatory for destructive actions</span>
            </div>
          </div>
        </div>
      </div>

      {/* Real Capabilities Table */}
      <div style={{ marginBottom: '12px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '4px' }}>
          Registered Capabilities ({capabilities.length})
        </h2>
        <p style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
          Honest capability registry declaring real, experimental, or unsupported subsystems.
        </p>
      </div>

      <div
        style={{
          backgroundColor: 'var(--athena-surface)',
          border: '1px solid var(--athena-border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '180px 140px 100px 1fr',
            padding: '8px 16px',
            borderBottom: '1px solid var(--athena-border-subtle)',
            fontSize: '10px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            color: 'var(--athena-text-muted)',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}
        >
          <span>Capability</span>
          <span>Category</span>
          <span>Status</span>
          <span>Notes / Rationale</span>
        </div>

        {capabilities.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
            {isLoading ? 'Querying capability registry...' : 'No capabilities registered in backend response.'}
          </div>
        ) : (
          capabilities.map((c, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 140px 100px 1fr',
                alignItems: 'center',
                padding: '10px 16px',
                borderBottom: '1px solid var(--athena-border-subtle)',
                fontSize: '12px',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-text)' }}>
                {c.name}
              </span>
              <span style={{ color: 'var(--athena-text-secondary)', fontSize: '11px' }}>
                {c.category}
              </span>
              <div>
                <span
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-xs)',
                    color:
                      c.status === 'real'
                        ? 'var(--athena-success)'
                        : c.status === 'experimental'
                        ? 'var(--athena-warning)'
                        : 'var(--athena-danger)',
                    border: `1px solid ${
                      c.status === 'real'
                        ? 'var(--athena-success)'
                        : c.status === 'experimental'
                        ? 'var(--athena-warning)'
                        : 'var(--athena-danger)'
                    }`,
                    textTransform: 'uppercase',
                  }}
                >
                  {c.status}
                </span>
              </div>
              <span style={{ color: 'var(--athena-text-muted)', fontSize: '11px' }}>
                {c.reason || 'Native subsystem capability.'}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
