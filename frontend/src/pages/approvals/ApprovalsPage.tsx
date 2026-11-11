import React, { useState, useEffect } from 'react';
import { ShieldAlert, Check, X, RotateCcw, AlertTriangle } from 'lucide-react';
import { ApprovalRecord } from '../../types/api';
import { StatusBadge } from '../../components/primitives/StatusBadge';
import { apiClient } from '../../lib/api/client';

export const ApprovalsPage: React.FC = () => {
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchApprovals = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const list = await apiClient.getPendingApprovals();
      setApprovals(list);
    } catch (err: any) {
      console.error('[Approvals] Failed to fetch approvals:', err);
      setError(err?.message || 'Failed to load approvals');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchApprovals();
  }, []);

  const handleDecision = async (id: string, decision: 'approved' | 'rejected') => {
    try {
      await apiClient.decideApproval(id, decision);
      // Remove or mark decided
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      alert(`Decision submission failed: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1000px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Approval Centre
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Real-time human-in-the-loop authorization requests emitted by Athena policy engine.
          </p>
        </div>

        <button
          onClick={fetchApprovals}
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

      {error && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            backgroundColor: 'var(--athena-danger-dim)',
            border: '1px solid var(--athena-danger)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--athena-danger)',
            fontSize: '12px',
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {approvals.length === 0 ? (
          <div
            style={{
              padding: '40px 20px',
              textAlign: 'center',
              backgroundColor: 'var(--athena-surface)',
              border: '1px dashed var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--athena-text-muted)',
              fontSize: '12px',
            }}
          >
            {isLoading ? 'Checking for pending approvals...' : 'No pending approval requests. Agent is operating within permitted autonomy bounds.'}
          </div>
        ) : (
          approvals.map((appr) => (
            <div
              key={appr.id}
              style={{
                backgroundColor: 'var(--athena-surface)',
                border: '1px solid var(--athena-warning)',
                borderRadius: 'var(--radius-sm)',
                padding: '18px 20px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <ShieldAlert size={16} color="var(--athena-warning)" />
                  <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                    {appr.id} {appr.runId ? `· Run: ${appr.runId}` : ''}
                  </span>
                  <span
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      padding: '1px 5px',
                      backgroundColor: 'rgba(197, 166, 106, 0.15)',
                      border: '1px solid rgba(197, 166, 106, 0.3)',
                      color: 'var(--athena-warning)',
                      borderRadius: 'var(--radius-xs)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {appr.riskLevel || 'HIGH'} RISK
                  </span>
                </div>

                <StatusBadge status={appr.status} size="sm" />
              </div>

              <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '6px' }}>
                {appr.action}
              </h2>

              {appr.explanation && (
                <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '12px' }}>
                  {appr.explanation}
                </p>
              )}

              {appr.proposedAction && (
                <pre
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--athena-accent)',
                    backgroundColor: 'var(--athena-surface-deep)',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-xs)',
                    marginBottom: '14px',
                    overflowX: 'auto',
                  }}
                >
                  {typeof appr.proposedAction === 'string'
                    ? appr.proposedAction
                    : JSON.stringify(appr.proposedAction, null, 2)}
                </pre>
              )}

              <div style={{ display: 'flex', gap: '10px', borderTop: '1px solid var(--athena-border-subtle)', paddingTop: '12px' }}>
                <button
                  onClick={() => handleDecision(appr.id, 'approved')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    backgroundColor: 'var(--athena-accent)',
                    color: '#171819',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Check size={14} />
                  <span>Approve Action</span>
                </button>

                <button
                  onClick={() => handleDecision(appr.id, 'rejected')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 14px',
                    backgroundColor: 'var(--athena-danger-dim)',
                    border: '1px solid var(--athena-danger)',
                    color: 'var(--athena-danger)',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                  <span>Reject</span>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
