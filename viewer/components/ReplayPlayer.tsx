import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Replayer } from '@rrweb/replay';
import '@rrweb/replay/dist/style.css';
import type { RrwebEvent } from '../../src/types/chunk';
import type { TimelineEvent } from '../../src/types/timeline';
import { isValidAnnotationImage } from '../../src/validation/validate';

function isExternalUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('http:') ||
    trimmed.startsWith('https:') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('file:')
  );
}

function sanitizeCssUrls(css: string): string {
  return css.replace(/url\(\s*['"]?\s*(?:https?:|\/\/)[^'")]+['"]?\s*\)/gi, 'none');
}

function sanitizeNode(node: Record<string, unknown>): void {
  if (typeof node.tagName === 'string') {
    const tag = node.tagName.toLowerCase();
    if (tag === 'script') {
      node.childNodes = [];
      if (node.attributes && typeof node.attributes === 'object') {
        (node.attributes as Record<string, unknown>).src = '';
      }
    }
  }

  if (node.attributes && typeof node.attributes === 'object') {
    const attrs = node.attributes as Record<string, unknown>;
    for (const key of Object.keys(attrs)) {
      if (key.toLowerCase().startsWith('on')) {
        delete attrs[key];
      }
    }

    if (typeof attrs.src === 'string' && isExternalUrl(attrs.src)) {
      attrs.src = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%221%22%20height%3D%221%22%2F%3E';
    }
    if (typeof attrs.srcset === 'string' && isExternalUrl(attrs.srcset)) {
      attrs.srcset = '';
    }
    if (typeof attrs.poster === 'string' && isExternalUrl(attrs.poster)) {
      attrs.poster = '';
    }
    if (typeof attrs.href === 'string' && isExternalUrl(attrs.href)) {
      attrs.href = '#';
    }
    if (typeof attrs.style === 'string') {
      attrs.style = sanitizeCssUrls(attrs.style);
    }
  }

  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      if (child && typeof child === 'object') {
        sanitizeNode(child as Record<string, unknown>);
      }
    }
  }
}

export function sanitizeReplayEvents(events: unknown[]): unknown[] {
  if (!Array.isArray(events)) return [];
  return events.map((event) => {
    if (!event || typeof event !== 'object') return event;
    const evt = event as Record<string, unknown>;
    if (!evt.data || typeof evt.data !== 'object') return event;

    const data = evt.data as Record<string, unknown>;
    if (evt.type === 2 && data.node && typeof data.node === 'object') {
      const clonedNode = JSON.parse(JSON.stringify(data.node));
      sanitizeNode(clonedNode);
      return { ...evt, data: { ...data, node: clonedNode } };
    }

    if (evt.type === 3 && Array.isArray(data.adds)) {
      const clonedAdds = JSON.parse(JSON.stringify(data.adds));
      for (const add of clonedAdds) {
        if (add && typeof add === 'object' && (add as Record<string, unknown>).node) {
          sanitizeNode((add as Record<string, unknown>).node as Record<string, unknown>);
        }
      }
      return { ...evt, data: { ...data, adds: clonedAdds } };
    }

    return event;
  });
}

interface ReplayPlayerProps {
  events: RrwebEvent[];
  startedAt: number;
  finalizedAt: number;
  triggeredAt?: number;
  currentTimeMs: number;
  onSeek: (timeMs: number) => void;
  timelineEvents?: TimelineEvent[];
  annotationImage?: string;
  notes?: string;
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
  triggeredAt,
  currentTimeMs,
  onSeek,
  timelineEvents,
  annotationImage,
  notes
}) => {
  const outerContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const replayerRef = useRef<Replayer | null>(null);
  const lastAppliedOffsetRef = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('auto');
  const [replayError, setReplayError] = useState<string | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [tickerOffsetMs, setTickerOffsetMs] = useState<number | null>(null);
  const [allowCanvasReplay, setAllowCanvasReplay] = useState(false);

  const safeAnnotationImage = useMemo(() => {
    return annotationImage && isValidAnnotationImage(annotationImage) ? annotationImage : undefined;
  }, [annotationImage]);

  const totalDurationMs = Math.max(1000, finalizedAt - startedAt);
  const viewport = getViewportDimensions(events);

  // Lista ordenada de timestamps de eventos únicos para avanço/recuo de 1 em 1 frame
  const sortedEventOffsets = React.useMemo(() => {
    if (!events || events.length === 0) return [];
    const set = new Set<number>();
    for (const ev of events) {
      const offset = ev.timestamp - startedAt;
      if (offset >= 0 && offset <= totalDurationMs) {
        set.add(offset);
      }
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [events, startedAt, totalDurationMs]);

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

      const safeEvents = sanitizeReplayEvents(events);

      const replayer = new Replayer(
        safeEvents as unknown as ConstructorParameters<typeof Replayer>[0],
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
          UNSAFE_replayCanvas: allowCanvasReplay
        } as unknown as ConstructorParameters<typeof Replayer>[1]
      );

      replayerRef.current = replayer;

      // Injeta CSP no iframe do replay para bloquear imagens, fontes, mídias e conexões externas
      const iframe = containerRef.current.querySelector('iframe');
      if (iframe && iframe.contentDocument) {
        try {
          const meta = iframe.contentDocument.createElement('meta');
          meta.httpEquiv = 'Content-Security-Policy';
          meta.content =
            "default-src 'none'; img-src data: blob:; font-src data:; media-src data: blob:; style-src 'unsafe-inline' data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none';";
          iframe.contentDocument.head?.prepend(meta);
        } catch {
          // Noop caso o iframe esteja inacessível em modo sandbox restrito
        }
      }

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
  }, [events, allowCanvasReplay]);

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
      if (lastAppliedOffsetRef.current === offsetMs) {
        return;
      }
      lastAppliedOffsetRef.current = offsetMs;
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
      lastAppliedOffsetRef.current = currentReplayTime;
      setTickerOffsetMs(currentReplayTime);
      onSeek(startedAt + currentReplayTime);

      if (currentReplayTime >= totalDurationMs) {
        setIsPlaying(false);
        replayerRef.current.pause(totalDurationMs);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isPlaying, onSeek, startedAt, totalDurationMs]);

  // Seek direto com reconstrução imediata do frame de vídeo
  const seekTo = useCallback(
    (offsetMs: number, forcePause = false) => {
      const clamped = Math.max(0, Math.min(totalDurationMs, offsetMs));
      lastAppliedOffsetRef.current = clamped;
      setTickerOffsetMs(clamped);
      onSeek(startedAt + clamped);

      const willPlay = forcePause ? false : isPlaying;
      if (forcePause && isPlaying) {
        setIsPlaying(false);
      }

      if (replayerRef.current) {
        try {
          if (willPlay) {
            replayerRef.current.play(clamped);
          } else {
            // Em estado pausado, força o rrweb a reconstruir o DOM e exibir o frame imediatamente
            replayerRef.current.pause(clamped);
          }
        } catch {
          // Ignora limitações de happy-dom / jsdom durante testes unitários
        }
      }
    },
    [isPlaying, onSeek, startedAt, totalDurationMs]
  );

  const togglePlay = useCallback(() => {
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
  }, [isPlaying, tickerOffsetMs, currentTimeMs, startedAt, totalDurationMs, seekTo]);

  // Avança ou recua exatamente 1 frame (evento de mutação / interação gravado)
  const handleStepFrame = useCallback(
    (direction: -1 | 1) => {
      const currentOffset = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);

      if (isPlaying && replayerRef.current) {
        replayerRef.current.pause();
        setIsPlaying(false);
      }

      let targetOffset: number;
      if (direction === 1) {
        // Encontra o próximo timestamp de evento gravado após a posição atual
        const next = sortedEventOffsets.find((t) => t > currentOffset + 15);
        if (next !== undefined) {
          targetOffset = next;
        } else {
          targetOffset = Math.min(totalDurationMs, currentOffset + 33);
        }
      } else {
        // Encontra o último timestamp de evento gravado antes da posição atual
        const prev = [...sortedEventOffsets].reverse().find((t) => t < currentOffset - 15);
        if (prev !== undefined) {
          targetOffset = prev;
        } else {
          targetOffset = Math.max(0, currentOffset - 33);
        }
      }

      seekTo(targetOffset);
    },
    [tickerOffsetMs, currentTimeMs, startedAt, isPlaying, sortedEventOffsets, seekTo, totalDurationMs]
  );

  const handleStepSeconds = (deltaSeconds: number) => {
    const currentOffset = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);
    seekTo(currentOffset + deltaSeconds * 1000);
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newOffset = Number(e.target.value);
    seekTo(newOffset);
  };

  // Identifica todos os erros reais da timeline (erros JS, rede 4xx/5xx/CORS, console.error)
  const errorEvents = React.useMemo(() => {
    if (!timelineEvents) return [];
    return timelineEvents
      .filter(
        (e) =>
          e.type === 'error' ||
          (e.type === 'network' && (e.result === 'error' || (e.status !== undefined && (e.status >= 400 || e.status === 0)))) ||
          (e.type === 'console' && e.level === 'error')
      )
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [timelineEvents]);

  const [jumpFeedback, setJumpFeedback] = useState<string | null>(null);

  // Calcula o offset padrão do momento do erro
  const errorOffsetMs = React.useMemo(() => {
    // 1. Prioridade máxima: primeiro erro real registrado na timeline
    if (errorEvents.length > 0) {
      return Math.max(0, Math.min(totalDurationMs, errorEvents[0].timestamp - startedAt));
    }
    // 2. Segunda prioridade: se disparado por gatilho automático de erro antes do término
    if (triggeredAt && triggeredAt >= startedAt && triggeredAt < finalizedAt) {
      return Math.max(0, Math.min(totalDurationMs, triggeredAt - startedAt));
    }
    // 3. Fallback: momento do trigger ou término da gravação
    if (triggeredAt && triggeredAt >= startedAt) {
      return Math.max(0, Math.min(totalDurationMs, triggeredAt - startedAt));
    }
    return Math.min(totalDurationMs, Math.max(0, finalizedAt - startedAt));
  }, [errorEvents, totalDurationMs, startedAt, triggeredAt, finalizedAt]);

  const handleJumpToError = useCallback(() => {
    if (replayerRef.current) {
      try {
        replayerRef.current.pause();
      } catch {
        // Noop
      }
    }
    setIsPlaying(false);

    if (errorEvents.length > 0) {
      const currentOffset = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);
      // Pula para o próximo erro após a posição atual; se estiver no fim ou só tiver 1, vai para o primeiro
      const nextIdx = errorEvents.findIndex((e) => e.timestamp - startedAt > currentOffset + 300);
      const targetIdx = nextIdx !== -1 ? nextIdx : 0;
      const targetEvt = errorEvents[targetIdx];
      const targetOffset = Math.max(0, Math.min(totalDurationMs, targetEvt.timestamp - startedAt));

      seekTo(targetOffset, true);

      const desc =
        targetEvt.type === 'error'
          ? `${targetEvt.name}: ${targetEvt.message}`
          : targetEvt.type === 'network'
          ? `${targetEvt.method} ${targetEvt.url} (${targetEvt.status === 0 ? 'ERR' : targetEvt.status})`
          : targetEvt.type === 'console'
          ? targetEvt.args.join(' ')
          : 'Erro registrado';

      setJumpFeedback(
        errorEvents.length > 1
          ? `Erro ${targetIdx + 1} de ${errorEvents.length}: ${desc.slice(0, 35)}`
          : `Erro: ${desc.slice(0, 38)}`
      );
      setTimeout(() => setJumpFeedback(null), 3500);
    } else {
      seekTo(errorOffsetMs, true);
      setJumpFeedback('Nenhum erro de código ou rede detectado no log');
      setTimeout(() => setJumpFeedback(null), 3500);
    }
  }, [errorEvents, tickerOffsetMs, currentTimeMs, startedAt, totalDurationMs, seekTo, errorOffsetMs]);

  // Estado e manipuladores para o Tooltip flutuante de visualização na barra de progresso (Scrubber)
  const [hoverPosition, setHoverPosition] = useState<{
    percent: number;
    offsetMs: number;
    event?: TimelineEvent;
  } | null>(null);

  const handleScrubberMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const pct = (x / rect.width) * 100;
      const offsetMs = Math.round((pct / 100) * totalDurationMs);
      const hoverTime = startedAt + offsetMs;

      let nearestEvent: TimelineEvent | undefined;
      let minDiff = 1500;
      if (timelineEvents) {
        for (const ev of timelineEvents) {
          const diff = Math.abs(ev.timestamp - hoverTime);
          if (diff < minDiff) {
            minDiff = diff;
            nearestEvent = ev;
          }
        }
      }

      setHoverPosition({
        percent: pct,
        offsetMs,
        event: nearestEvent
      });
    },
    [totalDurationMs, startedAt, timelineEvents]
  );

  const handleScrubberMouseLeave = useCallback(() => {
    setHoverPosition(null);
  }, []);

  // Atalhos de teclado: Setas ou vírgula/ponto para passar frames, Espaço para play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        handleStepFrame(1);
      } else if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        handleStepFrame(-1);
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleStepFrame, togglePlay]);

  const formatTime = (ms: number) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    const millis = Math.floor((ms % 1000) / 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(2, '0')}`;
  };

  const currentOffsetMs = tickerOffsetMs ?? Math.max(0, currentTimeMs - startedAt);
  const triggerOffsetMs = Math.max(0, (triggeredAt || finalizedAt) - startedAt);
  // Anotação é visível apenas na tela/momento exato do incidente (a partir de 1.5s antes do trigger até o final)
  const isAtAnnotationTime = currentOffsetMs >= Math.max(0, triggerOffsetMs - 1500);

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
              {notes && isAtAnnotationTime && (
                <div
                  className="qa-note-pill"
                  title="Anotação registrada pelo QA"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '3px 9px',
                    borderRadius: '4px',
                    background: 'rgba(15, 23, 42, 0.92)',
                    border: '1px solid #3b82f6',
                    color: '#f8fafc',
                    fontSize: '11px',
                    fontWeight: 500,
                    maxWidth: '400px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)'
                  }}
                >
                  <span style={{ color: '#60a5fa', fontWeight: 700 }}>QA:</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{notes}</span>
                </div>
              )}
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

            {/* Camada de Anotação Visual do QA (réguas, setas, desenhos) - exibida automaticamente no momento da anotação */}
            {safeAnnotationImage && isAtAnnotationTime && (
              <img
                src={safeAnnotationImage}
                alt="Anotações do QA sobre o Replay"
                className="replay-annotation-overlay-layer"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${viewport.width}px`,
                  height: `${viewport.height}px`,
                  transform: `scale(${currentScale})`,
                  transformOrigin: 'top left',
                  pointerEvents: 'none',
                  zIndex: 25,
                  objectFit: 'contain'
                }}
              />
            )}
          </div>
        )}
      </div>

      <div className="player-controls-bar">
        {/* Scrubber Track with Event Markers & Floating Hover Tooltip */}
        <div
          className="scrubber-track-container"
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={handleScrubberMouseLeave}
        >
          {/* Floating Hover Tooltip que acompanha o mouse ao longo da barra */}
          {hoverPosition && (
            <div
              className="scrubber-hover-tooltip"
              style={{ left: `${hoverPosition.percent}%` }}
              role="tooltip"
            >
              <span className="tooltip-time">{formatTime(hoverPosition.offsetMs)}</span>
              {hoverPosition.event && (
                <span
                  className={`tooltip-event ${
                    hoverPosition.event.type === 'error' ||
                    (hoverPosition.event.type === 'network' &&
                      (hoverPosition.event.result === 'error' ||
                        (hoverPosition.event.status !== undefined &&
                          (hoverPosition.event.status >= 400 || hoverPosition.event.status === 0)))) ||
                    (hoverPosition.event.type === 'console' && hoverPosition.event.level === 'error')
                      ? 'is-error'
                      : ''
                  }`}
                >
                  {hoverPosition.event.type === 'error'
                    ? `${hoverPosition.event.name}: ${hoverPosition.event.message}`
                    : hoverPosition.event.type === 'network'
                    ? `${hoverPosition.event.method} ${hoverPosition.event.url} (${hoverPosition.event.status === 0 ? 'ERR' : hoverPosition.event.status})`
                    : hoverPosition.event.type === 'console'
                    ? `[${hoverPosition.event.level}] ${hoverPosition.event.args.join(' ')}`
                    : hoverPosition.event.type === 'navigation'
                    ? `→ ${hoverPosition.event.toUrl}`
                    : hoverPosition.event.type}
                </span>
              )}
            </div>
          )}

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
            step={10}
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
              title={isPlaying ? 'Pausar (Espaço)' : 'Reproduzir (Espaço)'}
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

            {/* Pular direto para o erro */}
            <button
              type="button"
              className={`btn-jump-error ${errorEvents.length === 0 ? 'is-no-error' : ''}`}
              onClick={handleJumpToError}
              aria-label="Pular para o momento do erro"
              title={
                errorEvents.length > 0
                  ? `Ir direto para o momento do erro (${errorEvents.length} erro${errorEvents.length > 1 ? 's' : ''} detectado${errorEvents.length > 1 ? 's' : ''})`
                  : `Ir direto para o momento do erro (${formatTime(errorOffsetMs)})`
              }
            >
              <span>Erros</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="4" y1="12" x2="20" y2="12" />
                <polyline points="14 6 20 12 14 18" />
              </svg>
            </button>

            {/* Feedback toast de salto para erro */}
            {jumpFeedback && (
              <span className="jump-feedback-toast" role="status">
                {jumpFeedback}
              </span>
            )}

            {/* Pulos de tempo e frames */}
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
              <button
                type="button"
                className="btn-step btn-step-frame"
                onClick={() => handleStepFrame(-1)}
                aria-label="Voltar 1 frame"
                title="Voltar 1 frame (atalho: Seta Esquerda ou vírgula)"
              >
                ◄ Frame
              </button>
              <div className="step-divider" aria-hidden="true" />
              <button
                type="button"
                className="btn-step btn-step-frame"
                onClick={() => handleStepFrame(1)}
                aria-label="Avançar 1 frame"
                title="Avançar 1 frame (atalho: Seta Direita ou ponto)"
              >
                Frame ►
              </button>
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
            <div
              className="control-item"
              title="Permitir canvas somente para gravações confiáveis (risco de execução de scripts de renderização)"
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '11px',
                  color: allowCanvasReplay ? '#60a5fa' : '#94a3b8',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}
              >
                <input
                  type="checkbox"
                  checked={allowCanvasReplay}
                  onChange={(e) => setAllowCanvasReplay(e.target.checked)}
                  aria-label="Permitir canvas somente para gravações confiáveis"
                />
                <span>Canvas Confiável</span>
              </label>
            </div>

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
