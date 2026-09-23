import type { FlightRecorderArtifactV1 } from '../types/artifact';
import type {
  ConsoleTimelineEvent,
  ErrorTimelineEvent,
  NavigationTimelineEvent,
  NetworkTimelineEvent
} from '../types/timeline';

export interface MarkdownFormatOptions {
  replayUrl?: string;
  maxBreadcrumbs?: number;
}

/**
 * Gera um resumo formatado em Markdown para debug (estilo Sentry)
 * pronto para ser colado em IAs (Gemini, Claude, ChatGPT), Jira ou GitHub Issues.
 * Sem emojis, com breadcrumbs, stack traces e contexto completo.
 */
export function formatIncidentMarkdown(
  artifact: FlightRecorderArtifactV1,
  options?: MarkdownFormatOptions
): string {
  const errors = artifact.timeline.filter((e): e is ErrorTimelineEvent => e.type === 'error');
  const networks = artifact.timeline.filter((e): e is NetworkTimelineEvent => e.type === 'network');
  const failedNetworks = networks.filter((n) => n.status >= 400 || n.result !== 'success');
  const dateStr = new Date(artifact.incident.triggeredAt).toLocaleString('pt-BR');

  const lines = [
    '### Relatório de Debug — Backtrack',
    '',
    '#### Contexto do Incidente',
    `- **ID:** \`${artifact.incident.id}\``,
    `- **Data/Hora:** ${dateStr}`,
    `- **Motivo do Gatilho:** \`${artifact.incident.reason}\``,
    `- **URL:** ${artifact.environment.url}`,
    `- **Resolução de Tela:** ${artifact.environment.viewport.width}x${artifact.environment.viewport.height}`,
    `- **Navegador:** \`${artifact.environment.userAgent}\``
  ];

  if (artifact.environment.appVersion) {
    lines.push(`- **Versão do App:** \`${artifact.environment.appVersion}\``);
  }
  if (artifact.environment.gitCommit) {
    lines.push(`- **Git Commit:** \`${artifact.environment.gitCommit}\``);
  }
  if (options?.replayUrl) {
    lines.push(`- **Replay do Incidente:** [Assistir Gravação](${options.replayUrl})`);
  }

  // Seção de Erros & Exceções (Estilo Sentry)
  lines.push('', '#### Exceções e Erros de Runtime');
  if (errors.length > 0) {
    errors.forEach((err, idx) => {
      lines.push(`- **Erro ${idx + 1}:** \`${err.name}: ${err.message}\``);
      if (err.filename) {
        lines.push(`  - Local: \`${err.filename}:${err.lineno ?? 0}:${err.colno ?? 0}\` (Origem: \`${err.source}\`)`);
      }
      if (err.stack) {
        lines.push('  ```text');
        lines.push(err.stack.trim());
        lines.push('  ```');
      }
      if (err.componentStack) {
        lines.push('  *Component Stack:*');
        lines.push('  ```text');
        lines.push(err.componentStack.trim());
        lines.push('  ```');
      }
    });
  } else {
    lines.push('- **Erros:** Nenhum erro de runtime não tratado registrado');
  }

  // Seção de Breadcrumbs (Últimos eventos cronológicos estilo Sentry)
  const maxEvents = options?.maxBreadcrumbs ?? 15;
  const recentEvents = artifact.timeline.slice(-maxEvents);
  if (recentEvents.length > 0) {
    lines.push('', '#### Breadcrumbs (Últimos eventos da sessão)');
    const baseTime = artifact.incident.startedAt || recentEvents[0].timestamp;

    recentEvents.forEach((ev) => {
      const offsetMs = Math.max(0, ev.timestamp - baseTime);
      const totalSec = Math.floor(offsetMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      const timeStr = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`;

      if (ev.type === 'navigation') {
        const nav = ev as NavigationTimelineEvent;
        lines.push(
          `- ${timeStr} [Navegacao] ${nav.fromUrl ? `${nav.fromUrl} -> ` : ''}${nav.toUrl} (${nav.kind})`
        );
      } else if (ev.type === 'console') {
        const con = ev as ConsoleTimelineEvent;
        const formattedArgs = con.args
          .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' ');
        lines.push(`- ${timeStr} [Console:${con.level}] ${formattedArgs}`);
      } else if (ev.type === 'network') {
        const net = ev as NetworkTimelineEvent;
        const statusStr = net.status > 0 ? `Status: ${net.status}` : `Resultado: ${net.result}`;
        lines.push(`- ${timeStr} [Rede] ${net.method} ${net.url} (${statusStr}, ${net.durationMs}ms)`);
      } else if (ev.type === 'error') {
        const err = ev as ErrorTimelineEvent;
        lines.push(`- ${timeStr} [Erro] ${err.name}: ${err.message}`);
      } else if (ev.type === 'performance') {
        lines.push(`- ${timeStr} [Performance] ${ev.metric} (${ev.durationMs}ms)`);
      } else if (ev.type === 'marker') {
        lines.push(`- ${timeStr} [Marcador] ${ev.label}`);
      }
    });
  }

  // Seção de Falhas de Rede
  lines.push('', '#### Falhas de Rede (HTTP 4xx / 5xx)');
  if (failedNetworks.length > 0) {
    failedNetworks.forEach((net) => {
      lines.push(
        `- \`${net.method} ${net.url}\` (Status: ${net.status}, ${net.durationMs}ms)`
      );
      if (net.responseBody) {
        const trimmed = net.responseBody.length > 300 ? `${net.responseBody.slice(0, 300)}...` : net.responseBody;
        lines.push(`  - Resposta: \`${trimmed}\``);
      }
    });
  } else {
    lines.push('- **Falhas de Rede:** Nenhuma requisição HTTP 4xx/5xx');
  }

  // Anotações do QA / Observações
  const triggerNotes = artifact.incident.triggers?.find((t) => t.detail?.notes)?.detail?.notes as string | undefined;
  const notes = (artifact.incident.annotations?.notes as string) || triggerNotes;

  let timeLabel = '';
  if (artifact.incident.startedAt && (artifact.incident.triggeredAt || artifact.incident.finalizedAt)) {
    const offsetMs = Math.max(
      0,
      (artifact.incident.triggeredAt || artifact.incident.finalizedAt) - artifact.incident.startedAt
    );
    const offsetSeconds = Math.floor(offsetMs / 1000);
    const mins = Math.floor(offsetSeconds / 60);
    const secs = offsetSeconds % 60;
    timeLabel = `[${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}] `;
  }

  if (artifact.incident.annotationImage || notes) {
    lines.push('', '#### Anotações do QA / Observações');
    if (notes) {
      lines.push(`- **Anotações do QA:** ${timeLabel}\`${notes}\``);
    } else {
      lines.push(`- **Anotações do QA:** ${timeLabel}Anotação visual gravada no artefato`);
    }
  }

  lines.push('', '*Gerado automaticamente pelo Backtrack.*');

  return lines.join('\n');
}
