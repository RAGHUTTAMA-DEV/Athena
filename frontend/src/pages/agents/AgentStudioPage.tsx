import React, { useState, useEffect } from 'react';
import { Bot, Sparkles, GitBranch, Users, Mail, Check, X, RotateCcw, Plus } from 'lucide-react';
import { apiClient } from '../../lib/api/client';
import { StatusBadge } from '../../components/primitives/StatusBadge';

export const AgentStudioPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'skills' | 'workflows' | 'teams' | 'messages'>('skills');

  const [skills, setSkills] = useState<any[]>([]);
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [recipientFilter, setRecipientFilter] = useState('researcher');

  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [tName, setTName] = useState('');
  const [tJustification, setTJustification] = useState('');
  const [tLead, setTLead] = useState('athena-lead');
  const [tMembers, setTMembers] = useState('researcher, coder, reviewer');

  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [skRes, wfRes, tmRes, msgRes] = await Promise.allSettled([
        apiClient.listSkills(),
        apiClient.listWorkflows(),
        apiClient.listTeams(),
        apiClient.listAgentMessages(recipientFilter),
      ]);

      if (skRes.status === 'fulfilled') setSkills(skRes.value);
      if (wfRes.status === 'fulfilled') setWorkflows(wfRes.value);
      if (tmRes.status === 'fulfilled') setTeams(tmRes.value);
      if (msgRes.status === 'fulfilled') setMessages(msgRes.value);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleReviewWorkflow = async (id: string, status: 'active' | 'rejected') => {
    try {
      await apiClient.reviewWorkflow(id, status);
      await loadData();
    } catch (err: any) {
      alert(`Review failed: ${err.message}`);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tName.trim() || !tJustification.trim()) return;
    try {
      await apiClient.createTeam({
        name: tName.trim(),
        justification: tJustification.trim(),
        leadAgentId: tLead.trim(),
        memberAgentIds: tMembers.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setTName('');
      setTJustification('');
      setShowCreateTeam(false);
      await loadData();
    } catch (err: any) {
      alert(`Team creation failed: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1040px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Agent Studio
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Manage learned skills, review proposed workflows, inspect multi-agent teams, and trace A2A messages.
          </p>
        </div>

        <button
          onClick={loadData}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--athena-text-secondary)', cursor: 'pointer' }}
        >
          <RotateCcw size={12} />
          <span>Reload</span>
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--athena-border)', marginBottom: '20px' }}>
        {[
          { id: 'skills', label: `Skills (${skills.length})`, icon: Sparkles },
          { id: 'workflows', label: `Learned Workflows (${workflows.length})`, icon: GitBranch },
          { id: 'teams', label: `Teams (${teams.length})`, icon: Users },
          { id: 'messages', label: `A2A Mailbox (${messages.length})`, icon: Mail },
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

      {/* TAB 1: SKILLS */}
      {activeTab === 'skills' && (
        <div>
          {skills.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              {isLoading ? 'Loading skills...' : 'No procedural skill records stored yet.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '12px' }}>
              {skills.map((sk) => (
                <div key={sk.id} style={{ padding: '14px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>{sk.name}</span>
                    <StatusBadge status={sk.status || 'active'} size="sm" />
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '8px' }}>
                    {sk.description || 'No description'}
                  </p>
                  <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    v{sk.version || 1} · Success rate: {Math.round((sk.successRate || 0) * 100)}%
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: LEARNED WORKFLOWS */}
      {activeTab === 'workflows' && (
        <div>
          {workflows.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No learned workflow proposals recorded yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {workflows.map((wf) => (
                <div key={wf.id} style={{ padding: '14px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>{wf.name}</span>
                    <StatusBadge status={wf.status} size="sm" />
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '10px' }}>{wf.description}</p>
                  {wf.status === 'proposed' && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleReviewWorkflow(wf.id, 'active')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 12px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        <Check size={13} />
                        <span>Activate Workflow</span>
                      </button>
                      <button
                        onClick={() => handleReviewWorkflow(wf.id, 'rejected')}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '5px 12px', backgroundColor: 'var(--athena-danger-dim)', border: '1px solid var(--athena-danger)', color: 'var(--athena-danger)', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                      >
                        <X size={13} />
                        <span>Reject</span>
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: TEAMS */}
      {activeTab === 'teams' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
            <button
              onClick={() => setShowCreateTeam((p) => !p)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
            >
              <Plus size={14} />
              <span>{showCreateTeam ? 'Cancel' : 'New Team'}</span>
            </button>
          </div>

          {showCreateTeam && (
            <form
              onSubmit={handleCreateTeam}
              style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border-focus)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '10px' }}
            >
              <input
                required
                placeholder="Team name (e.g. Security Review Squad)"
                value={tName}
                onChange={(e) => setTName(e.target.value)}
                style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
              />
              <input
                required
                placeholder="Specialization justification *"
                value={tJustification}
                onChange={(e) => setTJustification(e.target.value)}
                style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <input
                  required
                  placeholder="Lead agent ID"
                  value={tLead}
                  onChange={(e) => setTLead(e.target.value)}
                  style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
                <input
                  required
                  placeholder="Member agent IDs (comma-separated)"
                  value={tMembers}
                  onChange={(e) => setTMembers(e.target.value)}
                  style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" style={{ padding: '6px 14px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                  Create Team
                </button>
              </div>
            </form>
          )}

          {teams.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No multi-agent teams defined yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {teams.map((tm) => (
                <div key={tm.id} style={{ padding: '14px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)' }}>{tm.name}</span>
                    <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-accent)' }}>Lead: {tm.leadAgentId}</span>
                  </div>
                  <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '8px' }}>{tm.justification}</p>
                  <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    Members: {Array.isArray(tm.memberAgentIds) ? tm.memberAgentIds.join(', ') : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: A2A MAILBOX */}
      {activeTab === 'messages' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            <input
              placeholder="Recipient agent ID (e.g. researcher, coder, reviewer)"
              value={recipientFilter}
              onChange={(e) => setRecipientFilter(e.target.value)}
              style={{ flex: 1, padding: '7px 10px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
            />
            <button
              onClick={() => apiClient.listAgentMessages(recipientFilter).then(setMessages).catch(() => {})}
              style={{ padding: '7px 14px', backgroundColor: 'var(--athena-surface-raised)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', color: 'var(--athena-text)', cursor: 'pointer' }}
            >
              Query Mailbox
            </button>
          </div>

          {messages.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              No A2A messages found for recipient &quot;{recipientFilter}&quot;.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {messages.map((m) => (
                <div key={m.id} style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', fontSize: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-accent)' }}>
                      {m.senderId} → {m.recipientId} [{m.messageType}]
                    </span>
                    <StatusBadge status={m.status} size="sm" />
                  </div>
                  <pre style={{ margin: 0, fontSize: '11px', color: 'var(--athena-text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

