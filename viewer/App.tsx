import React, { useState, useEffect } from 'react';
import { FileImporter } from './components/FileImporter';
import { IncidentHeader } from './components/IncidentHeader';
import { ReplayPlayer } from './components/ReplayPlayer';
import { TimelineView } from './components/TimelineView';
import { validateFlightRecorderArtifact } from '../src/validation/validate';
import type { FlightRecorderArtifactV1 } from '../src/types/artifact';

export const App: React.FC = () => {
  const [artifact, setArtifact] = useState<FlightRecorderArtifactV1 | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [mobilePane, setMobilePane] = useState<'replay' | 'timeline'>('replay');
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const handleArtifactLoaded = (loaded: FlightRecorderArtifactV1) => {
    setArtifact(loaded);
    // Inicia no timestamp inicial do incidente (00:00) para reprodução do contexto
    setCurrentTimeMs(loaded.incident.startedAt);
    setMobilePane('replay');
  };

  useEffect(() => {
    // 1. Notifica o opener (ex: aplicação debugada) que o visualizador está montado e pronto
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'BACKTRACK_VIEWER_READY' }, '*');
        window.opener.postMessage({ type: 'FFR_VIEWER_READY' }, '*');
      } catch {
        // Ignora caso opener não esteja acessível
      }
    }

    // 2. Tenta restaurar artefato ativo da sessionStorage (sobrevive ao F5 na aba do viewer)
    try {
      const saved = sessionStorage.getItem('backtrack_active_artifact') || sessionStorage.getItem('ffr_active_artifact');
      if (saved) {
        const parsed = JSON.parse(saved);
        const validation = validateFlightRecorderArtifact(parsed);
        if (validation.success) {
          handleArtifactLoaded(validation.data);
        }
      }
    } catch {
      // Ignora erro de parse
    }

    // 3. Listener para carregar incidentes automaticamente via postMessage
    const handleMessage = (event: MessageEvent) => {
      if ((event.data?.type === 'LOAD_BACKTRACK_ARTIFACT' || event.data?.type === 'LOAD_FFR_ARTIFACT') && event.data?.artifact) {
        const incoming = event.data.artifact;

        // Responde de volta imediatamente para cancelar o timer de reenvio no widget
        if (event.source && 'postMessage' in event.source) {
          try {
            (event.source as Window).postMessage({ type: 'BACKTRACK_ARTIFACT_RECEIVED' }, '*');
            (event.source as Window).postMessage({ type: 'FFR_ARTIFACT_RECEIVED' }, '*');
          } catch {
            // Ignora
          }
        }

        // Se o mesmo artefato já está carregado, não recarrega para evitar piscar o player
        setArtifact((prev) => {
          if (prev?.incident?.id === incoming.incident?.id) {
            return prev;
          }
          const validation = validateFlightRecorderArtifact(incoming);
          if (validation.success) {
            try {
              sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(validation.data));
            } catch {
              // Ignora erro de quota
            }
            setCurrentTimeMs(validation.data.incident.startedAt);
            setMobilePane('replay');
            return validation.data;
          }
          return prev;
        });
      }
    };

    window.addEventListener('message', handleMessage);

    // 4. Carrega artefato remoto se houver ?gist= ou ?url= na barra de endereços
    const loadRemote = async () => {
      if (typeof window === 'undefined' || !window.location.search) return;
      const params = new URLSearchParams(window.location.search);
      const gistId = params.get('gist');
      const directUrl = params.get('url');

      if (!gistId && !directUrl) return;

      setRemoteLoading(true);
      setRemoteError(null);

      try {
        let rawData: unknown = null;

        if (gistId) {
          const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(gistId)}`, {
            headers: { Accept: 'application/vnd.github+json' }
          });
          if (!res.ok) {
            throw new Error(`Falha ao obter Gist do GitHub (${res.status}): ${res.statusText}`);
          }
          const gistJson = await res.json();
          const files = gistJson.files ? (Object.values(gistJson.files) as Array<{ content?: string; raw_url?: string; truncated?: boolean }>) : [];
          if (files.length === 0) {
            throw new Error('Nenhum arquivo encontrado no Gist especificado.');
          }

          const targetFile = files[0];
          if (targetFile.truncated && targetFile.raw_url) {
            const rawRes = await fetch(targetFile.raw_url);
            rawData = await rawRes.json();
          } else if (targetFile.content) {
            rawData = JSON.parse(targetFile.content);
          } else if (targetFile.raw_url) {
            const rawRes = await fetch(targetFile.raw_url);
            rawData = await rawRes.json();
          } else {
            throw new Error('Conteúdo do arquivo não disponível no Gist.');
          }
        } else if (directUrl) {
          const res = await fetch(directUrl);
          if (!res.ok) {
            throw new Error(`Falha ao baixar artefato da URL (${res.status}): ${res.statusText}`);
          }
          rawData = await res.json();
        }

        const validation = validateFlightRecorderArtifact(rawData);
        if (!validation.success) {
          throw new Error(`Artefato inválido: ${validation.errors.join(', ')}`);
        }

        handleArtifactLoaded(validation.data);
        try {
          sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(validation.data));
        } catch {
          // Ignora quota
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setRemoteError(msg);
      } finally {
        setRemoteLoading(false);
      }
    };

    loadRemote();

    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleReset = () => {
    setArtifact(null);
    setCurrentTimeMs(0);
    setMobilePane('replay');
    try {
      sessionStorage.removeItem('backtrack_active_artifact');
      sessionStorage.removeItem('ffr_active_artifact');
    } catch {
      // Ignora
    }
  };

  const handleSeek = (timeMs: number) => {
    setCurrentTimeMs(timeMs);
  };

  return (
    <div className="app-container">
      {remoteLoading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: '16px', color: '#6366f1' }}>
          <div style={{ width: '42px', height: '42px', border: '3px solid rgba(99, 102, 241, 0.2)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          <p style={{ fontSize: '15px', fontWeight: 500 }}>Carregando replay compartilhado...</p>
        </div>
      ) : !artifact ? (
        <>
          {remoteError && (
            <div style={{ maxWidth: '640px', margin: '24px auto 0', padding: '12px 18px', background: '#fee2e2', border: '1px solid #ef4444', borderRadius: '8px', color: '#991b1b', fontSize: '14px' }}>
              <strong>Erro ao carregar link compartilhado:</strong> {remoteError}
            </div>
          )}
          <FileImporter onArtifactLoaded={handleArtifactLoaded} />
        </>
      ) : (
        <>
          <IncidentHeader artifact={artifact} onReset={handleReset} />

          {/* Abas acessíveis para visualização responsiva (< 960px) */}
          <nav
            className="mobile-tab-nav"
            role="tablist"
            aria-label="Panel navigation"
          >
            <button
              type="button"
              role="tab"
              id="tab-replay"
              aria-controls="panel-replay"
              aria-selected={mobilePane === 'replay'}
              className={`mobile-tab-btn ${mobilePane === 'replay' ? 'is-active' : ''}`}
              onClick={() => setMobilePane('replay')}
            >
              Replay
            </button>
            <button
              type="button"
              role="tab"
              id="tab-timeline"
              aria-controls="panel-timeline"
              aria-selected={mobilePane === 'timeline'}
              className={`mobile-tab-btn ${mobilePane === 'timeline' ? 'is-active' : ''}`}
              onClick={() => setMobilePane('timeline')}
            >
              Eventos
            </button>
          </nav>

          <main className="main-layout" data-active-pane={mobilePane}>
            <div
              id="panel-replay"
              role="tabpanel"
              aria-labelledby="tab-replay"
              className={`pane-wrapper replay-wrapper ${mobilePane !== 'replay' ? 'mobile-hidden' : ''}`}
            >
              <ReplayPlayer
                events={artifact.replay}
                startedAt={artifact.incident.startedAt}
                finalizedAt={artifact.incident.finalizedAt}
                triggeredAt={artifact.incident.triggeredAt}
                currentTimeMs={currentTimeMs}
                onSeek={handleSeek}
                timelineEvents={artifact.timeline}
                annotationImage={artifact.incident.annotationImage}
                notes={
                  (artifact.incident.annotations?.notes as string) ||
                  (artifact.incident.triggers?.find((t) => t.detail?.notes)?.detail?.notes as string) ||
                  (artifact.incident.triggers?.find((t) => (t.detail?.userReason as string)?.startsWith('Anotação'))?.detail?.userReason as string)
                }
              />
            </div>

            <div
              id="panel-timeline"
              role="tabpanel"
              aria-labelledby="tab-timeline"
              className={`pane-wrapper timeline-wrapper ${mobilePane !== 'timeline' ? 'mobile-hidden' : ''}`}
            >
              <TimelineView
                events={artifact.timeline}
                startedAt={artifact.incident.startedAt}
                currentTimeMs={currentTimeMs}
                onSelectEvent={handleSeek}
              />
            </div>
          </main>
        </>
      )}
    </div>
  );
};
