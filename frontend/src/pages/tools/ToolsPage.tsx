import React, { useState, useEffect } from 'react';
import {
  Wrench,
  Server,
  Plus,
  Trash2,
  Search,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Radio,
  Calendar,
} from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export const ToolsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'mcp' | 'catalog' | 'channels'>('mcp');

  // MCP Servers
  const [mcpServers, setMcpServers] = useState<Record<string, any>>({});
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [mcpName, setMcpName] = useState('');
  const [mcpType, setMcpType] = useState<'stdio' | 'sse' | 'http'>('stdio');
  const [mcpCommand, setMcpCommand] = useState('npx');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpEnvText, setMcpEnvText] = useState('');

  // Tool Catalog
  const [tools, setTools] = useState<any[]>([]);
  const [totalTools, setTotalTools] = useState(0);
  const [toolSearch, setToolSearch] = useState('');
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  // Channels & Calendar
  const [channels, setChannels] = useState<any[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [mcpRes, toolsRes, chanRes, calRes] = await Promise.allSettled([
        apiClient.listMcpServers(),
        apiClient.listTools(toolSearch || undefined),
        apiClient.listChannels(),
        apiClient.listCalendarEvents(),
      ]);

      if (mcpRes.status === 'fulfilled') setMcpServers(mcpRes.value.servers || {});
      if (toolsRes.status === 'fulfilled') {
        setTools(toolsRes.value.tools || []);
        setTotalTools(toolsRes.value.totalRegistered || toolsRes.value.count || 0);
      }
      if (chanRes.status === 'fulfilled') setChannels(chanRes.value || []);
      if (calRes.status === 'fulfilled') setCalendarEvents(calRes.value || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load tools and connections');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      apiClient.listTools(toolSearch || undefined).then((res) => {
        setTools(res.tools || []);
        setTotalTools(res.totalRegistered || res.count || 0);
      }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [toolSearch]);

  const handleAddMcp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mcpName.trim()) return;

    const parsedArgs = mcpArgs
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const parsedEnv: Record<string, string> = {};
    if (mcpEnvText.trim()) {
      for (const line of mcpEnvText.split('\n')) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          parsedEnv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }

    try {
      await apiClient.registerMcpServer({
        name: mcpName.trim(),
        type: mcpType,
        command: mcpType === 'stdio' ? mcpCommand.trim() : undefined,
        args: mcpType === 'stdio' && parsedArgs.length > 0 ? parsedArgs : undefined,
        url: mcpType !== 'stdio' ? mcpUrl.trim() : undefined,
        env: Object.keys(parsedEnv).length > 0 ? parsedEnv : undefined,
      });
      setMcpName('');
      setMcpArgs('');
      setMcpUrl('');
      setMcpEnvText('');
      setShowAddMcp(false);
      await loadData();
    } catch (err: any) {
      alert(`Failed to save MCP server: ${err.message}`);
    }
  };

  const handleDeleteMcp = async (name: string) => {
    try {
      await apiClient.deleteMcpServer(name);
      await loadData();
    } catch (err: any) {
      alert(`Failed to delete MCP server: ${err.message}`);
    }
  };

  const serverEntries = Object.entries(mcpServers);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1040px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Tools & Connections
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Manage MCP servers in <code>mcp_servers.json</code>, inspect Athena&apos;s {totalTools} registered tools, and view channels.
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
      <div
        style={{
          display: 'flex',
          gap: '4px',
          borderBottom: '1px solid var(--athena-border)',
          marginBottom: '20px',
        }}
      >
        {[
          { id: 'mcp', label: `MCP Servers (${serverEntries.length})`, icon: Server },
          { id: 'catalog', label: `Tool Catalog (${totalTools})`, icon: Wrench },
          { id: 'channels', label: `Channels & Calendar`, icon: Radio },
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

      {error && (
        <div style={{ marginBottom: '16px', padding: '10px 14px', backgroundColor: 'var(--athena-danger-dim)', border: '1px solid var(--athena-danger)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-danger)', fontSize: '12px' }}>
          {error}
        </div>
      )}

      {/* TAB 1: MCP SERVERS */}
      {activeTab === 'mcp' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '12px', color: 'var(--athena-text-secondary)' }}>
              Configured servers in <code>mcp_servers.json</code> (restart backend to connect newly added stdio servers).
            </span>
            <button
              onClick={() => setShowAddMcp((p) => !p)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: 'var(--athena-accent)',
                color: '#171819',
                borderRadius: 'var(--radius-xs)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} />
              <span>{showAddMcp ? 'Cancel' : 'Add MCP Server'}</span>
            </button>
          </div>

          {showAddMcp && (
            <form
              onSubmit={handleAddMcp}
              style={{
                marginBottom: '20px',
                padding: '18px',
                backgroundColor: 'var(--athena-surface)',
                border: '1px solid var(--athena-border-focus)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                    Server Name *
                  </label>
                  <input
                    required
                    placeholder="e.g. postgres or brave-search"
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                    Transport Type
                  </label>
                  <select
                    value={mcpType}
                    onChange={(e) => setMcpType(e.target.value as any)}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', color: 'var(--athena-text)' }}
                  >
                    <option value="stdio">stdio</option>
                    <option value="sse">sse</option>
                    <option value="http">http</option>
                  </select>
                </div>
              </div>

              {mcpType === 'stdio' ? (
                <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                      Command
                    </label>
                    <input
                      placeholder="npx or npx.cmd or node"
                      value={mcpCommand}
                      onChange={(e) => setMcpCommand(e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                      Arguments (space-separated)
                    </label>
                    <input
                      placeholder="-y @modelcontextprotocol/server-memory"
                      value={mcpArgs}
                      onChange={(e) => setMcpArgs(e.target.value)}
                      style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                    Endpoint URL
                  </label>
                  <input
                    placeholder="https://example.com/mcp/sse"
                    value={mcpUrl}
                    onChange={(e) => setMcpUrl(e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
                  Environment Variables (optional, KEY=VALUE per line — e.g. API_KEY=${'{env:API_KEY}'})
                </label>
                <textarea
                  rows={2}
                  placeholder="BRAVE_API_KEY=${env:BRAVE_API_KEY}"
                  value={mcpEnvText}
                  onChange={(e) => setMcpEnvText(e.target.value)}
                  style={{ width: '100%', padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  style={{ padding: '7px 16px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                >
                  Save MCP Server
                </button>
              </div>
            </form>
          )}

          {serverEntries.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              {isLoading ? 'Loading MCP servers...' : 'No MCP servers configured in mcp_servers.json.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
              {serverEntries.map(([name, cfg]) => (
                <div
                  key={name}
                  style={{
                    backgroundColor: 'var(--athena-surface)',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Server size={14} color="var(--athena-accent)" />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>{name}</span>
                      <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', padding: '1px 5px', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>
                        {cfg.type || (cfg.url ? 'sse' : 'stdio')}
                      </span>
                    </div>
                    <button
                      onClick={() => handleDeleteMcp(name)}
                      title="Remove server"
                      style={{ color: 'var(--athena-text-muted)', cursor: 'pointer', padding: '4px' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {cfg.command && (
                    <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-secondary)', backgroundColor: 'var(--athena-surface-deep)', padding: '6px 8px', borderRadius: 'var(--radius-xs)', wordBreak: 'break-all' }}>
                      {cfg.command} {Array.isArray(cfg.args) ? cfg.args.join(' ') : ''}
                    </div>
                  )}

                  {cfg.url && (
                    <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-info)', backgroundColor: 'var(--athena-surface-deep)', padding: '6px 8px', borderRadius: 'var(--radius-xs)', wordBreak: 'break-all' }}>
                      {cfg.url}
                    </div>
                  )}

                  {cfg.env && (
                    <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                      Env keys: {Object.keys(cfg.env).join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TOOL CATALOG */}
      {activeTab === 'catalog' && (
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 12px',
              marginBottom: '16px',
            }}
          >
            <Search size={14} color="var(--athena-text-muted)" />
            <input
              placeholder="Search tools by name, capability, or tag..."
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
              style={{ width: '100%', fontSize: '12px' }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {tools.map((t) => {
              const open = !!expandedTools[t.name];
              const riskColor =
                t.riskLevel === 'destructive'
                  ? 'var(--athena-danger)'
                  : t.riskLevel === 'confirm' || t.requiresConfirmation
                  ? 'var(--athena-warning)'
                  : 'var(--athena-success)';

              return (
                <div
                  key={t.name}
                  style={{
                    backgroundColor: 'var(--athena-surface)',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-sm)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setExpandedTools((p) => ({ ...p, [t.name]: !p[t.name] }))}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ minWidth: 0, paddingRight: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                        <code style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: 'var(--athena-text)' }}>
                          {t.name}
                        </code>
                        <span style={{ fontSize: '9px', fontFamily: 'var(--font-mono)', padding: '1px 5px', border: `1px solid ${riskColor}`, color: riskColor, borderRadius: 'var(--radius-xs)', textTransform: 'uppercase' }}>
                          {t.requiresConfirmation ? 'confirm' : t.riskLevel}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                          {t.category}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.description}
                      </div>
                    </div>
                    {open ? <ChevronDown size={14} color="var(--athena-text-muted)" /> : <ChevronRight size={14} color="var(--athena-text-muted)" />}
                  </button>

                  {open && (
                    <div style={{ padding: '10px 14px', borderTop: '1px solid var(--athena-border-subtle)', backgroundColor: 'var(--athena-surface-deep)' }}>
                      <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', marginBottom: '6px' }}>
                        Timeout: {t.timeoutMs}ms · Parallel safe: {String(t.parallelSafe)}
                      </div>
                      <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--athena-accent)', overflowX: 'auto' }}>
                        {JSON.stringify(t.parameters, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: CHANNELS & CALENDAR */}
      {activeTab === 'channels' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Radio size={15} color="var(--athena-accent)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                Communication Channels ({channels.length})
              </span>
            </div>
            {channels.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
                No active external channels registered in database yet.
              </div>
            ) : (
              channels.map((c) => (
                <div key={c.id} style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)', marginBottom: '8px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{c.name || c.id}</div>
                  <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>{c.type} · {c.status}</div>
                </div>
              ))
            )}
          </div>

          <div style={{ backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Calendar size={15} color="var(--athena-accent)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                Upcoming Calendar Events ({calendarEvents.length})
              </span>
            </div>
            {calendarEvents.length === 0 ? (
              <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
                No upcoming local calendar events scheduled.
              </div>
            ) : (
              calendarEvents.map((ev) => (
                <div key={ev.id} style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)', marginBottom: '8px', fontSize: '12px' }}>
                  <div style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{ev.title}</div>
                  <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
                    {new Date(ev.startTime).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

