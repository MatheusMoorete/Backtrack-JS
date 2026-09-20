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
        const validation = validateFlightRecorderArtifact(event.data.artifact);
        if (validation.success) {
          handleArtifactLoaded(validation.data);
          try {
            sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(validation.data));
          } catch {
            // Ignora erro de quota
          }
          if (event.source && 'postMessage' in event.source) {
            (event.source as Window).postMessage({ type: 'BACKTRACK_ARTIFACT_RECEIVED' }, '*');
            (event.source as Window).postMessage({ type: 'FFR_ARTIFACT_RECEIVED' }, '*');
          }
        }
      }
    };

    window.addEventListener('message', handleMessage);
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
      {!artifact ? (
        <FileImporter onArtifactLoaded={handleArtifactLoaded} />
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
                currentTimeMs={currentTimeMs}
                onSeek={handleSeek}
                timelineEvents={artifact.timeline}
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
