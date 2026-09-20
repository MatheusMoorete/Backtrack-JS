import React, { useState, useMemo } from 'react';
import type { TimelineEvent, TimelineEventType } from '../../src/types/timeline';

interface TimelineViewProps {
  events: TimelineEvent[];
  startedAt?: number;
  currentTimeMs: number;
  onSelectEvent: (timestampMs: number) => void;
}

type FilterCategory = 'all' | TimelineEventType;

function formatRelativeOffset(timestampMs: number, startedAt?: number): string {
  if (!startedAt || timestampMs < startedAt) return '+00:00';
  const diffSec = Math.floor((timestampMs - startedAt) / 1000);
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `+${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function isInternalProbeEvent(evt: TimelineEvent): boolean {
  if (evt.type === 'network') {
    return (
      evt.url.includes(':5173') ||
      evt.url.includes('localhost:5173') ||
      evt.url.includes('127.0.0.1:5173') ||
      evt.url.includes('__ffr_')
    );
  }
  return false;
}

export function isErrorTimelineEvent(evt: TimelineEvent): boolean {
  if (isInternalProbeEvent(evt)) return false;
  if (evt.type === 'error') return true;
  if (evt.type === 'console' && evt.level === 'error') return true;
  if (evt.type === 'network' && (evt.result === 'error' || evt.status >= 400 || evt.status === 0)) return true;
  return false;
}

export const TimelineView: React.FC<TimelineViewProps> = ({
  events,
  startedAt,
  currentTimeMs,
  onSelectEvent
}) => {
  const [activeFilter, setActiveFilter] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    let errorCount = 0;
    let networkCount = 0;
    let consoleCount = 0;
    let navigationCount = 0;
    let allCount = 0;

    for (const e of events) {
      if (isInternalProbeEvent(e)) continue;
      allCount++;
      if (isErrorTimelineEvent(e)) {
        errorCount++;
      }
      if (e.type === 'network') {
        networkCount++;
      } else if (e.type === 'console') {
        consoleCount++;
      } else if (e.type === 'navigation') {
        navigationCount++;
      }
    }

    return {
      all: allCount,
      error: errorCount,
      network: networkCount,
      console: consoleCount,
      navigation: navigationCount
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      // Ignora probes internos do próprio visualizador/recorder
      if (isInternalProbeEvent(evt)) {
        return false;
      }
      // 1. Filtro por categoria
      if (activeFilter === 'error') {
        if (!isErrorTimelineEvent(evt)) return false;
      } else if (activeFilter !== 'all' && evt.type !== activeFilter) {
        return false;
      }

      // 2. Filtro por busca textual
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();

      switch (evt.type) {
        case 'console':
          return evt.args.some((a) => (typeof a === 'string' ? a : JSON.stringify(a)).toLowerCase().includes(q));
        case 'error':
          return (
            evt.name.toLowerCase().includes(q) ||
            evt.message.toLowerCase().includes(q) ||
            (evt.stack && evt.stack.toLowerCase().includes(q))
          );
        case 'network': {
          const isCorsOrNetErr =
            (evt.status === 0 || evt.result === 'error') &&
            (q.includes('cors') || q.includes('error') || q.includes('err') || q.includes('fail') || q.includes('rede'));
          return (
            evt.method.toLowerCase().includes(q) ||
            evt.url.toLowerCase().includes(q) ||
            String(evt.status).includes(q) ||
            evt.result.toLowerCase().includes(q) ||
            isCorsOrNetErr
          );
        }
        case 'navigation':
          return (
            evt.kind.toLowerCase().includes(q) ||
            evt.toUrl.toLowerCase().includes(q) ||
            (evt.fromUrl && evt.fromUrl.toLowerCase().includes(q))
          );
        case 'marker':
          return (
            evt.label.toLowerCase().includes(q) ||
            (evt.data && JSON.stringify(evt.data).toLowerCase().includes(q))
          );
        default:
          return false;
      }
    });
  }, [events, activeFilter, searchQuery]);

  const renderBadge = (evt: TimelineEvent) => {
    switch (evt.type) {
      case 'network': {
        const isError = evt.result === 'error' || evt.status >= 500 || evt.status === 0;
        const is4xx = evt.status >= 400 && evt.status < 500;
        const badgeClass = isError ? 'badge-error' : is4xx ? 'badge-warn' : 'badge-neutral';
        const label = evt.status === 0 ? 'CORS / ERR' : evt.status;
        return (
          <span className={`timeline-badge ${badgeClass}`}>
            {evt.method} {label}
          </span>
        );
      }
      case 'error':
        return <span className="timeline-badge badge-error">ERROR</span>;
      case 'console':
        if (evt.level === 'error') {
          return <span className="timeline-badge badge-error">LOG ERROR</span>;
        }
        if (evt.level === 'warn') {
          return <span className="timeline-badge badge-warn">WARN</span>;
        }
        return <span className="timeline-badge badge-neutral">{evt.level.toUpperCase()}</span>;
      case 'navigation':
        return <span className="timeline-badge badge-neutral">NAV</span>;
      case 'marker':
        return <span className="timeline-badge badge-neutral">MARKER</span>;
      default:
        return <span className="timeline-badge badge-neutral">EVENT</span>;
    }
  };

  const renderSummary = (evt: TimelineEvent) => {
    switch (evt.type) {
      case 'network': {
        const isError = evt.result === 'error' || evt.status >= 400 || evt.status === 0;
        const errorSuffix =
          evt.status === 0
            ? ' — [CORS / Network Error]'
            : evt.status >= 400
            ? ` — [HTTP ${evt.status}]`
            : '';
        return (
          <span className={`timeline-summary-text ${isError ? 'is-error' : ''}`} title={evt.url}>
            <strong>{evt.url}</strong>{errorSuffix}
          </span>
        );
      }
      case 'error':
        return (
          <span className="timeline-summary-text is-error" title={`${evt.name}: ${evt.message}`}>
            <strong>{evt.name}:</strong> {evt.message}
          </span>
        );
      case 'console': {
        const isErr = evt.level === 'error';
        return (
          <span className={`timeline-summary-text ${isErr ? 'is-error' : ''}`}>
            {evt.args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}
          </span>
        );
      }
      case 'navigation':
        return (
          <span className="timeline-summary-text" title={evt.toUrl}>
            {evt.fromUrl ? `${evt.fromUrl} → ` : ''}<strong>{evt.toUrl}</strong>
          </span>
        );
      case 'marker':
        return (
          <span className="timeline-summary-text">
            <strong>"{evt.label}"</strong> {evt.data ? JSON.stringify(evt.data) : ''}
          </span>
        );
      default:
        return null;
    }
  };

  const renderStatus = (evt: TimelineEvent) => {
    switch (evt.type) {
      case 'network': {
        const isError = evt.result === 'error' || evt.status === 0 || evt.status >= 500;
        return (
          <span className={`timeline-col-meta ${isError ? 'is-error' : ''}`}>
            {evt.status === 0 ? 'Failed (CORS / Net)' : `${evt.durationMs}ms`}
          </span>
        );
      }
      case 'error':
        return (
          <span className="timeline-col-meta is-error">
            {evt.source}
          </span>
        );
      case 'console':
        if (evt.level === 'error') {
          return (
            <span className="timeline-col-meta is-error">
              error
            </span>
          );
        }
        return null;
      case 'navigation':
        return (
          <span className="timeline-col-meta">
            {evt.kind}
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <aside className="timeline-pane" data-purpose="timeline-feed-column">
      <div className="timeline-header">
        <div className="search-input-wrap">
          <span className="search-icon" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input
            type="search"
            className="timeline-search"
            placeholder="Buscar na timeline (URL, erro, payload)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Buscar na timeline"
          />
        </div>

        <div className="filter-tabs-row" role="group" aria-label="Filtros de categoria">
          {(
            [
              ['all', 'All'],
              ['error', 'Errors'],
              ['network', 'Network'],
              ['console', 'Console'],
              ['navigation', 'Navigation']
            ] as const
          ).map(([key, label]) => {
            const count = counts[key] ?? 0;
            const countClass =
              key === 'error' && count > 0 ? 'tab-count-error' :
              key === 'network' ? 'tab-count-network' : '';
            return (
              <button
                key={key}
                type="button"
                className={`filter-tab filter-btn ${activeFilter === key ? 'active' : ''}`}
                onClick={() => setActiveFilter(key)}
                aria-label={label}
              >
                <span>{label}</span>
                <span className={`tab-count ${countClass}`} aria-hidden="true">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="timeline-list" role="feed" aria-label="Lista de eventos da timeline">
        {filteredEvents.length === 0 ? (
          <div className="timeline-empty-message">
            Nenhum evento encontrado para os filtros selecionados.
          </div>
        ) : (
          filteredEvents.map((evt) => {
            const isClosest = Math.abs(evt.timestamp - currentTimeMs) < 1500;
            const isExpanded = expandedId === evt.id;
            const relativeTime = formatRelativeOffset(evt.timestamp, startedAt);

            return (
              <article
                key={evt.id}
                className={`timeline-item ${isClosest ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`}
                onClick={() => {
                  onSelectEvent(evt.timestamp);
                  setExpandedId(isExpanded ? null : evt.id);
                }}
                role="article"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSelectEvent(evt.timestamp);
                  }
                }}
              >
                <div className="timeline-row-main">
                  <span className="timeline-col-time" title={new Date(evt.timestamp).toISOString()}>
                    {relativeTime}
                  </span>
                  <div className="timeline-col-badge-wrap">
                    {renderBadge(evt)}
                  </div>
                  <div className="timeline-col-summary">
                    {renderSummary(evt)}
                  </div>
                  <div className="timeline-col-status">
                    {renderStatus(evt)}
                  </div>
                </div>

                {/* Detalhes expandidos */}
                {isExpanded && (
                  <div className="timeline-details-panel">
                    {evt.type === 'error' && (
                      <div className="details-block">
                        <div className="details-row"><strong>Mensagem:</strong> {evt.message}</div>
                        {evt.filename && (
                          <div className="details-row">
                            <strong>Local:</strong> {evt.filename}:{evt.lineno}:{evt.colno}
                          </div>
                        )}
                        {evt.stack && (
                          <pre className="details-code details-error-code">{evt.stack}</pre>
                        )}
                      </div>
                    )}
                    {evt.type === 'network' && (
                      <div className="details-block">
                        <div className="details-row">
                          <strong>Método:</strong> {evt.method} | <strong>Status:</strong> {evt.status === 0 ? '0 (CORS / Network Error)' : evt.status} ({evt.result})
                        </div>
                        <div className="details-row">
                          <strong>URL:</strong> <span className="details-url">{evt.url}</span>
                        </div>
                        <div className="details-row">
                          <strong>Duração:</strong> {evt.durationMs}ms
                        </div>
                      </div>
                    )}
                    {evt.type === 'console' && (
                      <div className="details-block">
                        <div className="details-row"><strong>Nível:</strong> {evt.level}</div>
                        <pre className="details-code">{JSON.stringify(evt.args, null, 2)}</pre>
                      </div>
                    )}
                    {evt.type === 'navigation' && (
                      <div className="details-block">
                        <div className="details-row"><strong>Tipo:</strong> {evt.kind}</div>
                        {evt.fromUrl && <div className="details-row"><strong>Origem:</strong> {evt.fromUrl}</div>}
                        <div className="details-row"><strong>Destino:</strong> {evt.toUrl}</div>
                      </div>
                    )}
                    {evt.type === 'marker' && (
                      <div className="details-block">
                        <div className="details-row"><strong>Rótulo:</strong> {evt.label}</div>
                        {evt.data && (
                          <pre className="details-code">{JSON.stringify(evt.data, null, 2)}</pre>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      <div className="timeline-footer">
        <span className="timeline-footer-status">Feed sincronizado com o player</span>
        <span className="timeline-footer-count">
          {filteredEvents.length} de {events.length} logs exibidos
        </span>
      </div>
    </aside>
  );
};
