import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import type { RrwebEvent } from '../../src/types/chunk';
import type { TimelineEvent } from '../../src/types/timeline';

interface ReplayPlayerProps {
  events: RrwebEvent[];
  startedAt: number;
  finalizedAt: number;
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
  timelineEvents?: TimelineEvent[];
}

type ZoomMode = 'auto' | '1.0' | '0.75' | '0.5' | '0.33';

function getViewportDimensions(events: RrwebEvent[]): { width: number; height: number } {
  for (const ev of events) {
    if (ev.type === 4 && (ev.data as Record<string, unknown>)?.width && (ev.data as Record<string, unknown>)?.height) {
      return {
        width: Number((ev.data as Record<string, unknown>).width) || 1280,
        height: Number((ev.data as Record<string, unknown>).height) || 720
      };
    }
  }
  return { width: 1280, height: 720 };
}

export const ReplayPlayer: React.FC<ReplayPlayerProps> = ({
  events,
  startedAt,
  finalizedAt,
  currentTimeMs,
  onSeek,
  timelineEvents
}) => {
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('auto');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [tickerOffsetMs, setTickerOffsetMs] = useState<number | null>(null);

  const totalDurationMs = Math.max(1000, finalizedAt - startedAt);
  const viewport = getViewportDimensions(events);

  // Monitora o tamanho real do contêiner para calcular o auto-scale
  useEffect(() => {
    const el = outerContainerRef.current;
    if (!el) return undefined;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setContainerSize((prev) => {
          if (Math.abs(prev.width - rect.width) < 2 && Math.abs(prev.height - rect.height) < 2) {
            return prev;
          }
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        });
      }
    };

    updateSize();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateSize();
      });
      observer.observe(el);
      return () => {
        observer.disconnect();
      };
    }
    return undefined;
  }, []);

  // Cálculo da escala de ajuste automático à tela (auto-scale)
  const availableWidth = Math.max(150, containerSize.width - 32);
  const availableHeight = Math.max(150, containerSize.height - 32);
  const scaleX = availableWidth / viewport.width;
  const scaleY = availableHeight / viewport.height;
  const autoScale = Math.min(scaleX, scaleY, 1);

  const currentScale =
    zoomMode === 'auto' ? autoScale : Number(zoomMode) || 1;

  // Inicializa o replayer do rrweb
  useEffect(() => {
    if (!containerRef.current) return undefined;
    if (!events || events.length === 0) {
      setReplayError('Nenhum evento de DOM/replay foi gravado para este incidente.');
      return undefined;
    }

    try {
      containerRef.current.innerHTML = '';
      setReplayError(null);

      const replayer = new Replayer(
        events as unknown as ConstructorParameters<typeof Replayer>[0],
        {
          root: containerRef.current,
          speed,
          skipInactive: false,
          showWarning: false,
          mouseTail: {
            duration: 500,
            lineCap: 'round',
            lineWidth: 3,
            strokeStyle: '#3b82f6'
          },
          UNSAFE_replayCanvas: true,
          UNSAFE_allowUnprotectedRebuild: true
        } as unknown as ConstructorParameters<typeof Replayer>[1]
      );

      replayerRef.current = replayer;

      const initialOffset = Math.max(0, currentTimeMs - startedAt);
      replayer.pause(initialOffset);

      replayer.on('finish', () => {
        setIsPlaying(false);
        setTickerOffsetMs(null);
      });
    } catch (err) {
      setReplayError(`Falha ao inicializar o player rrweb: ${err instanceof Error ? err.message : String(err)}`);
    }

    return () => {
      if (replayerRef.current) {
        try {
          replayerRef.current.destroy();
        } catch {
          // Noop
        }
        replayerRef.current = null;
      }
    };
  }, [events]);

  // Atualiza velocidade
  useEffect(() => {
    if (replayerRef.current) {
      replayerRef.current.setConfig({ speed });
    }
  }, [speed]);

  // Sincroniza busca externa (clique na timeline)
  useEffect(() => {
    if (!replayerRef.current) return;
    const offsetMs = Math.max(0, Math.min(totalDurationMs, currentTimeMs - startedAt));
    if (!isPlaying) {
      try {
        replayerRef.current.pause(offsetMs);
      } catch {
        // Ignora limitações de happy-dom / jsdom durante testes unitários
      }
      setTickerOffsetMs(offsetMs);
    }
  }, [currentTimeMs, startedAt, totalDurationMs, isPlaying]);

  // Timer contínuo de sincronização quando em reprodução
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (!replayerRef.current) return;
      const currentReplayTime = replayerRef.current.getCurrentTime();
      setTickerOffsetMs(currentReplayTime);
      onSeek(startedAt + currentReplayTime);

      if (currentReplayTime >= totalDurationMs) {
        setIsPlaying(false);
        replayerRef.current.pause(totalDurationMs);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, onSeek, startedAt, totalDurationMs]);

  // Seek direto
  const seekTo = useCallback(
    (offsetMs: number) => {
      const clamped = Math.max(0, Math.min(totalDurationMs, offsetMs));
      setTickerOffsetMs(clamped);
      onSeek(startedAt + clamped);

      if (replayerRef.current) {
        try {
          if (isPlaying) {
            replayerRef.current.play(clamped);
          } else {
            replayerRef.current.pause(clamped);
          }
        } catch {
          // Ignora limitações de happy-dom / jsdom durante testes unitários
        }
      }
    },
    [isPlaying, onSeek, startedAt, totalDurationMs]
  );

  const togglePlay = () => {
    if (!replayerRef.current) return;
    if (isPlaying) {
      replayerRef.current.pause();
      setIsPlaying(false);
    } else {
      const currentOffset = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);
      if (currentOffset >= totalDurationMs) {
        seekTo(0);
      }
      replayerRef.current.play(currentOffset >= totalDurationMs ? 0 : currentOffset);
      setIsPlaying(true);
    }
  };

  const handleStepSeconds = (deltaSeconds: number) => {
    const currentOffset = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);
    seekTo(currentOffset + deltaSeconds * 1000);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newOffset = Number(e.target.value);
    seekTo(newOffset);
  };

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentOffsetMs = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);

  return (
    <div className="replay-pane">
      <div className="replay-container" ref={outerContainerRef}>
        {replayError ? (
          <div className="import-error" style={{ zIndex: 10 }}>
            <strong>Aviso de Replay:</strong> {replayError}
          </div>
        ) : (
          <div
            className="replay-scaler-frame"
            style={{
              width: `${Math.round(viewport.width * currentScale)}px`,
              height: `${Math.round(viewport.height * currentScale)}px`
            }}
          >
            <div className="replay-top-overlay">
              <div className="scale-pill">
                <span>{Math.round(currentScale * 100)}%</span>
              </div>
            </div>

            <div
              ref={containerRef}
              className="replay-frame-wrapper"
              style={{
                width: `${viewport.width}px`,
                height: `${viewport.height}px`,
                transform: `scale(${currentScale})`,
                transformOrigin: 'top left'
              }}
            />
          </div>
        )}
      </div>

      <div className="player-controls-bar">
        {/* Scrubber Track with Event Markers */}
        <div className="scrubber-track-container" title="Clique ou arraste para buscar no tempo">
          <div className="scrubber-track-bg">
            <div
              className="scrubber-fill"
              style={{ width: `${Math.min(100, Math.max(0, (currentOffsetMs / totalDurationMs) * 100))}%` }}
            >
              <div className="scrubber-thumb-indicator" />
            </div>

            {/* Milestones / Markers on track */}
            {timelineEvents && timelineEvents.map((evt, idx) => {
              const evtOffset = evt.timestamp - startedAt;
              if (evtOffset < 0 || evtOffset > totalDurationMs) return null;
              const pct = (evtOffset / totalDurationMs) * 100;
              const isNetworkError =
                evt.type === 'network' && (evt.result === 'error' || evt.status >= 400 || evt.status === 0);
              const markerClass =
                isNetworkError ? 'marker-error' :
                evt.type === 'network' ? 'marker-network' :
                evt.type === 'error' ? 'marker-error' :
                evt.type === 'console' ? (evt.level === 'error' ? 'marker-error' : 'marker-console') :
                evt.type === 'navigation' ? 'marker-navigation' : 'marker-generic';

              const titleText =
                evt.type === 'network' ? `Network: ${evt.method} ${evt.url} (${evt.status === 0 ? 'CORS / ERR' : evt.status})` :
                evt.type === 'error' ? `Error: ${evt.name}: ${evt.message}` :
                evt.type === 'console' ? `Console [${evt.level}]: ${evt.args.join(' ')}` :
                evt.type === 'navigation' ? `Nav: ${evt.toUrl}` : `Event: ${evt.type}`;

              return (
                <span
                  key={evt.id || idx}
                  className={`milestone-marker ${markerClass}`}
                  style={{ left: `${pct}%` }}
                  title={titleText}
                  onClick={(e) => {
                    e.stopPropagation();
                    seekTo(evtOffset);
                  }}
                />
              );
            })}
          </div>

          <input
            type="range"
            className="seek-slider-overlay"
            min={0}
            max={totalDurationMs}
            step={1000}
            value={currentOffsetMs}
            onChange={handleSliderChange}
            aria-label="Posição do replay"
          />
        </div>

        {/* Controls Toolbar Row */}
        <div className="controls-toolbar">
          <div className="controls-left-group">
            <button
              type="button"
              className="btn-play-pause"
              onClick={togglePlay}
              aria-label={isPlaying ? 'Pausar replay' : 'Reproduzir replay'}
              title={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                  <span>Pausar</span>
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                  <span>Play</span>
                </>
              )}
            </button>

            {/* Pulos de tempo segundo a segundo */}
            <div className="step-buttons-group">
              <button
                type="button"
                className="btn-step"
                onClick={() => handleStepSeconds(-5)}
                aria-label="Voltar 5 segundos"
                title="Voltar 5 segundos"
              >
                -5s
              </button>
              <button
                type="button"
                className="btn-step"
                onClick={() => handleStepSeconds(-1)}
                aria-label="Voltar 1 segundo"
                title="Voltar 1 segundo"
              >
                -1s
              </button>
              <div className="step-divider" aria-hidden="true" />
              <button
                type="button"
                className="btn-step"
                onClick={() => handleStepSeconds(1)}
                aria-label="Avançar 1 segundo"
                title="Avançar 1 segundo"
              >
                +1s
              </button>
              <button
                type="button"
                className="btn-step"
                onClick={() => handleStepSeconds(5)}
                aria-label="Avançar 5 segundos"
                title="Avançar 5 segundos"
              >
                +5s
              </button>
            </div>

            <div className="time-display">
              <span className="time-current">{formatTime(currentOffsetMs)}</span>
              <span className="time-divider">/</span>
              <span className="time-total">{formatTime(totalDurationMs)}</span>
            </div>
          </div>

          <div className="controls-right-group">
            <div className="control-item">
              <label htmlFor="speed-select" className="control-label">
                Vel:
              </label>
              <select
                id="speed-select"
                className="control-select"
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Velocidade de reprodução"
              >
                <option value={0.5}>0.5x</option>
                <option value={1}>1.0x</option>
                <option value={2}>2.0x</option>
                <option value={4}>4.0x</option>
              </select>
            </div>

            <div className="control-item">
              <label htmlFor="zoom-select" className="control-label">
                Zoom:
              </label>
              <select
                id="zoom-select"
                className="control-select"
                value={zoomMode}
                onChange={(e) => setZoomMode(e.target.value as ZoomMode)}
                aria-label="Controle de Zoom"
              >
                <option value="auto">Ajustar ({Math.round(autoScale * 100)}%)</option>
                <option value="1.0">100%</option>
                <option value="0.75">75%</option>
                <option value="0.5">50%</option>
                <option value="0.33">33%</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
