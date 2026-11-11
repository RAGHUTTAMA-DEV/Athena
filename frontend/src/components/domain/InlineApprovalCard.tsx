import React, { useState } from 'react';
import { ShieldAlert, Check, X, Loader2 } from 'lucide-react';
import { ApprovalRecord } from '../../types/api';

interface InlineApprovalCardProps {
  approval: ApprovalRecord;
  onDecide: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
}

export const InlineApprovalCard: React.FC<InlineApprovalCardProps> = ({
  approval,
  onDecide,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = approval.id || approval.approvalId || '';
  const isPending = approval.status === 'pending';

  const handleAction = async (decision: 'approved' | 'rejected') => {
    if (!id || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onDecide(id, decision);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit decision');
    } finally {
      setIsSubmitting(false);
    }
  };

  const paramsPayload = approval.proposedAction ?? approval.params;

  return (
    <div
      style={{
        marginTop: '12px',
        padding: '14px 16px',
        backgroundColor: 'var(--athena-surface-raised)',
        border: `1px solid ${
          isPending
            ? 'var(--athena-warning)'
            : approval.status === 'approved'
            ? 'var(--athena-success)'
            : 'var(--athena-danger)'
        }`,
        borderRadius: 'var(--radius-sm)',
        maxWidth: '720px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ShieldAlert
            size={16}
            color={
              isPending
                ? 'var(--athena-warning)'
                : approval.status === 'approved'
                ? 'var(--athena-success)'
                : 'var(--athena-danger)'
            }
          />
          <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--athena-text)' }}>
            {isPending
              ? 'Permission Required'
              : approval.status === 'approved'
              ? 'Permission Approved'
              : 'Permission Rejected'}
          </span>
          <span
            style={{
              fontSize: '9px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: 'var(--radius-xs)',
              backgroundColor: 'var(--athena-warning-dim)',
              color: 'var(--athena-warning)',
              textTransform: 'uppercase',
            }}
          >
            {approval.riskLevel || 'MEDIUM'} RISK
          </span>
        </div>

        <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
          {approval.action}
        </span>
      </div>

      {approval.explanation && (
        <div style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '10px' }}>
          {approval.explanation}
        </div>
      )}

      {paramsPayload && Object.keys(paramsPayload).length > 0 && (
        <pre
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--athena-accent)',
            backgroundColor: 'var(--athena-surface-deep)',
            padding: '8px 10px',
            borderRadius: 'var(--radius-xs)',
            border: '1px solid var(--athena-border-subtle)',
            marginBottom: '12px',
            overflowX: 'auto',
            maxHeight: '160px',
          }}
        >
          {typeof paramsPayload === 'string' ? paramsPayload : JSON.stringify(paramsPayload, null, 2)}
        </pre>
      )}

      {error && (
        <div style={{ fontSize: '11px', color: 'var(--athena-danger)', marginBottom: '8px' }}>
          {error}
        </div>
      )}

      {isPending && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => handleAction('approved')}
            disabled={isSubmitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              backgroundColor: 'var(--athena-accent)',
              color: '#171819',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isSubmitting ? 'wait' : 'pointer',
            }}
          >
            {isSubmitting ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
            <span>Approve & Continue</span>
          </button>

          <button
            onClick={() => handleAction('rejected')}
            disabled={isSubmitting}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 14px',
              backgroundColor: 'var(--athena-danger-dim)',
              border: '1px solid var(--athena-danger)',
              color: 'var(--athena-danger)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isSubmitting ? 'wait' : 'pointer',
            }}
          >
            <X size={14} />
            <span>Reject</span>
          </button>
        </div>
      )}
    </div>
  );
};

