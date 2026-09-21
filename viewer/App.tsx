import React, { useState, useEffect } from 'react';
import { FileImporter } from './components/FileImporter';
import { IncidentHeader } from './components/IncidentHeader';
import { ReplayPlayer } from './components/ReplayPlayer';
import { TimelineView } from './components/TimelineView';
import { validateFlightRecorderArtifact } from '../src/validation/validate';
import { decompressArtifact } from '../src/utils/compression';
import type { FlightRecorderArtifactV1 } from '../src/types/artifact';

export const App: React.FC = () => {
  const [artifact, setArtifact] = useState<FlightRecorderArtifactV1 | null>(null);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [mobilePane, setMobilePane] = useState<'replay' | 'timeline'>('replay');
  const [remoteLoading, setRemoteLoading] = useState<boolean>(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const parseTimeOffsetParam = (t: string | null): number | undefined => {
    if (!t) return undefined;
    if (t.includes(':')) {
      const parts = t.split(':').map(Number);
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return (parts[0] * 60 + parts[1]) * 1000;
      }
    }
    const clean = t.replace(/s$/i, '');
    const num = parseFloat(clean);
    if (isNaN(num)) return undefined;
    if (t.toLowerCase().endsWith('ms')) return num;
    return num * 1000;
  };

  const handleArtifactLoaded = (loaded: FlightRecorderArtifactV1, initialOffsetMs?: number) => {
    setArtifact(loaded);
    const start = loaded.incident.startedAt;
    const duration = Math.max(0, loaded.incident.finalizedAt - loaded.incident.startedAt);
    const offset = initialOffsetMs !== undefined ? Math.min(Math.max(0, initialOffsetMs), duration) : 0;
    setCurrentTimeMs(start + offset);
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
          const params = typeof window !== 'undefined' && window.location.search ? new URLSearchParams(window.location.search) : null;
          const initialOffsetMs = parseTimeOffsetParam(params?.get('t') ?? null);
          handleArtifactLoaded(validation.data, initialOffsetMs);
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
      const initialOffsetMs = parseTimeOffsetParam(params.get('t'));

      if (!gistId && !directUrl) return;

      setRemoteLoading(true);
      setRemoteError(null);

      try {
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
          let loadedArtifact: FlightRecorderArtifactV1;

          const readResponseArtifact = async (response: Response): Promise<FlightRecorderArtifactV1> => {
            if (typeof response.arrayBuffer === 'function') {
              const buf = await response.arrayBuffer();
              return decompressArtifact(buf);
            }
            if (typeof response.json === 'function') {
              const json = await response.json();
              return decompressArtifact(json);
            }
            const txt = await response.text();
            return decompressArtifact(txt);
          };

          if (targetFile.truncated && targetFile.raw_url) {
            const rawRes = await fetch(targetFile.raw_url);
            loadedArtifact = await readResponseArtifact(rawRes);
          } else if (targetFile.content) {
            loadedArtifact = await decompressArtifact(targetFile.content);
          } else if (targetFile.raw_url) {
            const rawRes = await fetch(targetFile.raw_url);
            loadedArtifact = await readResponseArtifact(rawRes);
          } else {
            throw new Error('Conteúdo do arquivo não disponível no Gist.');
          }

          handleArtifactLoaded(loadedArtifact, initialOffsetMs);
          try {
            sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(loadedArtifact));
          } catch {
            // Ignora quota
          }
          return;
        } else if (directUrl) {
          const res = await fetch(directUrl);
          if (!res.ok) {
            throw new Error(`Falha ao baixar artefato da URL (${res.status}): ${res.statusText}`);
          }
          const loadedArtifact = typeof res.arrayBuffer === 'function'
            ? await decompressArtifact(await res.arrayBuffer())
            : typeof res.json === 'function'
              ? await decompressArtifact(await res.json())
              : await decompressArtifact(await res.text());

          handleArtifactLoaded(loadedArtifact, initialOffsetMs);
          try {
            sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(loadedArtifact));
          } catch {
            // Ignora quota
          }
          return;
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
