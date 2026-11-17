import React, { useState } from 'react';
import { X, Check, GitBranch, Calendar, Sparkles, Terminal } from 'lucide-react';
import { STARTER_TEMPLATES, StarterWorkflowTemplate } from './starterTemplates';

interface TemplatePickerModalProps {
  onSelectTemplate: (template: StarterWorkflowTemplate) => void;
  onClose: () => void;
}

export const TemplatePickerModal: React.FC<TemplatePickerModalProps> = ({
  onSelectTemplate,
  onClose
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(STARTER_TEMPLATES[0].id);

  const getTemplateIcon = (id: string) => {
    if (id.includes('pr')) return <GitBranch size={16} color="var(--athena-info, #91A7B7)" />;
    if (id.includes('research')) return <Sparkles size={16} color="var(--athena-accent, #A8B6AE)" />;
    if (id.includes('briefing') || id.includes('daily')) return <Calendar size={16} color="var(--athena-success, #8EAD9A)" />;
    return <Terminal size={16} color="var(--athena-warning, #C5A66A)" />;
  };

  const handleUseTemplate = () => {
    const tmpl = STARTER_TEMPLATES.find(t => t.id === selectedTemplateId) || STARTER_TEMPLATES[0];
    const hash = Date.now().toString(36).substring(2, 6);
    const cloned: StarterWorkflowTemplate = {
      ...JSON.parse(JSON.stringify(tmpl)),
      id: `${tmpl.id}-${hash}`,
      name: `${tmpl.name} (Custom ${hash})`
    };
    onSelectTemplate(cloned);
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
        width: '640px',
        backgroundColor: 'var(--athena-surface)',
        border: '1px solid var(--athena-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        color: 'var(--athena-text)',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--athena-text)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--athena-accent)" />
              Workflow Starter Templates
            </div>
            <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', marginTop: '2px' }}>
              Select a pre-configured multi-agent DAG to immediately open and edit on the canvas.
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--athena-text-muted)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Template List Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
          {STARTER_TEMPLATES.map(tmpl => {
            const isSelected = selectedTemplateId === tmpl.id;
            return (
              <div
                key={tmpl.id}
                onClick={() => setSelectedTemplateId(tmpl.id)}
                style={{
                  padding: '14px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: isSelected ? 'var(--athena-surface-raised)' : 'var(--athena-surface-deep)',
                  border: isSelected ? '1px solid var(--athena-accent)' : '1px solid var(--athena-border-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  transition: 'border 0.15s ease'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{
                      padding: '5px',
                      borderRadius: 'var(--radius-xs)',
                      backgroundColor: 'var(--athena-surface)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {getTemplateIcon(tmpl.id)}
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                      {tmpl.name}
                    </span>
                  </div>
                  {isSelected && <Check size={14} color="var(--athena-accent)" />}
                </div>

                <div style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', lineHeight: '1.4', minHeight: '44px' }}>
                  {tmpl.description}
                </div>

                <div style={{ display: 'flex', gap: '6px', marginTop: 'auto', paddingTop: '4px' }}>
                  <span style={{
                    fontSize: '10px',
                    backgroundColor: 'var(--athena-accent-dim)',
                    color: 'var(--athena-accent)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-xs)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {tmpl.nodes.length} nodes · {tmpl.edges.length} edges
                  </span>
                  {tmpl.agentProfile?.publishAsAgent && (
                    <span style={{
                      fontSize: '10px',
                      backgroundColor: 'var(--athena-info-dim)',
                      color: 'var(--athena-info)',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-xs)'
                    }}>
                      Agent Tool
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '6px 14px',
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
            onClick={handleUseTemplate}
            style={{
              padding: '6px 16px',
              backgroundColor: 'var(--athena-accent)',
              border: 'none',
              borderRadius: 'var(--radius-xs)',
              color: '#171819',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Use Template
          </button>
        </div>
      </div>
    </div>
  );
};
