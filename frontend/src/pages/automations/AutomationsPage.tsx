import React, { useState, useEffect } from 'react';
import { Clock, HeartPulse, Zap, Webhook, RotateCcw, Plus } from 'lucide-react';
import { apiClient } from '../../lib/api/client';
import { StatusBadge } from '../../components/primitives/StatusBadge';

export const AutomationsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'routines' | 'heartbeats' | 'events' | 'webhooks'>('routines');

  const [routines, setRoutines] = useState<any[]>([]);
  const [heartbeats, setHeartbeats] = useState<{ summary: any; recentLogs: any[] }>({ summary: {}, recentLogs: [] });
  const [events, setEvents] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);

  const [showCreateRoutine, setShowCreateRoutine] = useState(false);
  const [rName, setRName] = useState('');
  const [rTriggerType, setRTriggerType] = useState<'schedule' | 'event' | 'condition'>('schedule');
  const [rSchedule, setRSchedule] = useState('0 9 * * *');
  const [rPrompt, setRPrompt] = useState('');

  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [routRes, hbRes, evRes, whRes] = await Promise.allSettled([
        apiClient.listRoutines(),
        apiClient.getHeartbeats(),
        apiClient.listProactiveEvents(),
        apiClient.listWebhooks(),
      ]);

      if (routRes.status === 'fulfilled') setRoutines(routRes.value);
      if (hbRes.status === 'fulfilled') setHeartbeats(hbRes.value);
      if (evRes.status === 'fulfilled') setEvents(evRes.value);
      if (whRes.status === 'fulfilled') setWebhooks(whRes.value);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rName.trim() || !rPrompt.trim()) return;
    try {
      await apiClient.createRoutine({
        name: rName.trim(),
        triggerType: rTriggerType,
        triggerConfig: rTriggerType === 'schedule' ? { cron: rSchedule.trim() } : { pattern: rSchedule.trim() },
        workflow: { prompt: rPrompt.trim() },
      });
      setRName('');
      setRPrompt('');
      setShowCreateRoutine(false);
      await loadData();
    } catch (err: any) {
      alert(`Failed to create routine: ${err.message}`);
    }
  };

  const handleRetryEvent = async (id: string) => {
    try {
      await apiClient.retryProactiveEvent(id);
      await loadData();
    } catch (err: any) {
      alert(`Retry failed: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1040px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Automations & Proactive Runtime
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Inspect recurring routines, proactive heartbeats, durable event queue, and webhook endpoints.
          </p>
        </div>

        <button
          onClick={loadData}
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
          { id: 'routines', label: `Routines (${routines.length})`, icon: Clock },
          { id: 'heartbeats', label: `Heartbeats (${heartbeats.recentLogs?.length || 0})`, icon: HeartPulse },
          { id: 'events', label: `Event Pipeline (${events.length})`, icon: Zap },
          { id: 'webhooks', label: `Webhooks (${webhooks.length})`, icon: Webhook },
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

      {/* TAB 1: ROUTINES */}
      {activeTab === 'routines' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button
              onClick={() => setShowCreateRoutine((p) => !p)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              <Plus size={14} />
              <span>{showCreateRoutine ? 'Cancel' : 'New Routine'}</span>
            </button>
          </div>

          {showCreateRoutine && (
            <form
              onSubmit={handleCreateRoutine}
              style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border-focus)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px 180px', gap: '10px' }}>
                <input
                  required
                  placeholder="Routine name (e.g. Daily AI Digest)"
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                  style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
                />
                <select
                  value={rTriggerType}
                  onChange={(e) => setRTriggerType(e.target.value as any)}
                  style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', color: 'var(--athena-text)' }}
                >
                  <option value="schedule">schedule</option>
                  <option value="event">event</option>
                  <option value="condition">condition</option>
                </select>
                <input
                  placeholder={rTriggerType === 'schedule' ? 'Cron (0 9 * * *)' : 'Event topic'}
                  value={rSchedule}
                  onChange={(e) => setRSchedule(e.target.value)}
                  style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <textarea
                required
                rows={2}
                placeholder="Workflow instruction / prompt to execute..."
                value={rPrompt}
                onChange={(e) => setRPrompt(e.target.value)}
                style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ padding: '6px 14px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  Create Routine
                </button>
              </div>
            </form>
          )}

          {routines.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              {isLoading ? 'Loading routines...' : 'No routines registered yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {routines.map((rt) => (
                <div key={rt.id} style={{ padding: '14px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>{rt.name}</span>
                      <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', padding: '1px 6px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', color: 'var(--athena-accent)' }}>
                        {rt.triggerType}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: rt.enabled ? 'var(--athena-success)' : 'var(--athena-text-muted)' }}>
                      {rt.enabled ? 'Enabled' : 'Disabled'} · {rt.invocations || 0} runs
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    Trigger: {JSON.stringify(rt.triggerConfig)} · Workflow: {JSON.stringify(rt.workflow)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: HEARTBEATS */}
      {activeTab === 'heartbeats' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '18px' }}>
            {[
              { label: 'Ticks (24h)', val: heartbeats.summary?.totalTicks ?? 0 },
              { label: 'Wakes (24h)', val: heartbeats.summary?.totalWakes ?? 0 },
              { label: 'Tokens (24h)', val: heartbeats.summary?.totalTokens ?? 0 },
              { label: 'Cost USD (24h)', val: `$${Number(heartbeats.summary?.totalCostUsd || 0).toFixed(4)}` },
            ].map((m) => (
              <div key={m.label} style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>{m.label}</div>
                <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--athena-text)', marginTop: '4px' }}>{m.val}</div>
              </div>
            ))}
          </div>

          {(!heartbeats.recentLogs || heartbeats.recentLogs.length === 0) ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No proactive heartbeat inspections recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {heartbeats.recentLogs.map((log: any, idx: number) => (
                <div key={log.id || idx} style={{ padding: '10px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{log.wakeReason || log.outcome || 'Heartbeat tick'}</span>
                    <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>{log.summary || ''}</div>
                  </div>
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    {log.timestamp ? new Date(log.timestamp).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: PROACTIVE EVENTS */}
      {activeTab === 'events' && (
        <div>
          {events.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No durable proactive events in the pipeline.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {events.map((ev) => (
                <div key={ev.id} style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <code style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-text)' }}>{ev.topic}</code>
                      <StatusBadge status={ev.status} size="sm" />
                      <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>priority: {ev.priority}</span>
                    </div>
                    {ev.errorMessage && <div style={{ fontSize: '11px', color: 'var(--athena-danger)' }}>{ev.errorMessage}</div>}
                  </div>
                  {(ev.status === 'failed' || ev.status === 'dead_letter') && (
                    <button
                      onClick={() => handleRetryEvent(ev.id)}
                      style={{ padding: '4px 10px', backgroundColor: 'var(--athena-surface-raised)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--athena-text)', cursor: 'pointer' }}
                    >
                      Retry
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: WEBHOOKS */}
      {activeTab === 'webhooks' && (
        <div>
          {webhooks.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No webhook endpoints configured.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {webhooks.map((wh) => (
                <div key={wh.id} style={{ padding: '14px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{wh.name || wh.id}</span>
                    <span style={{ fontSize: '11px', color: wh.isActive ? 'var(--athena-success)' : 'var(--athena-text-muted)' }}>
                      {wh.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    POST /api/v1/webhooks/incoming/{wh.id} · Signature required: {String(Boolean(wh.requireSignature))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

