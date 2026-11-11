import React, { useState, useEffect } from 'react';
import { BookOpen, Search, Upload, Database, RotateCcw, Plus } from 'lucide-react';
import { apiClient } from '../../lib/api/client';

export const KnowledgePage: React.FC = () => {
  const [documents, setDocuments] = useState<any[]>([]);
  const [vectorStats, setVectorStats] = useState<any>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const [showUpload, setShowUpload] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docUri, setDocUri] = useState('');
  const [docText, setDocText] = useState('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const [isLoading, setIsLoading] = useState(true);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [docsRes, statsRes] = await Promise.allSettled([
        apiClient.listResearchDocuments(),
        apiClient.getVectorStats(),
      ]);
      if (docsRes.status === 'fulfilled') setDocuments(docsRes.value);
      if (statsRes.status === 'fulfilled') setVectorStats(statsRes.value);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await apiClient.searchResearch(searchQuery.trim(), 8);
      setSearchResults(res.results || []);
    } catch (err: any) {
      alert(`Search failed: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docTitle.trim() || !docText.trim()) return;
    try {
      await apiClient.uploadResearchDocument({
        title: docTitle.trim(),
        sourceUri: docUri.trim() || `local://${docTitle.trim().toLowerCase().replace(/\s+/g, '_')}`,
        sourceType: 'text',
        textContent: docText.trim(),
      });
      setDocTitle('');
      setDocUri('');
      setDocText('');
      setShowUpload(false);
      await loadData();
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    }
  };

  const handleFileIngest = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingFile(true);
    try {
      await apiClient.uploadAttachment(file);
      setShowUpload(false);
      await loadData();
    } catch (err: any) {
      alert(`File ingest failed: ${err.message}`);
    } finally {
      setIsUploadingFile(false);
      e.target.value = '';
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: '1040px', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
            Knowledge & RAG
          </h1>
          <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
            Ingest research documents, query vector embeddings, and inspect indexed knowledge chunks.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={loadData}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '11px', color: 'var(--athena-text-secondary)', cursor: 'pointer' }}
          >
            <RotateCcw size={12} />
            <span>Reload</span>
          </button>

          <button
            onClick={() => setShowUpload((p) => !p)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
          >
            <Upload size={13} />
            <span>{showUpload ? 'Cancel' : 'Ingest Document'}</span>
          </button>
        </div>
      </div>

      {/* Vector Stats */}
      {vectorStats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>Indexed Documents</div>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--athena-text)', marginTop: '4px' }}>
              {documents.length}
            </div>
          </div>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>Vector Chunks</div>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--athena-text)', marginTop: '4px' }}>
              {vectorStats.totalVectors ?? vectorStats.count ?? 0}
            </div>
          </div>
          <div style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase' }}>Namespaces</div>
            <div style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--athena-accent)', marginTop: '6px' }}>
              {Array.isArray(vectorStats.namespaces) ? vectorStats.namespaces.join(', ') || 'documents' : 'documents'}
            </div>
          </div>
        </div>
      )}

      {/* Upload Form */}
      {showUpload && (
        <form
          onSubmit={handleUpload}
          style={{ marginBottom: '20px', padding: '16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border-focus)', borderRadius: 'var(--radius-sm)', display: 'flex', flexDirection: 'column', gap: '10px' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', backgroundColor: 'var(--athena-surface-deep)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-xs)' }}>
            <span style={{ fontSize: '12px', color: 'var(--athena-text-secondary)' }}>
              Upload a file directly (PDF, DOCX, XLSX, CSV, Markdown, Image) — extracts pages, photos, and TOC/Index automatically:
            </span>
            <label style={{ padding: '5px 12px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '11px', fontWeight: 600, cursor: isUploadingFile ? 'wait' : 'pointer' }}>
              {isUploadingFile ? 'Parsing & Indexing...' : 'Choose File'}
              <input type="file" onChange={handleFileIngest} disabled={isUploadingFile} style={{ display: 'none' }} />
            </label>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', textAlign: 'center' }}>— or paste raw text below —</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <input
              required
              placeholder="Document title *"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
            />
            <input
              placeholder="Source URI (optional, e.g. docs/notes.md)"
              value={docUri}
              onChange={(e) => setDocUri(e.target.value)}
              style={{ padding: '7px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <textarea
            required
            rows={4}
            placeholder="Paste document text content to index into vector store..."
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
            style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-xs)', fontSize: '12px' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={{ padding: '6px 14px', backgroundColor: 'var(--athena-accent)', color: '#171819', borderRadius: 'var(--radius-xs)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
              Index Document
            </button>
          </div>
        </form>
      )}

      {/* Semantic Search Bar */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', padding: '7px 12px' }}>
          <Search size={14} color="var(--athena-text-muted)" />
          <input
            placeholder="Semantic vector search across indexed documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', fontSize: '12px' }}
          />
        </div>
        <button
          type="submit"
          disabled={isSearching}
          style={{ padding: '7px 16px', backgroundColor: 'var(--athena-surface-raised)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)', cursor: 'pointer' }}
        >
          {isSearching ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Search Results */}
      {searchResults !== null && (
        <div style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
              Vector Search Results ({searchResults.length})
            </span>
            <button onClick={() => setSearchResults(null)} style={{ fontSize: '11px', color: 'var(--athena-text-muted)', cursor: 'pointer' }}>
              Clear
            </button>
          </div>

          {searchResults.length === 0 ? (
            <div style={{ padding: '16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', fontSize: '12px', color: 'var(--athena-text-muted)' }}>
              No matching vector chunks found.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {searchResults.map((res: any, i: number) => (
                <div key={res.id || i} style={{ padding: '12px 14px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px', fontSize: '11px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--athena-accent)' }}>{res.metadata?.title || res.namespace}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                      score: {Number(res.score || 0).toFixed(3)}
                    </span>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--athena-text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {res.text}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents List */}
      <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '10px' }}>
        Indexed Documents ({documents.length})
      </h2>
      {documents.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', backgroundColor: 'var(--athena-surface)', border: '1px dashed var(--athena-border)', borderRadius: 'var(--radius-sm)', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
          {isLoading ? 'Loading documents...' : 'No research documents indexed yet. Click "Ingest Document" to add knowledge.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {documents.map((doc) => (
            <div key={doc.id} style={{ padding: '12px 16px', backgroundColor: 'var(--athena-surface)', border: '1px solid var(--athena-border)', borderRadius: 'var(--radius-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>{doc.title || doc.sourceUri}</div>
                <div style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--athena-text-muted)' }}>
                  {doc.format || doc.sourceType}
                  {doc.metadata?.pageCount ? ` · ${doc.metadata.pageCount} pages` : ''}
                  {doc.metadata?.mediaAssets?.length ? ` · ${doc.metadata.mediaAssets.length} photo(s)` : ''}
                  {doc.metadata?.hasIndexPage ? ` · Index/TOC` : ''}
                  {` · ${doc.chunkCount} chunks · ${doc.charCount} chars`}
                </div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
                {doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

