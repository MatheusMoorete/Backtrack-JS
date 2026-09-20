import React, { useState } from 'react';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

interface IncidentHeaderProps {
  artifact: FlightRecorderArtifactV1;
  onReset: () => void;
}

export const IncidentHeader: React.FC<IncidentHeaderProps> = ({ artifact, onReset }) => {
  const { incident, environment, diagnostics, recorderVersion } = artifact;
  const [copied, setCopied] = useState(false);

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
          <span className="brand-version-badge">v{recorderVersion || '0.1.0'}</span>
          <span className="incident-status-badge">
            {incident.reason}
          </span>
        </div>

        <div className="header-actions">
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
