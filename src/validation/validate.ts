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

const MAX_ANNOTATION_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Valida se annotationImage é estritamente uma imagem data:base64 segura (png, jpeg ou webp),
 * rejeitando http:, https:, javascript:, file: e payloads acima de 10 MB.
 */
export function isValidAnnotationImage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length > MAX_ANNOTATION_IMAGE_BYTES) return false;
  return (
    value.startsWith('data:image/png;base64,') ||
    value.startsWith('data:image/jpeg;base64,') ||
    value.startsWith('data:image/webp;base64,')
  );
}

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
    } else {
      for (let i = 0; i < inc.triggers.length; i++) {
        const trg = inc.triggers[i];
        if (!isRecord(trg)) {
          errors.push(`Gatilho no índice ${i} deve ser um objeto válido.`);
          continue;
        }
        if (!finite(trg.timestamp)) {
          errors.push(`Gatilho no índice ${i} possui "timestamp" inválido.`);
        }
        if (typeof trg.type !== 'string' || trg.type.trim() === '') {
          errors.push(`Gatilho no índice ${i} possui "type" inválido.`);
        }
        if (trg.message !== undefined && typeof trg.message !== 'string') {
          errors.push(`Gatilho no índice ${i} possui "message" inválida.`);
        }
        if (trg.signature !== undefined && typeof trg.signature !== 'string') {
          errors.push(`Gatilho no índice ${i} possui "signature" inválida.`);
        }
        if (trg.source !== undefined && typeof trg.source !== 'string') {
          errors.push(`Gatilho no índice ${i} possui "source" inválido.`);
        }
        if (trg.target !== undefined && typeof trg.target !== 'string') {
          errors.push(`Gatilho no índice ${i} possui "target" inválido.`);
        }
        if (trg.detail !== undefined) {
          if (!isRecord(trg.detail)) {
            errors.push(`Gatilho no índice ${i} possui "detail" inválido (objeto esperado).`);
          } else if (trg.detail.notes !== undefined && typeof trg.detail.notes !== 'string') {
            errors.push(`Gatilho no índice ${i} possui "detail.notes" inválido (string esperada).`);
          }
        }
      }
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
    if (inc.annotationImage !== undefined) {
      if (!isValidAnnotationImage(inc.annotationImage)) {
        errors.push(
          'Campo inválido em incident: "annotationImage" deve ser uma imagem data:base64 segura (png, jpeg ou webp) de até 10 MB.'
        );
      }
    }
    if (inc.annotations !== undefined) {
      if (!isRecord(inc.annotations)) {
        errors.push('Campo inválido em incident: "annotations" (objeto esperado).');
      } else {
        if (inc.annotations.notes !== undefined && typeof inc.annotations.notes !== 'string') {
          errors.push('Campo inválido em incident.annotations: "notes" deve ser uma string.');
        }
        if (inc.annotations.viewport !== undefined) {
          if (
            !isRecord(inc.annotations.viewport) ||
            !finite(inc.annotations.viewport.width) ||
            (inc.annotations.viewport.width as number) <= 0 ||
            !finite(inc.annotations.viewport.height) ||
            (inc.annotations.viewport.height as number) <= 0
          ) {
            errors.push('Campo inválido em incident.annotations: "viewport" inválido.');
          }
        }
      }
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
    if (env.appVersion !== undefined && typeof env.appVersion !== 'string') {
      errors.push('Campo inválido em environment: "appVersion" deve ser uma string.');
    }
    if (env.gitCommit !== undefined && typeof env.gitCommit !== 'string') {
      errors.push('Campo inválido em environment: "gitCommit" deve ser uma string.');
    }
    if (env.branch !== undefined && typeof env.branch !== 'string') {
      errors.push('Campo inválido em environment: "branch" deve ser uma string.');
    }
    if (env.environment !== undefined && typeof env.environment !== 'string') {
      errors.push('Campo inválido em environment: "environment" deve ser uma string.');
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
      if (finite(rw.requestedStartedAt) && finite(rw.requestedEndedAt) && (rw.requestedEndedAt as number) < (rw.requestedStartedAt as number)) {
        errors.push('Campo inválido em replayWindow: "requestedEndedAt" deve ser maior ou igual a "requestedStartedAt".');
      }
      if (typeof rw.preparationEventCount !== 'number' || !Number.isInteger(rw.preparationEventCount) || rw.preparationEventCount < 0) {
        errors.push('Campo obrigatório ausente ou inválido em replayWindow: "preparationEventCount" deve ser um número inteiro não negativo.');
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

      // Validação discriminada por tipo de evento
      switch (evt.type) {
        case 'console': {
          const validLevels = new Set(['log', 'info', 'warn', 'error', 'debug']);
          if (typeof evt.level !== 'string' || !validLevels.has(evt.level)) {
            errors.push(`Evento de console no índice ${i} possui "level" inválido.`);
          }
          if (!Array.isArray(evt.args)) {
            errors.push(`Evento de console no índice ${i} deve possuir "args" como array.`);
          }
          break;
        }
        case 'error': {
          if (typeof evt.name !== 'string' || evt.name.trim() === '') {
            errors.push(`Evento de erro no índice ${i} deve possuir "name" válido.`);
          }
          if (typeof evt.message !== 'string') {
            errors.push(`Evento de erro no índice ${i} deve possuir "message" válida.`);
          }
          if (evt.stack !== undefined && typeof evt.stack !== 'string') {
            errors.push(`Evento de erro no índice ${i} possui "stack" inválida.`);
          }
          if (evt.componentStack !== undefined && typeof evt.componentStack !== 'string') {
            errors.push(`Evento de erro no índice ${i} possui "componentStack" inválida.`);
          }
          if (evt.filename !== undefined && typeof evt.filename !== 'string') {
            errors.push(`Evento de erro no índice ${i} possui "filename" inválido.`);
          }
          if (evt.source !== undefined && typeof evt.source !== 'string') {
            errors.push(`Evento de erro no índice ${i} possui "source" inválido.`);
          }
          if (evt.lineno !== undefined && !finite(evt.lineno)) {
            errors.push(`Evento de erro no índice ${i} possui "lineno" inválido.`);
          }
          if (evt.colno !== undefined && !finite(evt.colno)) {
            errors.push(`Evento de erro no índice ${i} possui "colno" inválido.`);
          }
          break;
        }
        case 'network': {
          if (typeof evt.method !== 'string' || evt.method.trim() === '') {
            errors.push(`Evento de rede no índice ${i} deve possuir "method" válido.`);
          }
          if (typeof evt.url !== 'string' || evt.url.trim() === '') {
            errors.push(`Evento de rede no índice ${i} deve possuir "url" válida.`);
          }
          if (!finite(evt.status)) {
            errors.push(`Evento de rede no índice ${i} deve possuir "status" numérico.`);
          }
          if (!finite(evt.durationMs) || (evt.durationMs as number) < 0) {
            errors.push(`Evento de rede no índice ${i} deve possuir "durationMs" não-negativo.`);
          }
          const validResults = new Set(['success', 'error', 'timeout', 'abort']);
          if (typeof evt.result !== 'string' || !validResults.has(evt.result)) {
            errors.push(`Evento de rede no índice ${i} possui "result" inválido.`);
          }
          if (evt.requestBody !== undefined && typeof evt.requestBody !== 'string') {
            errors.push(`Evento de rede no índice ${i} possui "requestBody" inválido.`);
          }
          if (evt.responseBody !== undefined && typeof evt.responseBody !== 'string') {
            errors.push(`Evento de rede no índice ${i} possui "responseBody" inválido.`);
          }
          if (evt.headers !== undefined && !isRecord(evt.headers)) {
            errors.push(`Evento de rede no índice ${i} possui "headers" inválido.`);
          }
          break;
        }
        case 'navigation': {
          if (typeof evt.toUrl !== 'string' || evt.toUrl.trim() === '') {
            errors.push(`Evento de navegação no índice ${i} deve possuir "toUrl" válida.`);
          }
          const validKinds = new Set(['initial', 'pushState', 'replaceState', 'popstate', 'hashchange']);
          if (typeof evt.kind !== 'string' || !validKinds.has(evt.kind)) {
            errors.push(`Evento de navegação no índice ${i} possui "kind" inválido.`);
          }
          if (evt.fromUrl !== undefined && typeof evt.fromUrl !== 'string') {
            errors.push(`Evento de navegação no índice ${i} possui "fromUrl" inválido.`);
          }
          break;
        }
        case 'marker': {
          if (typeof evt.label !== 'string' || evt.label.trim() === '') {
            errors.push(`Evento de marcador no índice ${i} deve possuir "label" válida.`);
          }
          break;
        }
        case 'performance': {
          if (typeof evt.metric !== 'string' || evt.metric.trim() === '') {
            errors.push(`Evento de performance no índice ${i} deve possuir "metric" válida.`);
          }
          if (!finite(evt.durationMs) || (evt.durationMs as number) < 0) {
            errors.push(`Evento de performance no índice ${i} deve possuir "durationMs" não-negativo.`);
          }
          break;
        }
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
