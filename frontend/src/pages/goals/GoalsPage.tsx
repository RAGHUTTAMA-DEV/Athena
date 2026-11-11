import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, Plus, Play, ListTree, MessageSquare } from 'lucide-react';
import { GoalRecord } from '../../types/api';
import { StatusBadge } from '../../components/primitives/StatusBadge';
import { apiClient } from '../../lib/api/client';

interface GoalsPageProps {
  onSelectSession?: (sessionId: string) => void;
}

export const GoalsPage: React.FC<GoalsPageProps> = ({ onSelectSession }) => {
  const navigate = useNavigate();
  const [goals, setGoals] = useState<GoalRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPriority, setNewPriority] = useState('normal');
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);

  const fetchGoals = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const list = await apiClient.listGoals();
      setGoals(list);
    } catch (err: any) {
      setError(err?.message || 'Failed to load goals');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGoals();
  }, []);

  const handleCreateGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      await apiClient.createGoal(newTitle.trim(), newDescription.trim() || undefined, newPriority);
      setNewTitle('');
      setNewDescription('');
      setNewPriority('normal');
      setIsCreating(false);
      fetchGoals();
    } catch (err: any) {
      alert(`Failed to create goal: ${err.message}`);
    }
  };

  const handlePlanGoal = async (goalId: string) => {
    setBusyGoalId(goalId);
    try {
      await apiClient.planGoal(goalId);
      await fetchGoals();
    } catch (err: any) {
      alert(`Plan failed: ${err.message}`);
    } finally {
      setBusyGoalId(null);
    }
  };

  const handleExecuteGoal = async (goalId: string) => {
    setBusyGoalId(goalId);
    try {
      const res = await apiClient.executeGoal(goalId);
      await fetchGoals();
      if (res.sessionId && onSelectSession) {
        onSelectSession(res.sessionId);
      }
    } catch (err: any) {
      alert(`Execution failed: ${err.message}`);
    } finally {
      setBusyGoalId(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1000px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Goals & Tasks
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Define a multi-step outcome, let Athena break it into tasks, and execute it autonomously—or reference any goal in chat via <code style={{ color: 'var(--athena-accent)' }}>@goal:&lt;id&gt;</code>.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={fetchGoals}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 10px',
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

          <button
            onClick={() => setIsCreating((prev) => !prev)}
            style={{
              display: 'flex',
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
            <span>{isCreating ? 'Cancel' : 'New Goal'}</span>
          </button>
        </div>
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

      {/* Goal Creation Form */}
      {isCreating && (
        <form
          onSubmit={handleCreateGoal}
          style={{
            marginBottom: '20px',
            padding: '18px',
            backgroundColor: 'var(--athena-surface)',
            border: '1px solid var(--athena-border-focus)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Create a New Goal
          </div>
          <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', marginBottom: '12px' }}>
            Only a <strong>Title</strong> is required. Add a <strong>Description</strong> to give Athena constraints, files, or acceptance criteria.
          </div>

          <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
            Title (what outcome do you want?) *
          </label>
          <input
            type="text"
            required
            placeholder="e.g. Audit package.json dependencies and summarize outdated packages"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              marginBottom: '12px',
              backgroundColor: 'var(--athena-surface-deep)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12px',
            }}
          />

          <label style={{ display: 'block', fontSize: '11px', color: 'var(--athena-text-secondary)', marginBottom: '4px' }}>
            Description & Instructions (optional — you can also include @file:path here)
          </label>
          <textarea
            placeholder="e.g. Check @file:package.json and @file:frontend/package.json, list major version gaps, and do not modify files."
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            rows={3}
            style={{
              width: '100%',
              padding: '8px 10px',
              marginBottom: '12px',
              backgroundColor: 'var(--athena-surface-deep)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '12px',
              resize: 'vertical',
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>Priority:</span>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                style={{
                  padding: '4px 8px',
                  backgroundColor: 'var(--athena-surface-deep)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '11px',
                  color: 'var(--athena-text)',
                }}
              >
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>

            <button
              type="submit"
              style={{
                padding: '7px 16px',
                backgroundColor: 'var(--athena-accent)',
                color: '#171819',
                borderRadius: 'var(--radius-xs)',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Save Goal
            </button>
          </div>
        </form>
      )}

      {/* Goals List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {goals.length === 0 ? (
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
            {isLoading
              ? 'Loading goals from storage...'
              : 'No persistent goals yet. Click "New Goal" above to create one, then click "Plan Tasks" or "Run Goal" to watch Athena decompose and execute it.'}
          </div>
        ) : (
          goals.map((goal) => {
            const isBusy = busyGoalId === goal.id;
            const tasks = goal.tasks || [];
            return (
              <div
                key={goal.id}
                style={{
                  backgroundColor: 'var(--athena-surface)',
                  border: '1px solid var(--athena-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '18px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px', gap: '12px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <code style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-accent)' }}>
                        @goal:{goal.id}
                      </code>
                      {goal.priority && (
                        <span
                          style={{
                            fontSize: '10px',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            padding: '1px 5px',
                            backgroundColor: 'var(--athena-surface-raised)',
                            border: '1px solid var(--athena-border)',
                            borderRadius: 'var(--radius-xs)',
                            color: 'var(--athena-text-secondary)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {goal.priority}
                        </span>
                      )}
                      <StatusBadge status={goal.status} size="sm" />
                    </div>
                    <h2 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--athena-text)', margin: 0 }}>
                      {goal.title}
                    </h2>
                  </div>

                  {/* Goal Actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    {tasks.length === 0 && (
                      <button
                        onClick={() => handlePlanGoal(goal.id)}
                        disabled={isBusy}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '5px 10px',
                          backgroundColor: 'var(--athena-surface-raised)',
                          border: '1px solid var(--athena-border)',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '11px',
                          fontWeight: 600,
                          color: 'var(--athena-text)',
                          cursor: isBusy ? 'wait' : 'pointer',
                        }}
                      >
                        <ListTree size={13} />
                        <span>Plan Tasks</span>
                      </button>
                    )}

                    {goal.status !== 'completed' && (
                      <button
                        onClick={() => handleExecuteGoal(goal.id)}
                        disabled={isBusy}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '5px 12px',
                          backgroundColor: 'var(--athena-accent)',
                          color: '#171819',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '11px',
                          fontWeight: 600,
                          cursor: isBusy ? 'wait' : 'pointer',
                        }}
                      >
                        <Play size={12} />
                        <span>{isBusy ? 'Starting...' : 'Run Goal'}</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        onSelectSession?.(`goal_${goal.id}`);
                        navigate('/');
                      }}
                      title="Open goal session in Workspace"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        backgroundColor: 'var(--athena-surface-raised)',
                        border: '1px solid var(--athena-border)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '11px',
                        color: 'var(--athena-text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      <MessageSquare size={12} />
                      <span>Chat</span>
                    </button>
                  </div>
                </div>

                {goal.description && (
                  <p style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', marginBottom: '12px', lineHeight: 1.5 }}>
                    {goal.description}
                  </p>
                )}

                {goal.progress !== undefined && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', marginBottom: tasks.length > 0 ? '12px' : 0 }}>
                    <div style={{ flex: 1, height: '4px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.round(goal.progress * 100)}%`, height: '100%', backgroundColor: 'var(--athena-success)' }} />
                    </div>
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                      {Math.round(goal.progress * 100)}%
                    </span>
                  </div>
                )}

                {/* Decomposed Tasks */}
                {tasks.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      borderTop: '1px solid var(--athena-border-subtle)',
                      paddingTop: '12px',
                    }}
                  >
                    <div style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>
                      Tasks ({tasks.length})
                    </div>
                    {tasks.map((task) => (
                      <div
                        key={task.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          backgroundColor: 'var(--athena-surface-deep)',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--athena-text-muted)', flexShrink: 0 }}>
                            {task.id}
                          </span>
                          <span style={{ color: 'var(--athena-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {task.title}
                          </span>
                        </div>
                        <StatusBadge status={task.status} size="sm" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
