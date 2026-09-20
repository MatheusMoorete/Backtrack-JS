import React, { useState } from 'react';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';
import { formatIncidentMarkdown } from '../../src/utils/markdown';

interface IncidentHeaderProps {
  artifact: FlightRecorderArtifactV1;
  onReset: () => void;
}

export const IncidentHeader: React.FC<IncidentHeaderProps> = ({ artifact, onReset }) => {
  const { incident, environment, diagnostics, recorderVersion } = artifact;
  const [copied, setCopied] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  const [showAnnotation, setShowAnnotation] = useState(false);

  const formatDate = (epoch: number) => {
    return new Date(epoch).toLocaleTimeString();
  };

  const formatDuration = (ms: number) => {
    const totalSec = Math.max(1, Math.round(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getHostFromUrl = (urlString: string) => {
    try {
      const u = new URL(urlString);
      return u.host;
    } catch {
      return urlString;
    }
  };

  const handleCopyId = () => {
    try {
      navigator.clipboard.writeText(incident.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleCopyMarkdown = () => {
    try {
      const md = formatIncidentMarkdown(artifact);
      navigator.clipboard.writeText(md);
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${incident.id}.ffr.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="app-header">
      {/* Faixa Primária: Identidade, Status neutro e Ações */}
      <div className="header-primary-band">
        <div className="header-brand-wrap">
          <span className="brand-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <polyline points="3 3 3 8 8 8" />
              <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="brand-title">Backtrack</span>
          <span className="brand-version-badge">v{recorderVersion || '0.2.0'}</span>
          <span className="incident-status-badge">
            {incident.reason}
          </span>
        </div>

        <div className="header-actions">
          {incident.annotationImage && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowAnnotation(true)}
              style={{ color: '#f59e0b', borderColor: '#f59e0b' }}
              title="Ver anotação visual do QA na tela"
            >
              🎨 Anotação de Tela
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleCopyMarkdown}
            title="Copiar relatório formatado para Jira/GitHub"
          >
            {mdCopied ? '✓ Copiado p/ Jira' : '📋 Jira / GitHub'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onReset}
            aria-label="Carregar outro incidente"
          >
            Carregar outro arquivo
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={handleExport}
            title="Baixar artefato JSON"
          >
            Exportar
          </button>
        </div>
      </div>

      {/* Modal de Anotação de Tela */}
      {showAnnotation && incident.annotationImage && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.85)',
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setShowAnnotation(false)}
        >
          <div
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '85vh',
              background: '#0f172a',
              borderRadius: '8px',
              border: '1px solid #334155',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
              <strong style={{ color: '#f8fafc', fontSize: '13px' }}>🎨 Anotação Visual Registrada no Incidente</strong>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer' }}
                onClick={() => setShowAnnotation(false)}
              >
                ✕
              </button>
            </div>
            <img
              src={incident.annotationImage}
              alt="Anotação de tela"
              style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 50px)', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}

      {/* Faixa Secundária: Metadados Técnicos em layout plano */}
      <div className="header-secondary-band">
        <div className="incident-meta-chips">
          <button
            type="button"
            className="meta-chip meta-chip-btn"
            onClick={handleCopyId}
            title="Clique para copiar ID completo"
            aria-label="Copiar ID do incidente"
          >
            <span className="meta-label">ID:</span>
            <strong className="meta-value meta-id">{incident.id}</strong>
            {copied && <span className="meta-copied" aria-label="Copiado">✓</span>}
          </button>
          <div className="meta-chip">
            <span className="meta-label">Hora:</span>
            <strong className="meta-value">{formatDate(incident.triggeredAt)}</strong>
          </div>
          <div className="meta-chip">
            <span className="meta-label">Duração:</span>
            <strong className="meta-value">{formatDuration(incident.finalizedAt - incident.startedAt)}</strong>
          </div>
          <div className="meta-chip meta-chip-host" title={environment.url}>
            <span className="meta-label">Host:</span>
            <strong className="meta-value">{getHostFromUrl(environment.url)}</strong>
          </div>
          <div className="meta-chip">
            <span className="meta-label">Viewport:</span>
            <strong className="meta-value">{environment.viewport.width}×{environment.viewport.height}</strong>
          </div>
          {diagnostics.droppedEvents > 0 ? (
            <div className="meta-chip meta-chip-drops is-warning">
              <span className="meta-label">Drops:</span>
              <strong className="meta-value">{diagnostics.droppedEvents}</strong>
            </div>
          ) : (
            <div className="meta-chip meta-chip-drops">
              <span className="meta-label">Drops:</span>
              <strong className="meta-value">0</strong>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
