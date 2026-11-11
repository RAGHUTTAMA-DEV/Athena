import React, { useState, useEffect } from 'react';
import { HardDrive, Cpu, ShieldCheck, RotateCcw, Code2, Monitor, Globe } from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export const InspectionPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'system' | 'intelligence' | 'environment'>('system');

  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [healthData, setHealthData] = useState<any>(null);
  const [policyData, setPolicyData] = useState<any>(null);

  const [modelsData, setModelsData] = useState<{ models: any[]; policies: any[] }>({ models: [], policies: [] });
  const [cacheStats, setCacheStats] = useState<any>(null);
  const [telemetry, setTelemetry] = useState<any>(null);

  const [harnessStatus, setHarnessStatus] = useState<any>(null);
  const [harnessDiff, setHarnessDiff] = useState<string>('');
  const [browserProfiles, setBrowserProfiles] = useState<any[]>([]);
  const [windows, setWindows] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);

  const fetchInspection = async () => {
    try {
      setIsLoading(true);
      const [caps, health, pol, mods, cache, tel, har, diff, bProf, wins] = await Promise.allSettled([
        apiClient.getSystemCapabilities(),
        apiClient.checkHealthReady(),
        apiClient.getSystemPolicy(),
        apiClient.listModels(),
        apiClient.getCacheStats(),
        apiClient.getTelemetryMetrics(),
        apiClient.getHarnessStatus(),
        apiClient.getHarnessDiff(),
        apiClient.listBrowserProfiles(),
        apiClient.listComputerWindows(),
      ]);

      if (caps.status === 'fulfilled') setCapabilities(caps.value.capabilities || []);
      if (health.status === 'fulfilled') setHealthData(health.value);
      if (pol.status === 'fulfilled') setPolicyData(pol.value.policy || pol.value);
      if (mods.status === 'fulfilled') setModelsData(mods.value);
      if (cache.status === 'fulfilled') setCacheStats(cache.value);
      if (tel.status === 'fulfilled') setTelemetry(tel.value);
      if (har.status === 'fulfilled') setHarnessStatus(har.value);
      if (diff.status === 'fulfilled') setHarnessDiff(diff.value.diff || '');
      if (bProf.status === 'fulfilled') setBrowserProfiles(bProf.value);
      if (wins.status === 'fulfilled') setWindows(wins.value);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInspection();
  }, []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1040px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            System, Intelligence & Environment Inspection
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Live diagnostics for capabilities, model routing, prompt caching, coding harness, browser profiles, and desktop windows.
          </p>
        </div>

        <button
          onClick={fetchInspection}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '5px 10px',
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--athena-border)', marginBottom: '20px' }}>
        {[
          { id: 'system', label: 'Capabilities & Policy', icon: ShieldCheck },
          { id: 'intelligence', label: 'Models, Cache & Telemetry', icon: Cpu },
          { id: 'environment', label: 'Coding Harness, Browser & Screen', icon: Monitor },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                fontSize: '12px',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                borderBottom: active ? '2px solid var(--athena-accent)' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: SYSTEM & CAPABILITIES */}
      {activeTab === 'system' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <HardDrive size={16} color="var(--athena-accent)" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>Storage Subsystem</span>
              </div>
              <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--athena-text-muted)' }}>Storage Driver:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                    {healthData?.database?.driver || 'sqlite'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--athena-text-muted)' }}>Readiness:</span>
                  <span style={{ color: healthData?.database?.connected ? 'var(--athena-success)' : 'var(--athena-warning)', fontWeight: 600 }}>
                    {healthData?.status || 'unknown'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <ShieldCheck size={16} color="var(--athena-accent)" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>Policy & Safety</span>
              </div>
              <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--athena-text-muted)' }}>Sandbox Enforced:</span>
                  <span style={{ color: 'var(--athena-success)' }}>{String(policyData?.sandboxEnforced ?? true)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--athena-text-muted)' }}>Injection Defense:</span>
                  <span style={{ color: 'var(--athena-text)' }}>{policyData?.promptInjectionDefense || 'active'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--athena-text-muted)' }}>Max Turn Budget:</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>{policyData?.maxTurnBudget ?? 20}</span>
                </div>
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '8px' }}>
            Registered Capabilities ({capabilities.length})
          </h2>
          <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 140px 100px 1fr', padding: '8px 16px', borderBottom: '1px solid var(--athena-border-subtle)', fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>
              <span>Capability</span>
              <span>Category</span>
              <span>Status</span>
              <span>Rationale</span>
            </div>
            {capabilities.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
                {isLoading ? 'Querying capability registry...' : 'No capabilities returned.'}
              </div>
            ) : (
              capabilities.map((c, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '180px 140px 100px 1fr', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--athena-border-subtle)', fontSize: '12px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-text)' }}>{c.name}</span>
                  <span style={{ color: 'var(--athena-text-secondary)', fontSize: '11px' }}>{c.category}</span>
                  <div>
                    <span style={{ fontSize: '9px', fontWeight: 700, padding: '1px 6px', borderRadius: 'var(--radius-xs)', color: c.status === 'real' ? 'var(--athena-success)' : c.status === 'experimental' ? 'var(--athena-warning)' : 'var(--athena-danger)', border: `1px solid ${c.status === 'real' ? 'var(--athena-success)' : c.status === 'experimental' ? 'var(--athena-warning)' : 'var(--athena-danger)'}`, textTransform: 'uppercase' }}>
                      {c.status}
                    </span>
                  </div>
                  <span style={{ color: 'var(--athena-text-muted)', fontSize: '11px' }}>{c.reason || 'Native subsystem capability.'}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: INTELLIGENCE, CACHE & TELEMETRY */}
      {activeTab === 'intelligence' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
            {[
              { label: 'Total Runs', val: telemetry?.runs?.total ?? telemetry?.totalRuns ?? 0 },
              { label: 'Completed Runs', val: telemetry?.runs?.completed ?? telemetry?.completedRuns ?? 0 },
              { label: 'Cache Hit Rate', val: `${Math.round((cacheStats?.hitRate || 0) * 100)}%` },
              { label: 'Tokens Saved', val: cacheStats?.tokensSaved ?? 0 },
            ].map((m) => (
              <div key={m.label} style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>{m.label}</div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--athena-text)', marginTop: '4px' }}>{m.val}</div>
              </div>
            ))}
          </div>

          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '10px' }}>
              Model Routing Policies ({modelsData.policies?.length || 0})
            </h2>
            <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 120px', padding: '8px 16px', borderBottom: '1px solid var(--athena-border-subtle)', fontSize: '10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>
                <span>Category</span>
                <span>Preferred Model</span>
                <span>Fallback Model</span>
                <span>Provider</span>
              </div>
              {(modelsData.policies || []).map((p: any) => (
                <div key={p.category} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 1fr 120px', padding: '10px 16px', borderBottom: '1px solid var(--athena-border-subtle)', fontSize: '12px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{p.category}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-accent)' }}>{p.model}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>{p.fallbackModel || '—'}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text-secondary)' }}>{p.provider}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CODING HARNESS, BROWSER & COMPUTER */}
      {activeTab === 'environment' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* Coding Harness */}
            <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <Code2 size={15} color="var(--athena-accent)" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>Coding Harness & Repo</span>
              </div>
              <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-secondary)', whiteSpace: 'pre-wrap' }}>
                {harnessStatus ? JSON.stringify(harnessStatus, null, 2) : 'Unavailable'}
              </pre>
            </div>

            {/* Browser & Windows */}
            <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <Globe size={15} color="var(--athena-accent)" />
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                  Browser Profiles ({browserProfiles.length}) & Windows ({windows.length})
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {browserProfiles.map((bp: any) => (
                  <div key={bp.id} style={{ padding: '6px 8px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
                    Browser Profile: {bp.name} ({bp.id})
                  </div>
                ))}
                {windows.slice(0, 6).map((w: any, idx: number) => (
                  <div key={idx} style={{ padding: '6px 8px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)', fontSize: '11px' }}>
                    Window: {w.title || w.name || JSON.stringify(w)}
                  </div>
                ))}
                {browserProfiles.length === 0 && windows.length === 0 && (
                  <span style={{ color: 'var(--athena-text-muted)' }}>No active browser profiles or inspected windows.</span>
                )}
              </div>
            </div>
          </div>

          {/* Git Diff */}
          <div>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '8px' }}>
              Workspace Git Diff
            </h2>
            <pre
              style={{
                padding: '14px',
                backgroundColor: '#121314',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                color: 'var(--athena-text-secondary)',
                maxHeight: '320px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {harnessDiff || 'Working tree clean (no uncommitted git diff).'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
