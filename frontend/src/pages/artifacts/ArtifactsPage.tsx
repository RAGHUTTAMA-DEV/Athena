import React, { useState, useEffect } from 'react';
import { FileText, Download, RotateCcw, AlertCircle, FileCode } from 'lucide-react';
import { ArtifactRecord } from '../../types/api';
import { apiClient } from '../../lib/api/client';

export const ArtifactsPage: React.FC = () => {
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchArtifacts = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const list = await apiClient.listArtifacts();
      setArtifacts(list);
      if (list.length > 0 && !selectedArtifact) {
        loadDetail(list[0].id);
      }
    } catch (err: any) {
      console.error('[Artifacts] Failed to fetch:', err);
      setError(err?.message || 'Failed to load artifacts');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    try {
      const art = await apiClient.getArtifact(id);
      setSelectedArtifact(art);
    } catch (err) {
      console.error('Failed to load artifact details:', err);
    }
  };

  useEffect(() => {
    fetchArtifacts();
  }, []);

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1000px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Artifacts
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Real generated deliverables, documents, diffs, and reports stored by Athena runtime.
          </p>
        </div>

        <button
          onClick={fetchArtifacts}
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

      {artifacts.length === 0 ? (
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
          {isLoading ? 'Loading artifacts from storage...' : 'No artifacts stored yet. Runs that generate code, reports, or files will appear here.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          {/* Left: Artifacts List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {artifacts.map((art) => (
              <div
                key={art.id}
                onClick={() => loadDetail(art.id)}
                style={{
                  padding: '14px',
                  backgroundColor:
                    selectedArtifact?.id === art.id
                      ? 'var(--athena-surface-raised)'
                      : 'var(--athena-surface)',
                  border: `1px solid ${
                    selectedArtifact?.id === art.id ? 'var(--athena-border-focus)' : 'var(--athena-border)'
                  }`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <FileText size={16} color="var(--athena-accent)" />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                      {art.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--athena-text-muted)',
                      padding: '1px 5px',
                      backgroundColor: 'var(--athena-surface-deep)',
                      borderRadius: 'var(--radius-xs)',
                    }}
                  >
                    v{art.currentVersion || 1}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--athena-text-muted)' }}>
                  <span>{art.type}</span>
                  {art.runId && (
                    <>
                      <span>•</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{art.runId}</span>
                    </>
                  )}
                  <span>•</span>
                  <span>{new Date(art.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Right: Artifact Preview */}
          <div
            style={{
              backgroundColor: 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              minHeight: '340px',
            }}
          >
            {selectedArtifact ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: '12px',
                    marginBottom: '12px',
                    borderBottom: '1px solid var(--athena-border-subtle)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                      {selectedArtifact.name}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                      {selectedArtifact.type} · v{selectedArtifact.currentVersion}
                    </div>
                  </div>

                  {selectedArtifact.filePath && (
                    <span style={{ fontSize: '10px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                      {selectedArtifact.filePath}
                    </span>
                  )}
                </div>

                <pre
                  style={{
                    flex: 1,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--athena-text-secondary)',
                    backgroundColor: 'var(--athena-surface-deep)',
                    padding: '12px',
                    borderRadius: 'var(--radius-xs)',
                    overflow: 'auto',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {selectedArtifact.contentText || 'No previewable text content available for this artifact.'}
                </pre>
              </>
            ) : (
              <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
                Select an artifact on the left to inspect its contents.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
