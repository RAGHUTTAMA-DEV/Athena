import React from 'react';
import {
  Zap,
  Bot,
  Users,
  Wrench,
  GitBranch,
  Split,
  ShieldCheck,
  Repeat,
  Layers,
  Plus
} from 'lucide-react';

interface NodePaletteProps {
  onAddNode: (type: string) => void;
}

export const NodePalette: React.FC<NodePaletteProps> = ({ onAddNode }) => {
  const paletteItems = [
    { type: 'agent', label: 'Agent', icon: Bot, color: '#38BDF8', desc: 'Autonomous agent step' },
    { type: 'orchestrator', label: 'Orchestrator', icon: Users, color: '#A855F7', desc: 'Master-Worker coordinator' },
    { type: 'tool', label: 'Tool', icon: Wrench, color: '#F59E0B', desc: 'Deterministic tool call' },
    { type: 'collector', label: 'Collector', icon: GitBranch, color: '#14B8A6', desc: 'Fan-in merge & consensus' },
    { type: 'condition', label: 'Condition', icon: Split, color: '#F97316', desc: 'If/else branch logic' },
    { type: 'approval', label: 'Approval', icon: ShieldCheck, color: '#EF4444', desc: 'Human-in-the-loop gate' },
    { type: 'map', label: 'Map Iterator', icon: Repeat, color: '#EC4899', desc: 'Parallel item fan-out' },
    { type: 'trigger', label: 'Trigger', icon: Zap, color: '#10B981', desc: 'Entry point (cron/webhook)' },
    { type: 'subWorkflow', label: 'Sub-Workflow', icon: Layers, color: '#818CF8', desc: 'Nested modular workflow' },
  ];

  return (
    <div style={{
      width: '210px',
      backgroundColor: '#0F172A',
      borderRight: '1px solid #1E293B',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      padding: '12px',
      gap: '8px'
    }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
        Add Node
      </div>

      {paletteItems.map(item => {
        const Icon = item.icon;
        return (
          <button
            key={item.type}
            onClick={() => onAddNode(item.type)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 10px',
              backgroundColor: '#1E293B',
              border: '1px solid #334155',
              borderRadius: '6px',
              color: '#F8FAFC',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
              width: '100%'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = item.color;
              e.currentTarget.style.backgroundColor = '#243248';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#334155';
              e.currentTarget.style.backgroundColor = '#1E293B';
            }}
          >
            <div style={{
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              backgroundColor: `${item.color}20`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <Icon size={14} color={item.color} />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#F8FAFC' }}>
                {item.label}
              </div>
              <div style={{ fontSize: '10px', color: '#64748B', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>
                {item.desc}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};
