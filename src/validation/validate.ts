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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Validates the envelope and the minimum rrweb payload before handing it to the player. */
export function isReplayEvent(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.type) ||
    (value.type as number) < 0 ||
    !finite(value.timestamp) ||
    !isRecord(value.data)
  ) {
    return false;
  }
  const data = value.data;
  switch (value.type) {
    case 0:
    case 1:
      return true;
    case 2:
      return isRecord(data.node);
    case 3:
      return Number.isInteger(data.source) && (data.source as number) >= 0;
    case 4:
      return typeof data.href === 'string';
    case 5:
      return typeof data.tag === 'string';
    case 6:
      return typeof data.plugin === 'string';
    default:
      return true;
  }
}

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
    if (typeof inc.startedAt !== 'number' || !Number.isFinite(inc.startedAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "startedAt" (número esperado).');
    }
    if (typeof inc.triggeredAt !== 'number' || !Number.isFinite(inc.triggeredAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "triggeredAt" (número esperado).');
    }
    if (typeof inc.finalizedAt !== 'number' || !Number.isFinite(inc.finalizedAt)) {
      errors.push('Campo obrigatório ausente ou inválido em incident: "finalizedAt" (número esperado).');
    }
  }

  if (isRecord(obj.incident) && finite(obj.incident.startedAt) && finite(obj.incident.finalizedAt) && obj.incident.finalizedAt < obj.incident.startedAt) {
    errors.push('O término do incidente não pode anteceder o início.');
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
      if (!finite(vp.width) || vp.width <= 0 || !finite(vp.height) || vp.height <= 0) {
        errors.push('Dimensões da viewport inválidas (width e height numéricos esperados).');
      }
    }
  }

  // 4.1 replayWindow (opcional)
  if (obj.replayWindow !== undefined) {
    if (!isRecord(obj.replayWindow)) {
      errors.push('Campo inválido em replayWindow: objeto esperado.');
    } else {
      const rw = obj.replayWindow as Record<string, unknown>;
      if (!finite(rw.requestedStartedAt)) {
        errors.push('Campo obrigatório ausente ou inválido em replayWindow: "requestedStartedAt".');
      }
      if (!finite(rw.requestedEndedAt)) {
        errors.push('Campo obrigatório ausente ou inválido em replayWindow: "requestedEndedAt".');
      }
      if (typeof rw.preparationEventCount !== 'number' || rw.preparationEventCount < 0) {
        errors.push('Campo obrigatório ausente ou inválido em replayWindow: "preparationEventCount".');
      }
      if (rw.baseSnapshotOriginalTimestamp !== undefined && !finite(rw.baseSnapshotOriginalTimestamp)) {
        errors.push('Campo inválido em replayWindow: "baseSnapshotOriginalTimestamp" deve ser numérico.');
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
      if (typeof evt.timestamp !== 'number' || !Number.isFinite(evt.timestamp)) {
        errors.push(`Evento da timeline no índice ${i} não possui "timestamp" válido.`);
      }
      if (typeof evt.sequence !== 'number' || !Number.isFinite(evt.sequence)) {
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
  } else {
    let previous = -Infinity;
    for (let i = 0; i < obj.replay.length; i++) {
      const event: unknown = obj.replay[i];
      if (!isReplayEvent(event) || !isRecord(event) || !finite(event.timestamp)) {
        errors.push('Evento de replay inválido no índice ' + i + '.');
        break;
      }
      if (event.timestamp < previous) { errors.push('Replay fora de ordem cronológica.'); break; }
      previous = event.timestamp;
    }
  }

  // 7. diagnostics
  if (!obj.diagnostics || typeof obj.diagnostics !== 'object') {
    errors.push('Campo obrigatório ausente ou inválido: "diagnostics" (objeto esperado).');
  } else {
    const diag = obj.diagnostics as Record<string, unknown>;
    if (!finite(diag.droppedEvents) || diag.droppedEvents < 0) {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "droppedEvents".');
    }
    if (!finite(diag.storageBytes) || diag.storageBytes < 0) {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "storageBytes".');
    }
    if (diag.droppedEventsUnknown !== undefined && typeof diag.droppedEventsUnknown !== 'boolean') {
      errors.push('Indicador de perdas desconhecidas inválido.');
    }
    if (typeof diag.degraded !== 'boolean') {
      errors.push('Campo obrigatório ausente ou inválido em diagnostics: "degraded".');
    }
    if (!Array.isArray(diag.degradedReasons) || !diag.degradedReasons.every((reason) => typeof reason === 'string')) {
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
