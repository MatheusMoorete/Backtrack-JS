import type { FlightRecorderArtifactV1 } from '../types/artifact';
import type { ErrorTimelineEvent, NetworkTimelineEvent } from '../types/timeline';

/**
 * Gera um resumo formatado em Markdown pronto para ser colado no Jira, GitHub Issues ou Slack.
 */
export function formatIncidentMarkdown(artifact: FlightRecorderArtifactV1): string {
  const errors = artifact.timeline.filter((e): e is ErrorTimelineEvent => e.type === 'error');
  const networks = artifact.timeline.filter((e): e is NetworkTimelineEvent => e.type === 'network');
  const lastError = errors[errors.length - 1];
  const lastFailedNet = [...networks].reverse().find((n) => n.status >= 400 || n.result !== 'success');
  const dateStr = new Date(artifact.incident.triggeredAt).toLocaleString('pt-BR');

  const lines = [
    '### 🚨 Relatório de Incidente — Backtrack',
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

  if (lastError) {
    lines.push(`- **Último Erro:** \`${lastError.name}: ${lastError.message}\``);
  } else {
    lines.push('- **Erros:** Nenhum erro de runtime não tratado registrado');
  }

  if (lastFailedNet) {
    lines.push(
      `- **Última Falha de Rede:** \`${lastFailedNet.method} ${lastFailedNet.url}\` (Status: ${lastFailedNet.status}, ${lastFailedNet.durationMs}ms)`
    );
  } else {
    lines.push('- **Falhas de Rede:** Nenhuma requisição HTTP 4xx/5xx');
  }

  lines.push('', '*Gerado automaticamente pelo Backtrack.*');

  return lines.join('\n');
}
