import React, { useState, useEffect } from 'react';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';
import { formatIncidentMarkdown } from '../../src/utils/markdown';
import { uploadArtifactToGist } from '../../src/utils/gist-uploader';
import { compressArtifact } from '../../src/utils/compression';
import packageJson from '../../package.json';

interface IncidentHeaderProps {
  artifact: FlightRecorderArtifactV1;
  onReset: () => void;
}

export const IncidentHeader: React.FC<IncidentHeaderProps> = ({ artifact, onReset }) => {
  const { incident, environment, diagnostics, recorderVersion } = artifact;
  const [copied, setCopied] = useState(false);
  const [mdCopied, setMdCopied] = useState(false);
  const [showAnnotation, setShowAnnotation] = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      const p = new URLSearchParams(window.location.search);
      const gid = p.get('gist');
      if (gid) {
        const offsetSec = Math.floor(
          Math.max(0, (incident.triggeredAt || incident.finalizedAt) - incident.startedAt) / 1000
        );
        return `${window.location.origin}/?gist=${gid}${offsetSec > 0 ? `&t=${offsetSec}` : ''}`;
      }
    }
    return null;
  });
  const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);
  const [shareLinkCopied, setShareLinkCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareTokenInput, setShareTokenInput] = useState('');
  const [showShareTokenPrompt, setShowShareTokenPrompt] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadFormat, setDownloadFormat] = useState<'gzip' | 'uncompressed' | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [includeLink, setIncludeLink] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showShareModal && !isGeneratingShareLink) setShowShareModal(false);
        if (showJiraModal && !isExporting) setShowJiraModal(false);
        if (showAnnotation) setShowAnnotation(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showShareModal, showJiraModal, showAnnotation, isGeneratingShareLink, isExporting]);

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

  const handleOpenJiraModal = () => {
    setExportError(null);
    setShowJiraModal(true);
  };

  const handleConfirmExport = async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      let replayUrl: string | undefined;

      if (includeLink) {
        // Se já foi aberto a partir de um gist existente, reutiliza
        const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
        const existingGistId = params?.get('gist');

        if (existingGistId) {
          replayUrl = `${window.location.origin}/?gist=${existingGistId}`;
        } else {
          let token = typeof localStorage !== 'undefined' ? localStorage.getItem('backtrack_github_token') : null;

          if (!token || !token.trim()) {
            const prompted = prompt(
              'Insira seu GitHub Personal Access Token (com permissão "gist") para gerar o link compartilhado:'
            );
            if (!prompted || !prompted.trim()) {
              setIsExporting(false);
              return;
            }
            token = prompted.trim();
            try {
              localStorage.setItem('backtrack_github_token', token);
            } catch {
              // Ignora erro de quota
            }
          }

          const result = await uploadArtifactToGist(artifact, token);
          replayUrl = `${window.location.origin}/?gist=${result.gistId}`;
        }

        const offsetSec = Math.floor(
          Math.max(0, (artifact.incident.triggeredAt || artifact.incident.finalizedAt) - artifact.incident.startedAt) / 1000
        );
        if (replayUrl && offsetSec > 0 && !replayUrl.includes('&t=') && !replayUrl.includes('?t=')) {
          replayUrl += (replayUrl.includes('?') ? '&' : '?') + `t=${offsetSec}`;
        }
      }

      const md = formatIncidentMarkdown(artifact, { replayUrl });
      await navigator.clipboard.writeText(md);

      setMdCopied(true);
      setShowJiraModal(false);
      setTimeout(() => setMdCopied(false), 2500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401')) {
        try {
          localStorage.removeItem('backtrack_github_token');
        } catch {
          // Ignora
        }
      }
      setExportError(msg);
    } finally {
      setIsExporting(false);
    }
  };


  const handleGenerateShareLink = async () => {
    setIsGeneratingShareLink(true);
    setShareError(null);
    try {
      let token = '';
      try {
        token = localStorage.getItem('backtrack_github_token') || '';
      } catch {
        // Ignora
      }

      if (!token && !shareTokenInput.trim()) {
        setShowShareTokenPrompt(true);
        setIsGeneratingShareLink(false);
        return;
      }

      const activeToken = shareTokenInput.trim() || token;
      if (shareTokenInput.trim()) {
        try {
          localStorage.setItem('backtrack_github_token', shareTokenInput.trim());
        } catch {
          // Ignora
        }
      }

      const result = await uploadArtifactToGist(artifact, activeToken);
      const offsetSec = Math.floor(
        Math.max(0, (incident.triggeredAt || incident.finalizedAt) - incident.startedAt) / 1000
      );
      const url = `${window.location.origin}/?gist=${result.gistId}${offsetSec > 0 ? `&t=${offsetSec}` : ''}`;
      setShareUrl(url);
      setShowShareTokenPrompt(false);
      await navigator.clipboard.writeText(url);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401')) {
        try {
          localStorage.removeItem('backtrack_github_token');
        } catch {
          // Ignora
        }
        setShowShareTokenPrompt(true);
      }
      setShareError(msg);
    } finally {
      setIsGeneratingShareLink(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareLinkCopied(true);
      setTimeout(() => setShareLinkCopied(false), 2500);
    } catch {
      // Ignora
    }
  };

  const handleDownloadFile = async () => {
    if (!downloadFormat) {
      setDownloadError('Escolha uma opção antes de baixar');
      return;
    }
    setDownloadError(null);

    try {
      if (downloadFormat === 'gzip') {
        try {
          const compressed = await compressArtifact(artifact);
          const blob = new Blob([compressed as unknown as BlobPart], { type: 'application/gzip' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${incident.id}.ffr.json.gz`;
          a.click();
          URL.revokeObjectURL(url);
        } catch {
          const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${incident.id}.ffr.json`;
          a.click();
          URL.revokeObjectURL(url);
        }
      } else {
        const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${incident.id}.ffr.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 2500);
    } catch {
      setDownloadError('Falha ao baixar arquivo de gravação.');
    }
  };

  return (
    <header className="app-header">
      {diagnostics.degraded && (
        <div role="alert" style={{ padding: '12px 18px', background: '#422006', color: '#fef3c7' }}>
          <strong>Gravação incompleta</strong>
          <ul>{diagnostics.degradedReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          {diagnostics.droppedEventsUnknown && <p>A quantidade total de eventos perdidos é desconhecida.</p>}
        </div>
      )}
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
          <span className="brand-title">Backtrack JS</span>
          <span
            className="brand-version-badge"
            title={recorderVersion ? `Visualizador v${packageJson.version} (incidente gravado com v${recorderVersion})` : `Backtrack JS v${packageJson.version}`}
          >
            v{packageJson.version}
          </span>
        </div>

        <div className="header-actions">
          {incident.annotationImage && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowAnnotation(true)}
              style={{ color: '#f59e0b', borderColor: '#f59e0b', display: 'flex', alignItems: 'center', gap: '6px' }}
              title="Ver anotação visual do QA na tela"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                <path d="M2 2l7.586 7.586" />
                <circle cx="11" cy="11" r="2" />
              </svg>
              <span>Anotação de Tela</span>
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={handleOpenJiraModal}
            title="Copiar relatório formatado para Jira/GitHub"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            <span>{mdCopied ? '✓ Copiado p/ Jira' : 'Jira / GitHub'}</span>
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
            onClick={() => {
              setShareError(null);
              setDownloadFormat(null);
              setDownloadError(null);
              setShowShareModal(true);
            }}
            title="Compartilhar gravação via link ou baixar arquivo"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
            </svg>
            <span>Compartilhar</span>
          </button>
        </div>
      </div>

      {/* Modal de Exportação para Jira / GitHub */}
      {showJiraModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => !isExporting && setShowJiraModal(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '460px',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid #334155',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f8fafc', fontWeight: 600, fontSize: '14px' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                <span>Exportar para Jira / GitHub</span>
              </div>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' }}
                onClick={() => !isExporting && setShowJiraModal(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={includeLink}
                  onChange={(e) => setIncludeLink(e.target.checked)}
                  disabled={isExporting}
                  style={{ marginTop: '2px', width: '16px', height: '16px', accentColor: '#2563eb', cursor: 'pointer' }}
                />
                <div>
                  <div style={{ color: '#f1f5f9', fontSize: '13.5px', fontWeight: 500 }}>Adicionar link do incidente?</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '3px', lineHeight: '1.4' }}>
                    Gera e inclui um link do replay online (via GitHub Gist) no resumo Markdown para que qualquer pessoa da equipe possa reproduzir e investigar a sessão diretamente pela issue.
                  </div>
                </div>
              </label>

              {exportError && (
                <div style={{ padding: '8px 12px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '6px', color: '#fca5a5', fontSize: '12px' }}>
                  {exportError}
                </div>
              )}
            </div>

            <div style={{ padding: '12px 18px', background: '#090d16', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowJiraModal(false)}
                disabled={isExporting}
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleConfirmExport}
                disabled={isExporting}
                style={{ background: '#2563eb', borderColor: '#3b82f6', color: '#ffffff', fontWeight: 500, padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                {isExporting ? 'Criando link do Gist...' : 'Copiar Markdown'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Compartilhamento (Link ou Arquivo) */}
      {showShareModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.75)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
          onClick={() => !isGeneratingShareLink && setShowShareModal(false)}
        >
          <div
            style={{
              width: '460px',
              maxWidth: '90vw',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid #334155',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f8fafc', fontWeight: 600, fontSize: '14px' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                  <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
                <span>Compartilhar Incidente</span>
              </div>
              <button
                type="button"
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '16px', cursor: 'pointer', padding: '4px 8px' }}
                onClick={() => !isGeneratingShareLink && setShowShareModal(false)}
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Opção 1: Compartilhar via Link */}
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>
                  <strong style={{ color: '#f8fafc', fontSize: '13px' }}>Compartilhar via Link</strong>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>
                  Gera um link do replay online (via GitHub Gist) para qualquer pessoa da equipe assistir no navegador.
                </p>

                {shareUrl ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                    <input
                      type="text"
                      readOnly
                      value={shareUrl}
                      style={{
                        flex: 1,
                        background: '#0f172a',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '6px 10px',
                        color: '#93c5fd',
                        fontSize: '12px',
                        fontFamily: 'monospace'
                      }}
                    />
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={handleCopyShareUrl}
                      style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                    >
                      {shareLinkCopied ? '✓ Copiado!' : 'Copiar Link'}
                    </button>
                  </div>
                ) : showShareTokenPrompt ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' }}>
                    <label style={{ fontSize: '11px', color: '#cbd5e1' }}>
                      GitHub Personal Access Token (classic com permissão <code>gist</code>):
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="password"
                        value={shareTokenInput}
                        onChange={(e) => setShareTokenInput(e.target.value)}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        style={{
                          flex: 1,
                          background: '#0f172a',
                          border: '1px solid #334155',
                          borderRadius: '6px',
                          padding: '6px 10px',
                          color: '#f8fafc',
                          fontSize: '12px'
                        }}
                      />
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={handleGenerateShareLink}
                        disabled={isGeneratingShareLink || !shareTokenInput.trim()}
                        style={{ padding: '6px 12px', fontSize: '12px', whiteSpace: 'nowrap' }}
                      >
                        {isGeneratingShareLink ? 'Gerando...' : 'Salvar e Gerar'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleGenerateShareLink}
                    disabled={isGeneratingShareLink}
                    style={{ alignSelf: 'flex-start', marginTop: '4px', padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    <span>{isGeneratingShareLink ? 'Gerando link online...' : 'Gerar e Copiar Link'}</span>
                  </button>
                )}

                {shareError && (
                  <div style={{ color: '#ef4444', fontSize: '11px', marginTop: '4px', background: 'rgba(239, 68, 68, 0.1)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    {shareError}
                  </div>
                )}
              </div>

              {/* Opção 2: Baixar Arquivo */}
              <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '8px', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <strong style={{ color: '#f8fafc', fontSize: '13px' }}>Baixar Arquivo da Gravação</strong>
                </div>
                <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', lineHeight: 1.4 }}>
                  Escolha o formato desejado para salvar a gravação no seu computador:
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      border: downloadFormat === 'gzip' ? '1px solid #2563eb' : '1px solid #334155',
                      borderRadius: '6px',
                      background: downloadFormat === 'gzip' ? 'rgba(37, 99, 235, 0.1)' : '#0f172a',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      setDownloadFormat('gzip');
                      setDownloadError(null);
                    }}
                  >
                    <input
                      type="radio"
                      name="viewer-download-format"
                      value="gzip"
                      checked={downloadFormat === 'gzip'}
                      onChange={() => {
                        setDownloadFormat('gzip');
                        setDownloadError(null);
                      }}
                      style={{ marginTop: '2px', cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f1f5f9' }}>
                        Arquivo compactado (.ffr.json.gz) — Menor tamanho
                      </span>
                      <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#94a3b8', lineHeight: 1.35 }}>
                        Compactado com Gzip (~90% menor, ~100 KB). Ideal para compartilhamento rápido no Slack, Jira ou WhatsApp.
                      </p>
                    </div>
                  </label>

                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '10px 12px',
                      border: downloadFormat === 'uncompressed' ? '1px solid #2563eb' : '1px solid #334155',
                      borderRadius: '6px',
                      background: downloadFormat === 'uncompressed' ? 'rgba(37, 99, 235, 0.1)' : '#0f172a',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onClick={() => {
                      setDownloadFormat('uncompressed');
                      setDownloadError(null);
                    }}
                  >
                    <input
                      type="radio"
                      name="viewer-download-format"
                      value="uncompressed"
                      checked={downloadFormat === 'uncompressed'}
                      onChange={() => {
                        setDownloadFormat('uncompressed');
                        setDownloadError(null);
                      }}
                      style={{ marginTop: '2px', cursor: 'pointer', accentColor: '#2563eb' }}
                    />
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#f1f5f9' }}>
                        Arquivo completo (.ffr.json) — Maior tamanho
                      </span>
                      <p style={{ margin: '3px 0 0 0', fontSize: '11px', color: '#94a3b8', lineHeight: 1.35 }}>
                        JSON descompactado (~1 MB+). Útil para leitura e inspeção direta de texto bruto.
                      </p>
                    </div>
                  </label>
                </div>

                {downloadError && (
                  <div style={{ color: '#fca5a5', fontSize: '11px', background: 'rgba(239, 68, 68, 0.15)', padding: '6px 10px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    {downloadError}
                  </div>
                )}

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleDownloadFile}
                  style={{ alignSelf: 'flex-start', marginTop: '4px', padding: '6px 14px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>{downloadSuccess ? '✓ Download Iniciado!' : 'Baixar Arquivo'}</span>
                </button>
              </div>
            </div>

            <div style={{ padding: '12px 18px', background: '#090d16', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowShareModal(false)}
                disabled={isGeneratingShareLink}
                style={{ padding: '6px 16px', fontSize: '12px' }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f8fafc', fontSize: '13px', fontWeight: 600 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 19l7-7 3 3-7 7-3-3z" />
                  <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                  <path d="M2 2l7.586 7.586" />
                  <circle cx="11" cy="11" r="2" />
                </svg>
                <span>Anotação Visual Registrada no Incidente</span>
              </div>
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
              style={{ maxWidth: '100%', maxHeight: 'calc(85vh - 90px)', objectFit: 'contain' }}
            />
            {(() => {
              const triggerNotes = incident.triggers?.find((t) => t.detail?.notes)?.detail?.notes as string | undefined;
              const notes = (incident.annotations?.notes as string) || triggerNotes;
              const offsetMs = Math.max(0, (incident.triggeredAt || incident.finalizedAt) - incident.startedAt);
              if (!notes) return null;
              return (
                <div style={{ padding: '10px 16px', background: '#1e293b', borderTop: '1px solid #334155', color: '#f8fafc', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#60a5fa', fontWeight: 600 }}>QA [{formatDuration(offsetMs)}]:</span>
                  <span>{notes}</span>
                </div>
              );
            })()}
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
          {diagnostics.droppedEventsUnknown ? (
            <div className="meta-chip is-warning">Perdas: quantidade desconhecida</div>
          ) : diagnostics.droppedEvents > 0 ? (
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
