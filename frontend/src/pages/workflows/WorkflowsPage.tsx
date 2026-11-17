import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  Code,
  History,
  Clock
} from 'lucide-react';

import { MarkdownRenderer } from '../../components/primitives/MarkdownRenderer';

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
  const [searchParams] = useSearchParams();
  const urlWfId = searchParams.get('id');

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
  const [availableTools, setAvailableTools] = useState<any[]>([]);

  // Run execution state
  const [runInputsJson, setRunInputsJson] = useState('{}');
  const [isRunning, setIsRunning] = useState(false);
  const [activeRunResult, setActiveRunResult] = useState<any | null>(null);
  const [workflowRuns, setWorkflowRuns] = useState<any[]>([]);
  const [showRunsDropdown, setShowRunsDropdown] = useState(false);
  const [inspectingNodeId, setInspectingNodeId] = useState<string | null>(null);
  const [showOutputDrawer, setShowOutputDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'deliverable' | 'nodes' | 'raw'>('deliverable');
  const [isDrawerMaximized, setIsDrawerMaximized] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const nodeTypes = useMemo(() => ({ workflowNode: WorkflowNodeComponent }), []);

  const loadAllWorkflows = async () => {
    try {
      const [wfs, ints, tls] = await Promise.allSettled([
        apiClient.listWorkflows(),
        apiClient.listIntegrations(),
        apiClient.listTools()
      ]);

      if (tls.status === 'fulfilled' && tls.value?.tools) {
        setAvailableTools(tls.value.tools);
      }

      if (wfs.status === 'fulfilled') {
        const list = wfs.value;
        setWorkflows(list);

        if (list.length > 0 && !activeWf) {
          const target = (urlWfId && list.find((w: any) => w.id === urlWfId)) || list[0];
          const first = await apiClient.getWorkflow(target.id).catch(() => target);
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

  useEffect(() => {
    if (urlWfId && workflows.length > 0) {
      const match = workflows.find((w: any) => w.id === urlWfId);
      if (match && (!activeWf || activeWf.id !== match.id)) {
        apiClient.getWorkflow(match.id).then(loadWorkflowIntoCanvas).catch(() => loadWorkflowIntoCanvas(match));
      }
    }
  }, [urlWfId, workflows]);

  // Converts a workflow DAG into arranged React Flow nodes & edges
  const loadWorkflowIntoCanvas = (wf: any) => {
    if (!wf) return;
    setActiveWf(wf);
    setSelectedNodeId(null);
    setInspectingNodeId(null);
    setIsDirty(false);

    // Fetch historical runs for this workflow to restore output viewer & telemetry
    apiClient.listWorkflowRuns(wf.id).then(async (res) => {
      const runsList = res?.runs || [];
      setWorkflowRuns(runsList);
      if (runsList.length > 0) {
        try {
          const latestRun = await apiClient.getWorkflowRun(runsList[0].runId);
          if (latestRun?.run) {
            setActiveRunResult(latestRun);
            const nodeOuts = latestRun.nodeOutputs || latestRun.run?.nodeOutputs || {};
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
          }
        } catch {}
      } else {
        setActiveRunResult(null);
      }
    }).catch(() => {
      setWorkflowRuns([]);
      setActiveRunResult(null);
    });

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
      setDrawerTab('deliverable');

      // Refresh runs list
      apiClient.listWorkflowRuns(activeWf.id).then((r) => setWorkflowRuns(r?.runs || [])).catch(() => {});

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

            {/* Run History Selector Dropdown */}
            {workflowRuns.length > 0 && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShowRunsDropdown((p) => !p)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '5px 10px',
                    backgroundColor: 'var(--athena-surface-deep)',
                    border: '1px solid var(--athena-border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    color: 'var(--athena-text)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <History size={12} color="var(--athena-accent)" />
                  <span>Runs ({workflowRuns.length})</span>
                  <ChevronDown size={11} />
                </button>

                {showRunsDropdown && (
                  <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    marginTop: '4px',
                    width: '270px',
                    maxHeight: '280px',
                    overflowY: 'auto',
                    backgroundColor: 'var(--athena-surface-elevated, #232528)',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-sm)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    zIndex: 60,
                    padding: '4px'
                  }}>
                    <div style={{
                      padding: '4px 8px',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      color: 'var(--athena-text-muted)',
                      borderBottom: '1px solid var(--athena-border-subtle)',
                      marginBottom: '4px'
                    }}>
                      Historical Runs
                    </div>
                    {workflowRuns.map((r: any, idx: number) => {
                      const isCurrent = (activeRunResult?.runId || activeRunResult?.run?.runId) === r.runId;
                      const dateStr = r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : `#${idx + 1}`;
                      return (
                        <div
                          key={r.runId}
                          onClick={async () => {
                            setShowRunsDropdown(false);
                            try {
                              const details = await apiClient.getWorkflowRun(r.runId);
                              setActiveRunResult(details);
                              setShowOutputDrawer(true);
                              const nodeOuts = details.nodeOutputs || details.run?.nodeOutputs || {};
                              setNodes((nds) =>
                                nds.map((n) => ({
                                  ...n,
                                  data: {
                                    ...n.data,
                                    status: nodeOuts[n.id]?.status || 'completed',
                                    output: nodeOuts[n.id]?.output
                                  }
                                }))
                              );
                            } catch (e: any) {
                              alert(`Failed to load run: ${e.message}`);
                            }
                          }}
                          style={{
                            padding: '6px 8px',
                            borderRadius: 'var(--radius-xs)',
                            backgroundColor: isCurrent ? 'var(--athena-surface-deep)' : 'transparent',
                            border: isCurrent ? '1px solid var(--athena-accent)' : '1px solid transparent',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '2px',
                            fontSize: '11px'
                          }}
                          onMouseEnter={(e) => !isCurrent && (e.currentTarget.style.backgroundColor = 'var(--athena-surface)')}
                          onMouseLeave={(e) => !isCurrent && (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{
                              width: 6,
                              height: 6,
                              borderRadius: '50%',
                              backgroundColor: r.status === 'completed' ? 'var(--athena-success)' : r.status === 'running' ? 'var(--athena-info)' : 'var(--athena-danger)'
                            }} />
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)', fontSize: '10px' }}>
                              {r.runId.substring(0, 16)}...
                            </span>
                          </div>
                          <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                            {dateStr}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* View Run Output Button (shows when a run exists) */}
            {activeRunResult && (
              <button
                type="button"
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
            height: isDrawerMaximized ? 'calc(100vh - 120px)' : '380px',
            backgroundColor: 'var(--athena-surface)',
            borderTop: '2px solid var(--athena-success)',
            boxShadow: '0 -10px 30px rgba(0, 0, 0, 0.75)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 30,
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
                  Execution Output Viewer
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                  Run: {activeRunResult.runId || activeRunResult.run?.runId}
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
                  type="button"
                  onClick={() => setDrawerTab('deliverable')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor: drawerTab === 'deliverable' ? 'var(--athena-surface)' : 'transparent',
                    color: drawerTab === 'deliverable' ? 'var(--athena-accent)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <FileText size={12} /> Executive Deliverable
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('nodes')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor: drawerTab === 'nodes' ? 'var(--athena-surface)' : 'transparent',
                    color: drawerTab === 'nodes' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Layers size={12} /> Node Steps & Telemetry
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('raw')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 12px',
                    borderRadius: 'var(--radius-xs)',
                    border: 'none',
                    backgroundColor: drawerTab === 'raw' ? 'var(--athena-surface)' : 'transparent',
                    color: drawerTab === 'raw' ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <Terminal size={12} /> Raw JSON
                </button>
              </div>

              {/* Right: Actions (Copy, Maximize, Close) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  type="button"
                  onClick={() => {
                    const outs = activeRunResult.nodeOutputs || activeRunResult.output || activeRunResult.run?.nodeOutputs || {};
                    const payload = JSON.stringify(outs, null, 2);
                    navigator.clipboard.writeText(payload);
                    setCopiedJson(true);
                    setTimeout(() => setCopiedJson(false), 2000);
                  }}
                  title="Copy full output payload"
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
                  <span>{copiedJson ? 'Copied!' : 'Copy JSON'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsDrawerMaximized((p) => !p)}
                  title={isDrawerMaximized ? 'Restore height' : 'Expand full height'}
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
                  type="button"
                  onClick={() => setShowOutputDrawer(false)}
                  title="Close viewer"
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
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
              {(() => {
                const outs: Record<string, any> = activeRunResult.nodeOutputs || activeRunResult.output || activeRunResult.run?.nodeOutputs || {};
                const nodeEntries = Object.entries(outs);

                // Helper to resolve the primary deliverable markdown or text
                const resolveDeliverable = (): { nodeId: string; title: string; content: string } => {
                  if (inspectingNodeId && outs[inspectingNodeId]) {
                    const nData = outs[inspectingNodeId];
                    const raw = nData.output !== undefined ? nData.output : nData;
                    const text = typeof raw === 'string' ? raw : (raw?.content || raw?.text || raw?.report || raw?.markdown || raw?.briefing || JSON.stringify(raw, null, 2));
                    return { nodeId: inspectingNodeId, title: inspectingNodeId, content: text };
                  }

                  // Priority search for deliverable / synthesis nodes
                  const preferredKeywords = ['synthesizer', 'writer', 'briefing', 'report', 'implementer', 'review', 'pr', 'collector'];
                  for (const kw of preferredKeywords) {
                    const match = nodeEntries.find(([id]) => id.toLowerCase().includes(kw));
                    if (match) {
                      const raw = match[1].output !== undefined ? match[1].output : match[1];
                      const text = typeof raw === 'string' ? raw : (raw?.content || raw?.text || raw?.report || raw?.markdown || raw?.briefing);
                      if (typeof text === 'string' && text.trim().length > 0) {
                        return { nodeId: match[0], title: match[0], content: text };
                      }
                    }
                  }

                  // Fallback: check backwards from last node
                  for (let i = nodeEntries.length - 1; i >= 0; i--) {
                    const [id, data] = nodeEntries[i];
                    const raw = data.output !== undefined ? data.output : data;
                    const text = typeof raw === 'string' ? raw : (raw?.content || raw?.text || raw?.report || raw?.markdown);
                    if (typeof text === 'string' && text.trim().length > 0) {
                      return { nodeId: id, title: id, content: text };
                    }
                  }

                  if (nodeEntries.length > 0) {
                    const last = nodeEntries[nodeEntries.length - 1];
                    const raw = last[1].output !== undefined ? last[1].output : last[1];
                    return { nodeId: last[0], title: last[0], content: typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2) };
                  }

                  return { nodeId: 'none', title: 'No output available', content: 'No execution output recorded for this run.' };
                };

                const deliverable = resolveDeliverable();

                // ── TAB 1: EXECUTIVE DELIVERABLE ─────────────────────────────
                if (drawerTab === 'deliverable') {
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '10px' }}>
                      {/* Sub-header / Node selector pill */}
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        backgroundColor: 'var(--athena-surface-deep)',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--athena-border-subtle)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>Viewing Output From Node:</span>
                          <select
                            value={deliverable.nodeId}
                            onChange={(e) => setInspectingNodeId(e.target.value)}
                            style={{
                              backgroundColor: 'var(--athena-canvas)',
                              color: 'var(--athena-accent)',
                              border: '1px solid var(--athena-border-subtle)',
                              borderRadius: 'var(--radius-xs)',
                              padding: '3px 8px',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            {nodeEntries.map(([nId]) => (
                              <option key={nId} value={nId}>{nId}</option>
                            ))}
                          </select>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {deliverable.content.length} characters
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(deliverable.content);
                              setCopiedJson(true);
                              setTimeout(() => setCopiedJson(false), 1800);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 8px',
                              backgroundColor: 'var(--athena-surface)',
                              border: '1px solid var(--athena-border-subtle)',
                              borderRadius: '2px',
                              color: copiedJson ? 'var(--athena-success)' : 'var(--athena-text)',
                              fontSize: '11px',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            <Copy size={11} />
                            <span>{copiedJson ? 'Copied Deliverable' : 'Copy Deliverable'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Full Formatted Markdown Viewer */}
                      <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: '16px 20px',
                        backgroundColor: 'var(--athena-canvas)',
                        borderRadius: 'var(--radius-xs)',
                        border: '1px solid var(--athena-border-subtle)',
                        fontSize: '13px',
                        color: 'var(--athena-text)',
                        lineHeight: '1.6'
                      }}>
                        <MarkdownRenderer content={deliverable.content} />
                      </div>
                    </div>
                  );
                }

                // ── TAB 2: NODE BREAKDOWN & TELEMETRY ─────────────────────────
                if (drawerTab === 'nodes') {
                  const currentSelectedId = inspectingNodeId || nodeEntries[0]?.[0];
                  const currentNodeData = currentSelectedId ? outs[currentSelectedId] : null;
                  const currentRawOutput = currentNodeData?.output !== undefined ? currentNodeData.output : currentNodeData;
                  const currentText = typeof currentRawOutput === 'string'
                    ? currentRawOutput
                    : (currentRawOutput?.content || currentRawOutput?.text || currentRawOutput?.report || JSON.stringify(currentRawOutput, null, 2));

                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '14px', height: '100%' }}>
                      {/* Left: Nodes Execution List */}
                      <div style={{
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        paddingRight: '6px',
                        borderRight: '1px solid var(--athena-border-subtle)'
                      }}>
                        <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--athena-text-muted)', marginBottom: '4px' }}>
                          Workflow Pipeline Nodes ({nodeEntries.length})
                        </div>
                        {nodeEntries.map(([nId, nData]: [string, any]) => {
                          const isInspecting = currentSelectedId === nId;
                          const elapsed = nData.startedAt && nData.finishedAt ? `${nData.finishedAt - nData.startedAt}ms` : '';
                          return (
                            <div
                              key={nId}
                              onClick={() => setInspectingNodeId(nId)}
                              style={{
                                padding: '8px 10px',
                                borderRadius: 'var(--radius-xs)',
                                backgroundColor: isInspecting ? 'var(--athena-surface-elevated)' : 'var(--athena-surface-deep)',
                                border: isInspecting ? '1px solid var(--athena-accent)' : '1px solid var(--athena-border-subtle)',
                                cursor: 'pointer',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '3px',
                                transition: 'all 0.15s ease'
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{
                                    width: 7,
                                    height: 7,
                                    borderRadius: '50%',
                                    backgroundColor: nData.status === 'completed' ? 'var(--athena-success)' : nData.status === 'running' ? 'var(--athena-info)' : 'var(--athena-warning)'
                                  }} />
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: isInspecting ? 'var(--athena-accent)' : 'var(--athena-text)' }}>
                                    {nId}
                                  </span>
                                </div>
                                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--athena-success)', fontWeight: 700 }}>
                                  {nData.status || 'DONE'}
                                </span>
                              </div>
                              {elapsed && (
                                <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  Duration: {elapsed}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Right: Selected Node Output Details */}
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: '8px',
                          borderBottom: '1px solid var(--athena-border-subtle)',
                          marginBottom: '8px'
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                            Output from: <code style={{ color: 'var(--athena-accent)' }}>{currentSelectedId}</code>
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(currentText);
                              setCopiedJson(true);
                              setTimeout(() => setCopiedJson(false), 1800);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              backgroundColor: 'transparent',
                              border: '1px solid var(--athena-border-subtle)',
                              borderRadius: '2px',
                              color: 'var(--athena-text-muted)',
                              fontSize: '10px',
                              cursor: 'pointer'
                            }}
                          >
                            <Copy size={10} />
                            <span>Copy Node Output</span>
                          </button>
                        </div>

                        <div style={{
                          flex: 1,
                          overflowY: 'auto',
                          padding: '12px 14px',
                          backgroundColor: 'var(--athena-canvas)',
                          borderRadius: 'var(--radius-xs)',
                          border: '1px solid var(--athena-border-subtle)',
                          fontSize: '12px',
                          color: 'var(--athena-text)',
                          lineHeight: '1.5'
                        }}>
                          {typeof currentRawOutput === 'string' ? (
                            <MarkdownRenderer content={currentRawOutput} />
                          ) : (
                            <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11px', whiteSpace: 'pre-wrap', color: 'var(--athena-text-secondary)' }}>
                              {JSON.stringify(currentRawOutput, null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }

                // ── TAB 3: RAW JSON VIEW ──────────────────────────────────────
                return (
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
                    wordBreak: 'break-all',
                    flex: 1,
                    overflowY: 'auto'
                  }}>
                    {JSON.stringify(outs, null, 2)}
                  </pre>
                );
              })()}
            </div>
          </div>
        )}
      </div>

      {/* ── Right Node Config Inspector ──────────────────────────────── */}
      {selectedNodeObject && (
        <NodeConfigInspector
          node={selectedNodeObject}
          allNodes={nodes}
          availableTools={availableTools}
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
