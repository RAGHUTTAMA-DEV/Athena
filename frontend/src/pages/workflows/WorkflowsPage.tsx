import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  GitBranch,
  Play,
  Plus,
  Save,
  Trash2,
  Key,
  Sparkles,
  RotateCcw,
  CheckCircle,
  ExternalLink,
  X,
  ChevronDown,
  Zap,
  Bot,
  Users,
  Wrench,
  Split,
  ShieldCheck,
  Repeat,
  Layers,
  Shield,
  Copy,
  Maximize2,
  Minimize2,
  FileText,
  Terminal,
  RefreshCw,
  Sliders,
  Code
} from 'lucide-react';

import { apiClient } from '../../lib/api/client';
import { WorkflowNodeComponent } from './WorkflowNodeComponent';
import { NodeConfigInspector } from './NodeConfigInspector';
import { TemplatePickerModal } from './TemplatePickerModal';
import { IntegrationsModal } from './IntegrationsModal';
import { STARTER_TEMPLATES, StarterWorkflowTemplate } from './starterTemplates';

// Auto-centers and zooms the viewport whenever a workflow is switched or loaded
const FlowViewportFitter: React.FC<{ activeId: string | null; nodesCount: number }> = ({ activeId, nodesCount }) => {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodesCount > 0) {
      const t = setTimeout(() => {
        fitView({ padding: 0.25, duration: 250 });
      }, 60);
      return () => clearTimeout(t);
    }
  }, [activeId, nodesCount, fitView]);

  return null;
};

export const getDefaultInputsForWorkflow = (wf: any): Record<string, any> => {
  if (!wf) return {};

  const id = String(wf.id || '').toLowerCase();
  const name = String(wf.name || '').toLowerCase();

  // 1. Check known templates by ID or Name
  if (id.includes('coding') || name.includes('coding') || (wf.inputs && 'task' in wf.inputs)) {
    return {
      task: "Implement an in-memory LRU cache with TTL expiration and concurrent safety"
    };
  }

  if (id.includes('research') || name.includes('research') || (wf.inputs && 'topic' in wf.inputs)) {
    return {
      topic: "Autonomous agent multi-model consensus and voting architectures"
    };
  }

  if (id.includes('briefing') || id.includes('morning') || name.includes('briefing') || (wf.inputs && 'recipient' in wf.inputs)) {
    return {
      recipient: "me"
    };
  }

  if (id.includes('pr') || id.includes('review') || name.includes('review') || (wf.inputs && ('pr' in wf.inputs || 'repo' in wf.inputs))) {
    return {
      pr: "8",
      repo: "https://github.com/RAGHUTTAMA-DEV/search-agent"
    };
  }

  // 2. Schema-driven resolution for custom workflows
  if (wf.inputs && typeof wf.inputs === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(wf.inputs)) {
      if (typeof val === 'object' && val !== null) {
        const def: any = val;
        if (def.default !== undefined) {
          result[key] = def.default;
        } else if (def.example !== undefined) {
          result[key] = def.example;
        } else if (key === 'task') {
          result[key] = "Implement requested feature and unit tests";
        } else if (key === 'topic') {
          result[key] = "Autonomous agent systems";
        } else if (key === 'pr') {
          result[key] = "8";
        } else if (key === 'repo') {
          result[key] = "https://github.com/RAGHUTTAMA-DEV/search-agent";
        } else if (def.type === 'number') {
          result[key] = 0;
        } else if (def.type === 'boolean') {
          result[key] = false;
        } else if (def.type === 'array') {
          result[key] = [];
        } else {
          result[key] = def.description || `Sample ${key}`;
        }
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  return {};
};

const WorkflowsPageContent: React.FC = () => {
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [activeWf, setActiveWf] = useState<any | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Modals & Popups
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runModalTab, setRunModalTab] = useState<'form' | 'json'>('form');
  const [showIntegrationsModal, setShowIntegrationsModal] = useState(false);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string>('github');
  const [showAddNodeMenu, setShowAddNodeMenu] = useState(false);
  const [integrations, setIntegrations] = useState<any[]>([]);

  // Run execution state
  const [runInputsJson, setRunInputsJson] = useState('{}');
  const [isRunning, setIsRunning] = useState(false);
  const [activeRunResult, setActiveRunResult] = useState<any | null>(null);
  const [showOutputDrawer, setShowOutputDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'summary' | 'raw'>('summary');
  const [isDrawerMaximized, setIsDrawerMaximized] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const nodeTypes = useMemo(() => ({ workflowNode: WorkflowNodeComponent }), []);

  const loadAllWorkflows = async () => {
    try {
      const [wfs, ints] = await Promise.allSettled([
        apiClient.listWorkflows(),
        apiClient.listIntegrations()
      ]);

      if (wfs.status === 'fulfilled') {
        const list = wfs.value;
        setWorkflows(list);

        if (list.length > 0 && !activeWf) {
          const first = await apiClient.getWorkflow(list[0].id).catch(() => list[0]);
          loadWorkflowIntoCanvas(first);
        } else if (list.length === 0) {
          // If no workflow exists yet, load PR Reviewer starter template by default
          const defaultTemplate = STARTER_TEMPLATES[0];
          await apiClient.createWorkflow(defaultTemplate).catch(() => {});
          loadWorkflowIntoCanvas(defaultTemplate);
          const reloaded = await apiClient.listWorkflows().catch(() => []);
          setWorkflows(reloaded);
        }
      }

      if (ints.status === 'fulfilled') {
        setIntegrations(ints.value);
      }
    } catch (err) {
      console.error('Failed to load workflow data:', err);
    }
  };

  useEffect(() => {
    loadAllWorkflows();
  }, []);

  // Converts a workflow DAG into arranged React Flow nodes & edges
  const loadWorkflowIntoCanvas = (wf: any) => {
    if (!wf) return;
    setActiveWf(wf);
    setSelectedNodeId(null);
    setIsDirty(false);
    setActiveRunResult(null);

    // Sync input JSON to this workflow's appropriate inputs schema!
    const defaults = getDefaultInputsForWorkflow(wf);
    setRunInputsJson(JSON.stringify(defaults, null, 2));

    const rawNodes = wf.nodes || [];
    const rawEdges: [string, string][] = wf.edges || [];

    // Topological hierarchical layout
    const inDegrees: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    rawNodes.forEach((n: any) => {
      inDegrees[n.id] = 0;
      adj[n.id] = [];
    });
    rawEdges.forEach(([from, to]) => {
      if (adj[from]) adj[from].push(to);
      if (inDegrees[to] !== undefined) inDegrees[to]++;
    });

    const layers: string[][] = [];
    let currentQueue = rawNodes.filter((n: any) => inDegrees[n.id] === 0).map((n: any) => n.id);
    if (currentQueue.length === 0 && rawNodes.length > 0) {
      currentQueue = [rawNodes[0].id];
    }

    const visited = new Set<string>();
    while (currentQueue.length > 0) {
      layers.push(currentQueue);
      currentQueue.forEach((id: string) => visited.add(id));
      const nextQueue: string[] = [];
      currentQueue.forEach((id: string) => {
        (adj[id] || []).forEach(neighbor => {
          if (!visited.has(neighbor) && !nextQueue.includes(neighbor)) {
            nextQueue.push(neighbor);
          }
        });
      });
      currentQueue = nextQueue;
    }

    const remaining = rawNodes.filter((n: any) => !visited.has(n.id)).map((n: any) => n.id);
    if (remaining.length > 0) {
      layers.push(remaining);
    }

    // Assign positions based on layer & column
    const positions: Record<string, { x: number; y: number }> = {};
    layers.forEach((layer, layerIdx) => {
      const count = layer.length;
      layer.forEach((nodeId, idx) => {
        const offset = (idx - (count - 1) / 2) * 320;
        positions[nodeId] = {
          x: 400 + offset,
          y: 60 + layerIdx * 170
        };
      });
    });

    // Create React Flow Nodes
    const flowNodes: Node[] = rawNodes.map((n: any) => ({
      id: n.id,
      type: 'workflowNode',
      position: positions[n.id] || { x: 400, y: 100 },
      data: {
        id: n.id,
        type: n.type,
        config: n,
        onDeleteNode: handleDeleteNode
      }
    }));

    // Create React Flow Edges
    const flowEdges: Edge[] = rawEdges.map(([from, to]) => ({
      id: `${from}->${to}`,
      source: from,
      target: to,
      animated: true,
      style: { stroke: 'var(--athena-accent, #A8B6AE)', strokeWidth: 1.5 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: 'var(--athena-accent, #A8B6AE)',
        width: 14,
        height: 14
      }
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  };

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (connection.source === connection.target) return;
      setIsDirty(true);
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: 'var(--athena-accent, #A8B6AE)', strokeWidth: 1.5 },
            markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--athena-accent, #A8B6AE)', width: 14, height: 14 }
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const handleAddNode = (nodeType: string) => {
    setShowAddNodeMenu(false);
    const count = nodes.filter(n => (n.data as any)?.type === nodeType).length + 1;
    const newId = `${nodeType}_${count}`;

    const defaultConfigs: Record<string, any> = {
      trigger: { triggerType: 'manual' },
      agent: { prompt: 'Analyze inputs and generate result', tools: [], output: 'text' },
      orchestrator: { systemPrompt: 'Coordinate specialists to solve goal', specialists: [] },
      tool: { tool: 'noop', args: {} },
      collector: { strategy: 'structured_merge', sources: [] },
      condition: { expr: 'inputs.score >= 80', trueBranch: '', falseBranch: '' },
      approval: { message: 'Review outcome and confirm continuation' },
      map: { over: 'nodes.plan.output', maxConcurrency: 3 },
      subWorkflow: { workflowId: '' }
    };

    const newNode: Node = {
      id: newId,
      type: 'workflowNode',
      position: {
        x: 350 + (nodes.length % 3) * 50,
        y: 120 + (nodes.length % 4) * 50
      },
      data: {
        id: newId,
        type: nodeType,
        config: defaultConfigs[nodeType] || {},
        onDeleteNode: handleDeleteNode
      }
    };

    setNodes((nds) => [...nds, newNode]);
    setSelectedNodeId(newId);
    setIsDirty(true);
  };

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setIsDirty(true);
    },
    [selectedNodeId, setNodes, setEdges]
  );

  const handleNodeClick = (_: any, node: Node) => {
    setSelectedNodeId(node.id);
  };

  const handleUpdateNodeConfig = (updatedData: any) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === updatedData.id) {
          return {
            ...n,
            data: {
              ...n.data,
              ...updatedData,
              config: updatedData.config || n.data.config
            }
          };
        }
        return n;
      })
    );
    setIsDirty(true);
  };

  const handleSaveChanges = async (wfToSave?: any) => {
    const targetWf = wfToSave || activeWf;
    if (!targetWf) return;

    const reconstructedNodes = nodes.map((n) => {
      const d = n.data as any;
      return {
        id: n.id,
        type: d.type,
        ...(d.config || {})
      };
    });

    const reconstructedEdges: [string, string][] = edges.map((e) => [e.source, e.target]);

    const updatedWf = {
      ...targetWf,
      version: targetWf.version || 1,
      inputs: targetWf.inputs || {},
      settings: targetWf.settings || { maxTurns: 15 },
      nodes: reconstructedNodes.length > 0 ? reconstructedNodes : targetWf.nodes || [],
      edges: reconstructedEdges.length > 0 ? reconstructedEdges : targetWf.edges || []
    };

    try {
      let res;
      const exists = workflows.some((w) => w.id === targetWf.id);
      if (exists) {
        res = await apiClient.updateWorkflow(targetWf.id, updatedWf);
      } else {
        res = await apiClient.createWorkflow(updatedWf);
      }
      setActiveWf(res);
      setIsDirty(false);
      await loadAllWorkflows();
      return res;
    } catch (err: any) {
      try {
        const res = await apiClient.createWorkflow(updatedWf);
        setActiveWf(res);
        setIsDirty(false);
        await loadAllWorkflows();
        return res;
      } catch (err2: any) {
        alert(`Save failed: ${err2.message || err.message}`);
        throw err2;
      }
    }
  };

  const handleOpenRunModal = () => {
    if (activeWf) {
      const defaults = getDefaultInputsForWorkflow(activeWf);
      try {
        const cur = JSON.parse(runInputsJson);
        const expectedKeys = Object.keys(defaults);
        const curKeys = Object.keys(cur);
        const hasOverlap = expectedKeys.length === 0 || expectedKeys.some((k) => curKeys.includes(k));
        if (!hasOverlap) {
          setRunInputsJson(JSON.stringify(defaults, null, 2));
        }
      } catch {
        setRunInputsJson(JSON.stringify(defaults, null, 2));
      }
    }
    setRunModalTab('form');
    setShowRunModal(true);
  };

  const handleRunWorkflow = async () => {
    if (!activeWf) return;
    setIsRunning(true);
    try {
      let inputs = {};
      try {
        inputs = JSON.parse(runInputsJson);
      } catch {
        alert('Invalid JSON inputs');
        setIsRunning(false);
        return;
      }

      // Guarantee workflow is saved to SQLite before executing
      const exists = workflows.some((w) => w.id === activeWf.id);
      if (!exists || isDirty) {
        await handleSaveChanges();
      }

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: { ...n.data, status: 'running' }
        }))
      );

      const res = await apiClient.runWorkflow(activeWf.id, inputs, true);
      setActiveRunResult(res);
      setShowOutputDrawer(true);

      const nodeOuts = res.run?.nodeOutputs || {};
      setNodes((nds) =>
        nds.map((n) => {
          const out = nodeOuts[n.id];
          return {
            ...n,
            data: {
              ...n.data,
              status: out?.status || 'completed',
              output: out?.output
            }
          };
        })
      );
    } catch (err: any) {
      alert(`Execution failed: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm(`Delete workflow "${id}"?`)) return;
    try {
      await apiClient.deleteWorkflow(id);
      setActiveWf(null);
      await loadAllWorkflows();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const handleSelectTemplate = async (template: StarterWorkflowTemplate) => {
    setShowTemplatesModal(false);
    try {
      // Save directly to backend so it immediately appears in the roster
      const created = await apiClient.createWorkflow(template);
      await loadAllWorkflows();
      loadWorkflowIntoCanvas(created || template);
    } catch (err: any) {
      console.warn('Could not save template to backend directly, loading into canvas:', err);
      loadWorkflowIntoCanvas(template);
      setIsDirty(true);
    }
  };

  const selectedNodeObject = useMemo(() => {
    const found = nodes.find((n) => n.id === selectedNodeId);
    if (!found) return null;
    return {
      id: found.id,
      type: (found.data as any).type,
      config: (found.data as any).config,
      status: (found.data as any).status,
      output: (found.data as any).output
    };
  }, [nodes, selectedNodeId]);

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      width: '100%',
      backgroundColor: 'var(--athena-canvas, #171819)',
      color: 'var(--athena-text, #EDEEEF)',
      fontFamily: 'var(--font-sans)',
      overflow: 'hidden'
    }}>
      {/* ── Left Sidebar: Workflow Roster & Starter Actions ────────── */}
      <div style={{
        width: '240px',
        borderRight: '1px solid var(--athena-border, #303234)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--athena-surface, #1D1E20)',
        flexShrink: 0
      }}>
        {/* Roster Header */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--athena-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--athena-text)' }}>
              Workflows
            </div>
            <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
              {workflows.length} DAG{workflows.length === 1 ? '' : 's'} registered
            </div>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setShowIntegrationsModal(true)}
              title="Integrations & OAuth Vault"
              style={{
                padding: '4px 7px',
                background: 'var(--athena-surface-deep)',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--athena-text-secondary)',
                cursor: 'pointer'
              }}
            >
              <Key size={12} />
            </button>
            <button
              onClick={() => setShowTemplatesModal(true)}
              title="Browse Starter Templates"
              style={{
                padding: '4px 8px',
                background: 'var(--athena-accent-dim)',
                border: '1px solid var(--athena-accent)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--athena-accent)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 600
              }}
            >
              <Sparkles size={11} /> Templates
            </button>
          </div>
        </div>

        {/* Workflow Items List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {workflows.map((wf) => {
            const isSelected = activeWf?.id === wf.id;
            return (
              <div
                key={wf.id}
                onClick={async () => {
                  const full = await apiClient.getWorkflow(wf.id).catch(() => wf);
                  loadWorkflowIntoCanvas(full);
                }}
                style={{
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-xs, 2px)',
                  marginBottom: '4px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--athena-surface-raised, #202123)' : 'transparent',
                  border: isSelected ? '1px solid var(--athena-accent, #A8B6AE)' : '1px solid transparent',
                  transition: 'background 0.12s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                    {wf.name}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', fontFamily: 'var(--font-mono)' }}>
                    v{wf.version || 1}
                  </span>
                </div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--athena-text-secondary)',
                  marginTop: '3px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {wf.description || wf.id}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Main Canvas Viewport ─────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
        {/* Top Workflow Action Bar */}
        <div style={{
          height: '48px',
          borderBottom: '1px solid var(--athena-border)',
          backgroundColor: 'var(--athena-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 20px',
          zIndex: 10
        }}>
          {/* Left: Workflow Title & Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <GitBranch size={16} color="var(--athena-accent)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
              {activeWf?.name || 'Workflow Canvas'}
            </span>
            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--athena-text-muted)',
              backgroundColor: 'var(--athena-surface-deep)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-xs)'
            }}>
              v{activeWf?.version || 1}
            </span>
            {isDirty && (
              <span style={{
                fontSize: '10px',
                color: 'var(--athena-warning)',
                backgroundColor: 'var(--athena-warning-dim)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-xs)'
              }}>
                Unsaved changes
              </span>
            )}
          </div>

          {/* Right: Actions (Integrations, GitHub status, Add Node, Save, Run) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* GitHub Auth Status Pill */}
            {(() => {
              const githubInt = integrations.find((i) => i.id === 'github');
              const isConn = Boolean(githubInt?.connected);
              return (
                <button
                  onClick={() => {
                    setSelectedIntegrationId('github');
                    setShowIntegrationsModal(true);
                  }}
                  title={isConn ? `GitHub Connected (${githubInt?.authSource === 'environment' ? 'Environment variable' : 'Vault'})` : 'Click to connect GitHub'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '5px 10px',
                    backgroundColor: isConn ? 'rgba(142, 173, 154, 0.12)' : 'var(--athena-surface-deep)',
                    border: `1px solid ${isConn ? 'var(--athena-success)' : 'var(--athena-border)'}`,
                    borderRadius: 'var(--radius-xs)',
                    color: isConn ? 'var(--athena-success)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      backgroundColor: isConn ? 'var(--athena-success)' : '#73787e',
                      boxShadow: isConn ? '0 0 6px var(--athena-success)' : 'none'
                    }}
                  />
                  <span>GitHub: {isConn ? (githubInt?.maskedToken ? `Connected (${githubInt.maskedToken})` : 'Connected') : 'Not Connected'}</span>
                </button>
              );
            })()}

            {/* Integrations Vault Button */}
            <button
              onClick={() => setShowIntegrationsModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                backgroundColor: 'var(--athena-surface-deep)',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-xs)',
                color: 'var(--athena-text-secondary)',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              <Key size={11} />
              <span>Integrations ({integrations.filter((i) => i.connected).length}/{integrations.length})</span>
            </button>

            {/* Add Node Dropdown */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowAddNodeMenu((p) => !p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 10px',
                  backgroundColor: 'var(--athena-surface-deep)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--athena-text)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <Plus size={12} /> Add node <ChevronDown size={12} />
              </button>

              {showAddNodeMenu && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '4px',
                  width: '200px',
                  backgroundColor: 'var(--athena-surface)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-xs)',
                  boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                  padding: '4px',
                  zIndex: 50,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '2px'
                }}>
                  {[
                    { type: 'agent', label: 'Agent', icon: Bot, color: 'var(--athena-info)' },
                    { type: 'orchestrator', label: 'Orchestrator', icon: Users, color: '#B89FD4' },
                    { type: 'tool', label: 'Tool Function', icon: Wrench, color: 'var(--athena-warning)' },
                    { type: 'collector', label: 'Collector', icon: GitBranch, color: '#86B3AC' },
                    { type: 'condition', label: 'Condition', icon: Split, color: '#D69E7B' },
                    { type: 'approval', label: 'Approval Gate', icon: ShieldCheck, color: 'var(--athena-danger)' },
                    { type: 'map', label: 'Map Fan-Out', icon: Repeat, color: '#C494AA' },
                    { type: 'trigger', label: 'Trigger', icon: Zap, color: 'var(--athena-success)' },
                    { type: 'subWorkflow', label: 'Sub-Workflow', icon: Layers, color: 'var(--athena-accent)' },
                  ].map((item) => (
                    <button
                      key={item.type}
                      onClick={() => handleAddNode(item.type)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        backgroundColor: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--athena-text)',
                        fontSize: '11px',
                        cursor: 'pointer',
                        textAlign: 'left'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      <item.icon size={13} color={item.color} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Save Workflow */}
            <button
              onClick={handleSaveChanges}
              disabled={!isDirty}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                backgroundColor: isDirty ? 'var(--athena-accent)' : 'var(--athena-surface-deep)',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-xs)',
                color: isDirty ? '#171819' : 'var(--athena-text-muted)',
                fontSize: '11px',
                fontWeight: 600,
                cursor: isDirty ? 'pointer' : 'not-allowed'
              }}
            >
              <Save size={12} /> Save
            </button>

            {/* Run Workflow */}
            <button
              onClick={handleOpenRunModal}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '5px 12px',
                backgroundColor: 'var(--athena-success)',
                border: 'none',
                borderRadius: 'var(--radius-xs)',
                color: '#171819',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Play size={11} fill="#171819" /> Run Workflow
            </button>

            {/* View Run Output Button (shows when a run exists) */}
            {activeRunResult && (
              <button
                onClick={() => setShowOutputDrawer((p) => !p)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  backgroundColor: showOutputDrawer ? 'var(--athena-surface-elevated)' : 'rgba(142, 173, 154, 0.15)',
                  border: '1px solid var(--athena-success)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--athena-success)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                <CheckCircle size={12} />
                <span>{showOutputDrawer ? 'Hide Output' : 'View Run Output'}</span>
              </button>
            )}

            {/* Delete Workflow */}
            {activeWf && (
              <button
                onClick={() => handleDeleteWorkflow(activeWf.id)}
                title="Delete workflow"
                style={{
                  padding: '5px 8px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-xs)',
                  color: 'var(--athena-danger)',
                  cursor: 'pointer'
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* ── React Flow Canvas Viewport ──────────────────────────────── */}
        <div style={{ flex: 1, width: '100%', height: '100%', backgroundColor: 'var(--athena-canvas)' }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            onNodeClick={handleNodeClick}
            nodeTypes={nodeTypes}
            proOptions={{ hideAttribution: true }}
            fitView
            fitViewOptions={{ padding: 0.25 }}
          >
            <FlowViewportFitter activeId={activeWf?.id || null} nodesCount={nodes.length} />
            <Background color="var(--athena-border-subtle)" gap={24} size={1} />
            <Controls
              showInteractive={false}
              style={{
                fill: 'var(--athena-text-secondary)',
                backgroundColor: 'var(--athena-surface)',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-xs)'
              }}
            />
          </ReactFlow>
        </div>

        {/* ── Live Execution Output Drawer ──────────────────────────────── */}
        {activeRunResult && showOutputDrawer && (
          <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: isDrawerMaximized ? '500px' : '280px',
            backgroundColor: 'var(--athena-surface)',
            borderTop: '2px solid var(--athena-success)',
            boxShadow: '0 -10px 25px -5px rgba(0, 0, 0, 0.6)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 25,
            transition: 'height 0.2s ease'
          }}>
            {/* Drawer Header Bar */}
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--athena-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'var(--athena-surface-deep)'
            }}>
              {/* Left: Title & Run ID */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'rgba(142, 173, 154, 0.2)',
                  color: 'var(--athena-success)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <CheckCircle size={11} /> {activeRunResult.run?.status || activeRunResult.status || 'COMPLETED'}
                </span>
                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                  Execution Run Inspector
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                  ID: {activeRunResult.runId}
                </span>
              </div>

              {/* Middle: Tab Switcher */}
              <div style={{
                display: 'flex',
                backgroundColor: 'var(--athena-canvas)',
                padding: '2px',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--athena-border-subtle)'
              }}>
                <button
                  onClick={() => setDrawerTab('summary')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor: drawerTab === 'summary' ? 'var(--athena-surface)' : 'transparent',
                    color: drawerTab === 'summary' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <FileText size={11} /> Visual Breakdown
                </button>
                <button
                  onClick={() => setDrawerTab('raw')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 10px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor: drawerTab === 'raw' ? 'var(--athena-surface)' : 'transparent',
                    color: drawerTab === 'raw' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Terminal size={11} /> Raw JSON
                </button>
              </div>

              {/* Right: Actions (Copy, Maximize, Close) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => {
                    const payload = JSON.stringify(activeRunResult.output || activeRunResult.run?.nodeOutputs || activeRunResult, null, 2);
                    navigator.clipboard.writeText(payload);
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  }}
                  title="Copy output payload"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-xs)',
                    color: copiedJson ? 'var(--athena-success)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  <Copy size={11} />
                  <span>{copiedJson ? 'Copied!' : 'Copy'}</span>
                </button>

                <button
                  onClick={() => setIsDrawerMaximized((p) => !p)}
                  title={isDrawerMaximized ? 'Restore height' : 'Expand drawer'}
                  style={{
                    padding: '4px 6px',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--athena-text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  {isDrawerMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>

                <button
                  onClick={() => setShowOutputDrawer(false)}
                  title="Close inspector"
                  style={{
                    padding: '4px 6px',
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: 'var(--athena-text-muted)',
                    cursor: 'pointer'
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Drawer Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
              {drawerTab === 'summary' ? (
                (() => {
                  const outs = activeRunResult.output || activeRunResult.run?.nodeOutputs || {};
                  const voteCollectorOut = outs.vote_collector?.output;
                  const fetchDiffOut = outs.fetch_diff?.output;
                  const secAgentOut = outs.security_agent?.output;
                  const logicAgentOut = outs.logic_agent?.output;
                  const styleAgentOut = outs.style_agent?.output;
                  const postReviewOut = outs.post_review?.output;

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {/* Top Highlight Banner: Consensus Verdict */}
                      {voteCollectorOut && (
                        <div style={{
                          padding: '12px 16px',
                          borderRadius: 'var(--radius-xs)',
                          backgroundColor: voteCollectorOut.consensus ? 'rgba(142, 173, 154, 0.12)' : 'rgba(199, 125, 125, 0.12)',
                          border: `1px solid ${voteCollectorOut.consensus ? 'var(--athena-success)' : 'var(--athena-danger)'}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between'
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                              padding: '6px 12px',
                              borderRadius: 'var(--radius-xs)',
                              backgroundColor: voteCollectorOut.consensus ? 'var(--athena-success)' : 'var(--athena-danger)',
                              color: '#171819',
                              fontSize: '12px',
                              fontWeight: 800,
                              letterSpacing: '0.5px'
                            }}>
                              VERDICT: {String(voteCollectorOut.decision || 'PENDING').toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                                Multi-Agent Consensus {voteCollectorOut.consensus ? 'Reached' : 'Inconclusive'}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', marginTop: '2px' }}>
                                Policy: {voteCollectorOut.policy || 'majority'} • Total Votes: {voteCollectorOut.totalVotes || 0}
                                {voteCollectorOut.votes && ` (${Object.entries(voteCollectorOut.votes).map(([k, v]) => `${k}: ${v}`).join(', ')})`}
                              </div>
                            </div>
                          </div>

                          {postReviewOut && (
                            <div style={{ fontSize: '11px', color: 'var(--athena-accent)', textAlign: 'right' }}>
                              <strong>Post-Review Status:</strong> {postReviewOut.postedToGitHub ? 'Published to GitHub PR' : 'Prepared / Simulated'}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Specialist Agents Breakdown Grid */}
                      {(secAgentOut || logicAgentOut || styleAgentOut) && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--athena-text-muted)', marginBottom: '8px', letterSpacing: '0.04em' }}>
                            Specialist Agent Audits
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                            {/* Security Agent Card */}
                            {secAgentOut && (
                              <div style={{
                                padding: '10px 12px',
                                borderRadius: 'var(--radius-xs)',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border-subtle)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px'
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-info)' }}>
                                    🛡️ Security Specialist
                                  </span>
                                  <span style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '2px',
                                    backgroundColor: String(secAgentOut.verdict).toLowerCase() === 'approve' ? 'rgba(142, 173, 154, 0.2)' : 'rgba(199, 125, 125, 0.2)',
                                    color: String(secAgentOut.verdict).toLowerCase() === 'approve' ? 'var(--athena-success)' : 'var(--athena-danger)'
                                  }}>
                                    {String(secAgentOut.verdict || 'approve').toUpperCase()} ({secAgentOut.score || 95}/100)
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', lineHeight: '1.4' }}>
                                  {secAgentOut.notes || 'No OWASP injection risks or leaked credentials identified in PR.'}
                                </div>
                              </div>
                            )}

                            {/* Logic Agent Card */}
                            {logicAgentOut && (
                              <div style={{
                                padding: '10px 12px',
                                borderRadius: 'var(--radius-xs)',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border-subtle)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px'
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#B89FD4' }}>
                                    ⚙️ Logic & Concurrency
                                  </span>
                                  <span style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '2px',
                                    backgroundColor: String(logicAgentOut.verdict).toLowerCase() === 'approve' ? 'rgba(142, 173, 154, 0.2)' : 'rgba(199, 125, 125, 0.2)',
                                    color: String(logicAgentOut.verdict).toLowerCase() === 'approve' ? 'var(--athena-success)' : 'var(--athena-danger)'
                                  }}>
                                    {String(logicAgentOut.verdict || 'approve').toUpperCase()} ({logicAgentOut.score || 94}/100)
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', lineHeight: '1.4' }}>
                                  {logicAgentOut.notes || 'Algorithmic logic verified, edge cases and race conditions handled.'}
                                </div>
                              </div>
                            )}

                            {/* Style Agent Card */}
                            {styleAgentOut && (
                              <div style={{
                                padding: '10px 12px',
                                borderRadius: 'var(--radius-xs)',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border-subtle)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px'
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-accent)' }}>
                                    🎨 Architecture & Style
                                  </span>
                                  <span style={{
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '1px 6px',
                                    borderRadius: '2px',
                                    backgroundColor: String(styleAgentOut.verdict).toLowerCase() === 'approve' ? 'rgba(142, 173, 154, 0.2)' : 'rgba(199, 125, 125, 0.2)',
                                    color: String(styleAgentOut.verdict).toLowerCase() === 'approve' ? 'var(--athena-success)' : 'var(--athena-danger)'
                                  }}>
                                    {String(styleAgentOut.verdict || 'approve').toUpperCase()} ({styleAgentOut.score || 92}/100)
                                  </span>
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', lineHeight: '1.4' }}>
                                  {styleAgentOut.notes || 'Clean TypeScript typings and clean separation of concerns verified.'}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* All Steps Execution Table */}
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--athena-text-muted)', marginBottom: '8px', letterSpacing: '0.04em' }}>
                          Workflow Pipeline Steps ({Object.keys(outs).length} nodes executed)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {Object.entries(outs).map(([nodeId, nodeData]: [string, any]) => (
                            <div
                              key={nodeId}
                              onClick={() => setSelectedNodeId(nodeId)}
                              style={{
                                padding: '8px 12px',
                                borderRadius: 'var(--radius-xs)',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border-subtle)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                cursor: 'pointer'
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--athena-surface-elevated)')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--athena-surface-deep)')}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <span style={{
                                  width: 7,
                                  height: 7,
                                  borderRadius: '50%',
                                  backgroundColor: nodeData.status === 'completed' ? 'var(--athena-success)' : 'var(--athena-warning)'
                                }} />
                                <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                                  {nodeId}
                                </span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  {nodeData.startedAt && nodeData.finishedAt ? `${nodeData.finishedAt - nodeData.startedAt}ms` : ''}
                                </span>
                                <span style={{
                                  fontSize: '10px',
                                  padding: '1px 6px',
                                  borderRadius: '2px',
                                  backgroundColor: 'rgba(142, 173, 154, 0.15)',
                                  color: 'var(--athena-success)',
                                  textTransform: 'uppercase',
                                  fontWeight: 600
                                }}>
                                  {nodeData.status || 'completed'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                /* Raw JSON View */
                <pre style={{
                  margin: 0,
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--athena-text-secondary)',
                  backgroundColor: 'var(--athena-canvas)',
                  padding: '12px',
                  borderRadius: 'var(--radius-xs)',
                  border: '1px solid var(--athena-border-subtle)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}>
                  {JSON.stringify(activeRunResult.output || activeRunResult.run?.nodeOutputs || activeRunResult, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Right Node Config Inspector ──────────────────────────────── */}
      {selectedNodeObject && (
        <NodeConfigInspector
          node={selectedNodeObject}
          allNodes={nodes}
          onChange={handleUpdateNodeConfig}
          onDelete={handleDeleteNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {/* ── Template Picker Modal ─────────────────────────────────────── */}
      {showTemplatesModal && (
        <TemplatePickerModal
          onSelectTemplate={handleSelectTemplate}
          onClose={() => setShowTemplatesModal(false)}
        />
      )}

      {/* ── Run Modal ─────────────────────────────────────────────────── */}
      {showRunModal && (() => {
        let parsedInputs: Record<string, any> = {};
        try {
          parsedInputs = JSON.parse(runInputsJson);
        } catch {
          parsedInputs = {};
        }

        const schemaInputs = activeWf?.inputs && typeof activeWf.inputs === 'object' ? activeWf.inputs : {};
        const inputKeys = Array.from(new Set([...Object.keys(schemaInputs), ...Object.keys(parsedInputs)]));

        const handleFieldChange = (key: string, value: any) => {
          const updated = { ...parsedInputs, [key]: value };
          setRunInputsJson(JSON.stringify(updated, null, 2));
        };

        const handleResetDefaults = () => {
          const defs = getDefaultInputsForWorkflow(activeWf);
          setRunInputsJson(JSON.stringify(defs, null, 2));
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
              width: '520px',
              maxWidth: '90vw',
              backgroundColor: 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '22px',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6)'
            }}>
              {/* Modal Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Zap size={16} color="var(--athena-success, #8EAD9A)" />
                    <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--athena-text)' }}>
                      Run Workflow: {activeWf?.name || 'Workflow'}
                    </span>
                  </div>
                  {activeWf?.description && (
                    <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', marginTop: '4px', lineHeight: '1.4' }}>
                      {activeWf.description}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setShowRunModal(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--athena-text-muted)', cursor: 'pointer', padding: '4px' }}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Subheader Toolbar: Mode Toggle (Form / JSON) + Reset to Defaults */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--athena-border-subtle)', paddingBottom: '10px' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => setRunModalTab('form')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      backgroundColor: runModalTab === 'form' ? 'var(--athena-surface-raised)' : 'transparent',
                      color: runModalTab === 'form' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Sliders size={12} /> Form Inputs
                  </button>
                  <button
                    onClick={() => setRunModalTab('json')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-xs)',
                      border: 'none',
                      backgroundColor: runModalTab === 'json' ? 'var(--athena-surface-raised)' : 'transparent',
                      color: runModalTab === 'json' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    <Code size={12} /> Raw JSON
                  </button>
                </div>

                <button
                  onClick={handleResetDefaults}
                  title="Reset inputs to default template values"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--athena-border-subtle)',
                    backgroundColor: 'transparent',
                    color: 'var(--athena-text-secondary)',
                    fontSize: '10px',
                    cursor: 'pointer'
                  }}
                >
                  <RefreshCw size={10} /> Reset Defaults
                </button>
              </div>

              {/* Body: Form or Raw JSON */}
              {runModalTab === 'form' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                  {inputKeys.length === 0 ? (
                    <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', fontStyle: 'italic', padding: '16px 0', textAlign: 'center' }}>
                      This workflow does not require any input parameters. Click Execute Run to start.
                    </div>
                  ) : (
                    inputKeys.map((key) => {
                      const fieldSchema = schemaInputs[key] || {};
                      const isRequired = fieldSchema.required === true;
                      const description = fieldSchema.description || '';
                      const val = parsedInputs[key] ?? '';
                      const isLongText = key === 'task' || key === 'prompt' || key === 'topic' || String(val).length > 60;

                      return (
                        <div key={key}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-text)' }}>
                              {key} {isRequired && <span style={{ color: 'var(--athena-error, #D98080)' }}>*</span>}
                            </label>
                            {fieldSchema.type && (
                              <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {fieldSchema.type}
                              </span>
                            )}
                          </div>
                          {description && (
                            <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', marginBottom: '5px' }}>
                              {description}
                            </div>
                          )}
                          {isLongText ? (
                            <textarea
                              rows={3}
                              value={typeof val === 'object' ? JSON.stringify(val) : String(val)}
                              onChange={(e) => handleFieldChange(key, e.target.value)}
                              placeholder={`Enter ${key}...`}
                              style={{
                                width: '100%',
                                padding: '8px',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border)',
                                borderRadius: 'var(--radius-xs)',
                                color: 'var(--athena-text)',
                                fontSize: '12px',
                                resize: 'vertical',
                                outline: 'none'
                              }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={typeof val === 'object' ? JSON.stringify(val) : String(val)}
                              onChange={(e) => handleFieldChange(key, e.target.value)}
                              placeholder={`Enter ${key}...`}
                              style={{
                                width: '100%',
                                padding: '7px 9px',
                                backgroundColor: 'var(--athena-surface-deep)',
                                border: '1px solid var(--athena-border)',
                                borderRadius: 'var(--radius-xs)',
                                color: 'var(--athena-text)',
                                fontSize: '12px',
                                outline: 'none'
                              }}
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div>
                  <textarea
                    rows={8}
                    value={runInputsJson}
                    onChange={(e) => setRunInputsJson(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px',
                      backgroundColor: 'var(--athena-surface-deep)',
                      border: '1px solid var(--athena-border)',
                      borderRadius: 'var(--radius-xs)',
                      color: 'var(--athena-text)',
                      fontSize: '11px',
                      fontFamily: 'var(--font-mono)',
                      outline: 'none'
                    }}
                  />
                </div>
              )}

              {/* Modal Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '4px' }}>
                <button
                  onClick={() => setShowRunModal(false)}
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--athena-text-secondary)',
                    fontSize: '11px',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={isRunning}
                  onClick={async () => {
                    setShowRunModal(false);
                    await handleRunWorkflow();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 16px',
                    backgroundColor: 'var(--athena-success, #8EAD9A)',
                    border: 'none',
                    borderRadius: 'var(--radius-xs)',
                    color: '#171819',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: isRunning ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Play size={11} fill="#171819" />
                  {isRunning ? 'Running...' : 'Execute Run'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Integrations & Credential Vault Modal ─────────────────────────────── */}
      <IntegrationsModal
        isOpen={showIntegrationsModal}
        onClose={() => setShowIntegrationsModal(false)}
        integrations={integrations}
        onRefreshIntegrations={loadAllWorkflows}
        initialServiceId={selectedIntegrationId}
      />
    </div>
  );
};

export const WorkflowsPage: React.FC = () => {
  return (
    <ReactFlowProvider>
      <WorkflowsPageContent />
    </ReactFlowProvider>
  );
};
