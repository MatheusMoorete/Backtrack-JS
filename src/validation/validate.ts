import type {
  FlightRecorderArtifactV1,
  IncidentReason,
  TimelineEvent,
  TimelineEventType
} from '../types';

export interface ValidationSuccess {
  success: true;
  data: FlightRecorderArtifactV1;
}

export interface ValidationFailure {
  success: false;
  errors: string[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;

const VALID_INCIDENT_REASONS: ReadonlySet<IncidentReason> = new Set([
  'manual',
  'error',
  'unhandledrejection',
  'react',
  'http'
]);

const VALID_TIMELINE_TYPES: ReadonlySet<TimelineEventType> = new Set([
  'console',
  'error',
  'network',
  'navigation',
  'marker',
  'performance'
]);

/**
 * Valida a integridade e o schema de um artefato .ffr.json do Flight Recorder.
 * Rejeita formatos incompatíveis, campos ausentes ou tipos inválidos.
 */
export function validateFlightRecorderArtifact(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') {
    return { success: false, errors: ['O artefato deve ser um objeto JSON válido.'] };
  }

  const obj = input as Record<string, unknown>;

  // 1. formatVersion
  if (obj.formatVersion !== 1) {
    errors.push(
      `Versão do formato desconhecida ou ausente: ${String(obj.formatVersion)}. A v0.1 suporta apenas formatVersion 1.`
    );
  }

  // 2. recorderVersion
  if (typeof obj.recorderVersion !== 'string' || obj.recorderVersion.trim() === '') {
    errors.push('Campo obrigatório ausente ou inválido: "recorderVersion" (string esperada).');
  }

  // 3. incident
  if (!obj.incident || typeof obj.incident !== 'object') {
    errors.push('Campo obrigatório ausente ou inválido: "incident" (objeto esperado).');
  } else {
    const inc = obj.incident as Record<string, unknown>;
    if (typeof inc.id !== 'string' || inc.id.trim() === '') {
      errors.push('Campo obrigatório ausente ou inválido em incident: "id".');
    }
    if (!VALID_INCIDENT_REASONS.has(inc.reason as IncidentReason)) {
      errors.push(`Razão do incidente inválida: "${String(inc.reason)}".`);
    }
    if (!Array.isArray(inc.triggers)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "triggers" (array esperado).');
    }
    if (typeof inc.startedAt !== 'number' || isNaN(inc.startedAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "startedAt" (número esperado).');
    }
    if (typeof inc.triggeredAt !== 'number' || isNaN(inc.triggeredAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "triggeredAt" (número esperado).');
    }
    if (typeof inc.finalizedAt !== 'number' || isNaN(inc.finalizedAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "finalizedAt" (número esperado).');
    }
  }

  // 4. environment
  if (!obj.environment || typeof obj.environment !== 'object') {
    errors.push('Campo obrigatório ausente ou inválido: "environment" (objeto esperado).');
  } else {
    const env = obj.environment as Record<string, unknown>;
    if (typeof env.url !== 'string') {
      errors.push('Campo obrigatório ausente ou inválido em environment: "url".');
    }
    if (typeof env.userAgent !== 'string') {
      errors.push('Campo obrigatório ausente ou inválido em environment: "userAgent".');
    }
    if (!env.viewport || typeof env.viewport !== 'object') {
      errors.push('Campo obrigatório ausente ou inválido em environment: "viewport".');
    } else {
      const vp = env.viewport as Record<string, unknown>;
      if (typeof vp.width !== 'number' || typeof vp.height !== 'number') {
        errors.push('Dimensões da viewport inválidas (width e height numéricos esperados).');
      }
    }
  }

  // 5. timeline
  if (!Array.isArray(obj.timeline)) {
    errors.push('Campo obrigatório ausente ou inválido: "timeline" (array esperado).');
  } else {
    let prevTimestamp = -Infinity;
    let prevSequence = -Infinity;

    for (let i = 0; i < obj.timeline.length; i++) {
      const item = obj.timeline[i];
      if (!item || typeof item !== 'object') {
        errors.push(`Evento da timeline no índice ${i} deve ser um objeto.`);
        continue;
      }

      const evt = item as Record<string, unknown>;
      if (typeof evt.id !== 'string') {
        errors.push(`Evento da timeline no índice ${i} não possui "id" válido.`);
      }
      if (typeof evt.timestamp !== 'number' || isNaN(evt.timestamp)) {
        errors.push(`Evento da timeline no índice ${i} não possui "timestamp" válido.`);
      }
      if (typeof evt.sequence !== 'number' || isNaN(evt.sequence)) {
        errors.push(`Evento da timeline no índice ${i} não possui "sequence" válido.`);
      }
      if (!VALID_TIMELINE_TYPES.has(evt.type as TimelineEventType)) {
        errors.push(`Evento da timeline no índice ${i} possui tipo desconhecido: "${String(evt.type)}".`);
      }

      // Verificação de ordenação estável (timestamp crescente, sequence crescente para empates)
      if (typeof evt.timestamp === 'number' && typeof evt.sequence === 'number') {
        if (evt.timestamp < prevTimestamp) {
          errors.push(
            `Timeline fora de ordem cronológica no índice ${i}: timestamp ${evt.timestamp} < ${prevTimestamp}.`
          );
        } else if (evt.timestamp === prevTimestamp && evt.sequence < prevSequence) {
          errors.push(
            `Timeline com sequência fora de ordem no índice ${i}: sequence ${evt.sequence} < ${prevSequence} para o mesmo timestamp.`
          );
        }
        prevTimestamp = evt.timestamp;
        prevSequence = evt.sequence;
      }
    }
  }

  // 6. replay
  if (!Array.isArray(obj.replay)) {
    errors.push('Campo obrigatório ausente ou inválido: "replay" (array esperado).');
  }

  // 7. diagnostics
  if (!obj.diagnostics || typeof obj.diagnostics !== 'object') {
    errors.push('Campo obrigatório ausente ou inválido: "diagnostics" (objeto esperado).');
  } else {
    const diag = obj.diagnostics as Record<string, unknown>;
    if (typeof diag.droppedEvents !== 'number') {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "droppedEvents".');
    }
    if (typeof diag.storageBytes !== 'number') {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "storageBytes".');
    }
    if (typeof diag.degraded !== 'boolean') {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "degraded".');
    }
    if (!Array.isArray(diag.degradedReasons)) {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "degradedReasons" (array esperado).');
    }
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: input as FlightRecorderArtifactV1
  };
}

/**
 * Ordena eventos da timeline por timestamp crescente e sequence crescente.
 */
export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    return a.sequence - b.sequence;
  });
}
