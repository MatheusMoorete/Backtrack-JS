import type { FlightRecorderDB } from './db';
import type {
  StoredIncident,
  IncidentReason,
  IncidentTrigger,
  IncidentSummary
} from '../types/incident';
import type { RrwebEvent, StoredChunk } from '../types/chunk';
import type { FlightRecorderArtifactV1, EnvironmentMetadata, ReplayWindowMetadata } from '../types/artifact';
import type { TimelineEvent, NavigationTimelineEvent } from '../types/timeline';
import { sortTimelineEvents } from '../validation/validate';
import { decompressGzip } from '../utils/compression';

export interface IncidentManagerConfig {
  afterErrorSeconds: number; // default 15
  recorderVersion: string;   // default '0.1.0'
  getRecordingIssues?: () => string[];
  getDroppedEventsCount?: () => number;
}

export function generateIncidentId(prefix: 'inc' | 'inc_manual', sessionId: string, timestamp: number): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2, 10);
  return `${prefix}_${sessionId}_${timestamp}_${uuid}`;
}

export interface SlicedReplayResult {
  events: RrwebEvent[];
  replayWindow: ReplayWindowMetadata;
  degradedReasons: string[];
}

/**
 * Fatia e ajusta os eventos de replay para que caibam estritamente na janela [startedAt, finalizedAt],
 * garantindo que o FullSnapshot inicial (type: 2) mais recente seja reposicionado no início
 * da janela (com seu Meta type: 4 correspondente).
 *
 * Também gera metadados explícitos da janela de replay (replayWindow) para diferenciar eventos
 * preparatórios de eventos reais da janela solicitada.
 */
export function sliceReplayEventsWithMetadata(
  events: RrwebEvent[],
  startedAt: number,
  finalizedAt: number
): SlicedReplayResult {
  const degradedReasons: string[] = [];
  if (!events || events.length === 0) {
    return {
      events: [],
      replayWindow: {
        requestedStartedAt: startedAt,
        requestedEndedAt: finalizedAt,
        preparationEventCount: 0
      },
      degradedReasons
    };
  }

  // Ordena por timestamp
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // Eventos dentro da janela
  const inWindow = sorted.filter(
    (e) => e.timestamp >= startedAt && e.timestamp <= finalizedAt
  );

  // Busca o FullSnapshot (type: 2) mais recente anterior ou igual a startedAt.
  // NÃO busca snapshots futuros (evita que tela futura apareça no início da gravação).
  const priorSnapshots = sorted.filter((e) => e.type === 2 && e.timestamp <= startedAt);
  const baseSnapshot = priorSnapshots.length > 0 ? priorSnapshots[priorSnapshots.length - 1] : null;

  if (!baseSnapshot) {
    degradedReasons.push('Não há snapshot para reconstruir o início da gravação.');

    // Se não encontrou snapshot anterior ou em startedAt, busca ao menos o Meta (type: 4) anterior
    // caso a janela não possua nenhum evento Meta para dimensões de tela.
    // NUNCA seleciona Meta futuro (> startedAt), para não fabricar contexto temporal!
    let prepCount = 0;
    const windowHasMeta = inWindow.some((e) => e.type === 4);
    if (!windowHasMeta) {
      const priorMetas = sorted.filter((e) => e.type === 4 && e.timestamp <= startedAt);
      const priorMeta = priorMetas.length > 0 ? priorMetas[priorMetas.length - 1] : null;
      if (priorMeta) {
        prepCount = 1;
        return {
          events: [{ ...priorMeta, timestamp: startedAt - 1 }, ...inWindow],
          replayWindow: {
            requestedStartedAt: startedAt,
            requestedEndedAt: finalizedAt,
            preparationEventCount: prepCount
          },
          degradedReasons
        };
      } else {
        degradedReasons.push('Não há evento de metadados (Meta) anterior ao início da gravação.');
      }
    }

    return {
      events: inWindow,
      replayWindow: {
        requestedStartedAt: startedAt,
        requestedEndedAt: finalizedAt,
        preparationEventCount: prepCount
      },
      degradedReasons
    };
  }

  // Índice do snapshot base no array ordenado
  const baseSnapshotIndex = sorted.lastIndexOf(baseSnapshot);

  // Busca o evento Meta (type: 4) mais recente anterior ou junto do snapshot e antes de startedAt
  const priorMetas = sorted.filter(
    (e, idx) => e.type === 4 && idx <= baseSnapshotIndex && e.timestamp <= startedAt
  );
  const baseMeta = priorMetas.length > 0 ? priorMetas[priorMetas.length - 1] : null;

  // Busca as mutações ocorridas APÓS o snapshot base na sequência e antes de startedAt.
  // Utiliza a posição no array (idx > baseSnapshotIndex) em vez de apenas timestamp >,
  // garantindo que mutações ocorridas no mesmo milissegundo do snapshot sejam preservadas!
  const intermediateMutations = sorted
    .slice(baseSnapshotIndex + 1)
    .filter(
      (e) =>
        e.timestamp < startedAt &&
        e.type !== 2 &&
        e.type !== 4
    );

  const result: RrwebEvent[] = [];
  let preparationCount = 0;

  if (baseMeta) {
    result.push({
      ...baseMeta,
      timestamp: startedAt - 1
    });
    preparationCount++;
  }

  // Snapshot reposicionado exatamente no início da janela
  result.push({
    ...baseSnapshot,
    timestamp: startedAt
  });
  preparationCount++;

  // Mutações intermediárias aplicadas no frame inicial (startedAt) para reconstituir o DOM fielmente
  for (const ev of intermediateMutations) {
    result.push({
      ...ev,
      timestamp: startedAt
    });
    preparationCount++;
  }

  // Eventos incrementais ocorridos dentro da janela
  for (const ev of inWindow) {
    if (ev.type === 2 && ev.timestamp === baseSnapshot.timestamp) {
      continue;
    }
    if (baseMeta && ev.type === 4 && ev.timestamp === baseMeta.timestamp) {
      continue;
    }
    result.push(ev);
  }

  return {
    events: result,
    replayWindow: {
      requestedStartedAt: startedAt,
      requestedEndedAt: finalizedAt,
      preparationEventCount: preparationCount,
      baseSnapshotOriginalTimestamp: baseSnapshot.timestamp
    },
    degradedReasons
  };
}

export function sliceReplayEventsForWindow(
  events: RrwebEvent[],
  startedAt: number,
  finalizedAt: number
): RrwebEvent[] {
  return sliceReplayEventsWithMetadata(events, startedAt, finalizedAt).events;
}

export class IncidentManager {
  private db: FlightRecorderDB;
  private sessionId: string;
  private tabId: string;
  private environmentProvider: () => EnvironmentMetadata;
  private fallbackEnvironment: EnvironmentMetadata;
  private config: IncidentManagerConfig;

  private pendingIncident: StoredIncident | null = null;
  private hasExtendedOnce = false;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private onIncidentPendingCallback?: (incident: StoredIncident) => void;
  private onIncidentFinalizedCallback?: (incident: StoredIncident) => void;
  private beforeFinalizeCallback?: () => Promise<void>;
  private onErrorCallback?: (error: unknown) => void;
  private activeOperation: Promise<unknown> | null = null;

  constructor(
    db: FlightRecorderDB,
    sessionId: string,
    tabId: string,
    environment: EnvironmentMetadata | (() => EnvironmentMetadata),
    config?: Partial<IncidentManagerConfig>
  ) {
    this.db = db;
    this.sessionId = sessionId;
    this.tabId = tabId;
    if (typeof environment === 'function') {
      this.environmentProvider = environment;
      this.fallbackEnvironment = {
        url: typeof window !== 'undefined' ? window.location.href : 'http://localhost',
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'node',
        viewport: {
          width: typeof window !== 'undefined' ? window.innerWidth : 1280,
          height: typeof window !== 'undefined' ? window.innerHeight : 720
        }
      };
    } else {
      this.fallbackEnvironment = environment;
      this.environmentProvider = () => environment;
    }
    this.config = {
      afterErrorSeconds: config?.afterErrorSeconds ?? 15,
      recorderVersion: config?.recorderVersion ?? '0.1.0',
      getRecordingIssues: config?.getRecordingIssues,
      getDroppedEventsCount: config?.getDroppedEventsCount
    };
  }

  private getEnvironment(): EnvironmentMetadata {
    try {
      return this.environmentProvider();
    } catch {
      return this.fallbackEnvironment;
    }
  }

  private resolveFallbackEnvironment(
    incident: StoredIncident,
    timeline: TimelineEvent[]
  ): EnvironmentMetadata {
    const baseEnv = this.getEnvironment();
    const navEvents = timeline.filter(
      (e): e is NavigationTimelineEvent => e.type === 'navigation' && e.timestamp <= incident.triggeredAt
    );
    const lastNav = navEvents.length > 0 ? navEvents[navEvents.length - 1] : null;

    return {
      ...baseEnv,
      url: lastNav ? lastNav.toUrl : baseEnv.url
    };
  }

  private serializeOperation<T>(op: () => Promise<T>): Promise<T> {
    let opPromise: Promise<T>;
    const wrappedOp = async () => {
      try {
        return await op();
      } catch (err) {
        if (this.onErrorCallback) {
          try {
            this.onErrorCallback(err);
          } catch {
            // Ignora erro no callback
          }
        }
        throw err;
      } finally {
        if (this.activeOperation === opPromise) {
          this.activeOperation = null;
        }
      }
    };

    if (!this.activeOperation) {
      opPromise = wrappedOp();
      this.activeOperation = opPromise;
      return opPromise;
    }

    const run = () => wrappedOp();
    opPromise = this.activeOperation.then(run, run);
    this.activeOperation = opPromise;
    return opPromise;
  }

  public setOnError(callback: (error: unknown) => void): void {
    this.onErrorCallback = callback;
  }

  public setOnIncidentPending(callback: (incident: StoredIncident) => void): void {
    this.onIncidentPendingCallback = callback;
  }

  public setOnIncidentFinalized(callback: (incident: StoredIncident) => void): void {
    this.onIncidentFinalizedCallback = callback;
  }

  public setBeforeFinalize(callback: () => Promise<void>): void {
    this.beforeFinalizeCallback = callback;
  }

  public getPendingIncident(): StoredIncident | null {
    return this.pendingIncident;
  }

  /**
   * Inicialização e recuperação pós-reload:
   * Verifica se há incidente pendente para esta sessão no IndexedDB.
   */
  public async init(): Promise<void> {
    const existing = await this.db.getPendingIncidentForSession(this.sessionId);
    if (!existing) return;

    this.pendingIncident = existing;
    const now = Date.now();

    if (now >= existing.finalizeAt) {
      await this.executeFinalize(existing.id);
    } else {
      const remainingMs = existing.finalizeAt - now;
      this.finalizeTimer = setTimeout(() => {
        this.finalize(existing.id);
      }, remainingMs);
    }
  }

  /**
   * Registra um gatilho de incidente (automático ou manual).
   * As chamadas são serializadas para evitar race conditions entre múltiplos erros concorrentes.
   */
  public trigger(
    reason: IncidentReason,
    triggerData: IncidentTrigger,
    windowSeconds?: number
  ): Promise<string> {
    return this.serializeOperation(() =>
      this.executeTrigger(reason, triggerData, windowSeconds)
    );
  }

  private async executeTrigger(
    reason: IncidentReason,
    triggerData: IncidentTrigger,
    windowSeconds?: number
  ): Promise<string> {
    const now = triggerData.timestamp || Date.now();

    // Captura manual finaliza imediatamente
    if (reason === 'manual') {
      return this.createAndFinalizeManualIncident(triggerData, now, windowSeconds);
    }

    // Captura automática
    if (!this.pendingIncident) {
      const incidentId = generateIncidentId('inc', this.sessionId, now);
      const chunks = await this.db.getChunksBySession(this.sessionId);
      const startedAt = chunks.length > 0 ? chunks[0].startedAt : now;

      const newIncident: StoredIncident = {
        id: incidentId,
        sessionId: this.sessionId,
        tabId: this.tabId,
        reason,
        triggers: [triggerData],
        startedAt,
        triggeredAt: now,
        finalizeAt: now + this.config.afterErrorSeconds * 1000,
        state: 'pending',
        recordingIssues: this.config.getRecordingIssues?.() ?? [],
        chunkIds: chunks.map((c) => c.id),
        environment: this.getEnvironment()
      };

      this.pendingIncident = newIncident;
      this.hasExtendedOnce = false;
      await this.db.putIncident(newIncident);

      this.finalizeTimer = setTimeout(() => {
        this.finalize(incidentId);
      }, this.config.afterErrorSeconds * 1000);

      if (this.onIncidentPendingCallback) {
        this.onIncidentPendingCallback(newIncident);
      }

      return incidentId;
    }

    // Incidente já pendente: verificar deduplicação e extensão
    const existing = this.pendingIncident;

    // Deduplicação: triggers com mesma assinatura nos últimos 10s não estendem
    const isDuplicate = existing.triggers.some(
      (t) => t.signature === triggerData.signature && now - t.timestamp < 10000
    );

    existing.triggers.push(triggerData);

    if (!isDuplicate && !this.hasExtendedOnce) {
      // Estende finalizeAt uma única vez
      this.hasExtendedOnce = true;
      existing.finalizeAt = Math.max(existing.finalizeAt, now + this.config.afterErrorSeconds * 1000);

      if (this.finalizeTimer) {
        clearTimeout(this.finalizeTimer);
      }
      const remainingMs = existing.finalizeAt - now;
      this.finalizeTimer = setTimeout(() => {
        this.finalize(existing.id);
      }, remainingMs);
    }

    // Atualiza chunkIds associados
    const sessionChunks = await this.db.getChunksBySession(this.sessionId);
    existing.chunkIds = Array.from(new Set([...existing.chunkIds, ...sessionChunks.map((c) => c.id)]));

    await this.db.putIncident(existing);
    return existing.id;
  }

  /**
   * Obtém os timestamps reais de todos os FullSnapshots (rrweb type: 2) de um chunk.
   * Não fabrica timestamps usando chunk.startedAt quando apenas a flag hasFullSnapshot está presente.
   */
  private async getChunkSnapshotTimestamps(
    chunk: StoredChunk,
    onMissingTemporalProof?: () => void
  ): Promise<number[]> {
    if (chunk.snapshotTimestamps && chunk.snapshotTimestamps.length > 0) {
      return chunk.snapshotTimestamps;
    }
    if (chunk.replay && chunk.replay.length > 0) {
      const timestamps = chunk.replay.filter((r) => r.type === 2).map((r) => r.timestamp);
      if (timestamps.length > 0) return timestamps;
    }
    if (chunk.replayCompressed && chunk.replayCompressed.length > 0) {
      try {
        const text = await decompressGzip(chunk.replayCompressed);
        const events = JSON.parse(text) as RrwebEvent[];
        const timestamps = events.filter((r) => r.type === 2).map((r) => r.timestamp);
        if (timestamps.length > 0) return timestamps;
      } catch {
        // Ignora erro aqui
      }
    }
    if (chunk.hasFullSnapshot) {
      // Chunk legado possui flag hasFullSnapshot, mas não possui prova temporal de quando o snapshot ocorreu
      onMissingTemporalProof?.();
    }
    return [];
  }

  private async createAndFinalizeManualIncident(
    triggerData: IncidentTrigger,
    now: number,
    windowSeconds?: number
  ): Promise<string> {
    const incidentId = generateIncidentId('inc_manual', this.sessionId, now);
    const chunks = await this.db.getChunksBySession(this.sessionId);
    chunks.sort((a, b) => (a.startedAt !== b.startedAt ? a.startedAt - b.startedAt : a.sequence - b.sequence));

    const sessionStartedAt = chunks.length > 0 ? chunks[0].startedAt : now;
    let selectedChunks = chunks;
    let startedAt = sessionStartedAt;
    let hasUnprovenTemporalChunk = false;

    if (windowSeconds && windowSeconds > 0) {
      const windowMs = windowSeconds * 1000;
      const cutoff = Math.max(sessionStartedAt, now - windowMs);
      startedAt = cutoff;

      // Obtém os timestamps reais de FullSnapshot de cada chunk
      const chunkSnapshots = await Promise.all(
        chunks.map((c) =>
          this.getChunkSnapshotTimestamps(c, () => {
            hasUnprovenTemporalChunk = true;
          })
        )
      );

      // Chunks que intersectam a janela solicitada [cutoff, now]
      const candidateIndices: number[] = [];
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        if ((c.endedAt || c.startedAt) >= cutoff) {
          candidateIndices.push(i);
        }
      }

      if (candidateIndices.length > 0) {
        const firstCandidateIdx = candidateIndices[0];
        const lastCandidateIdx = candidateIndices[candidateIndices.length - 1];

        // Localiza o chunk com o snapshot efetivamente anterior ou igual ao corte (<= cutoff)
        let baseChunkIdx = -1;
        for (let i = chunks.length - 1; i >= 0; i--) {
          const hasSnapshotBeforeCutoff = chunkSnapshots[i].some((ts) => ts <= cutoff);
          if (hasSnapshotBeforeCutoff) {
            baseChunkIdx = i;
            break;
          }
        }

        // Se encontrou o chunk base com snapshot <= cutoff, inclui todos os lotes entre ele e a janela
        // (inclusive intermediários com mutações necessárias para reconstituir a tela)
        const startIdx = baseChunkIdx !== -1 ? Math.min(baseChunkIdx, firstCandidateIdx) : firstCandidateIdx;
        selectedChunks = chunks.slice(startIdx, lastCandidateIdx + 1);
      } else if (chunks.length > 0) {
        // Fallback se nenhum chunk intersecta a janela (ex: usuário inativo)
        const lastChunkIdx = chunks.length - 1;
        let baseChunkIdx = -1;
        for (let i = chunks.length - 1; i >= 0; i--) {
          if (chunkSnapshots[i].length > 0) {
            baseChunkIdx = i;
            break;
          }
        }
        const startIdx = baseChunkIdx !== -1 ? baseChunkIdx : lastChunkIdx;
        selectedChunks = chunks.slice(startIdx, lastChunkIdx + 1);
      }
    }

    const recordingIssues = [...(this.config.getRecordingIssues?.() ?? [])];
    if (hasUnprovenTemporalChunk) {
      recordingIssues.push('Ausência de prova temporal para snapshot em lote legado com hasFullSnapshot.');
    }

    const incident: StoredIncident = {
      id: incidentId,
      sessionId: this.sessionId,
      tabId: this.tabId,
      reason: 'manual',
      triggers: [triggerData],
      startedAt,
      triggeredAt: now,
      finalizeAt: now,
      finalizedAt: now,
      state: 'finalized',
      recordingIssues,
      chunkIds: selectedChunks.map((c) => c.id),
      environment: this.getEnvironment()
    };

    await this.db.putIncident(incident);

    if (this.onIncidentFinalizedCallback) {
      this.onIncidentFinalizedCallback(incident);
    }

    return incidentId;
  }

  /**
   * Finaliza um incidente pendente.
   */
  public finalize(incidentId: string): Promise<void> {
    return this.serializeOperation(() =>
      this.executeFinalize(incidentId)
    );
  }

  private async executeFinalize(incidentId: string): Promise<void> {
    if (this.beforeFinalizeCallback) {
      try {
        await this.beforeFinalizeCallback();
      } catch {
        // Ignora erro de flush
      }
    }

    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }

    const incident = await this.db.getIncident(incidentId);
    if (!incident || incident.state === 'finalized') {
      return;
    }

    const now = Date.now();
    // Clampa finalizedAt para não ultrapassar finalizeAt programado (evita aumento artificial da duração pós-reload)
    const finalizedAt = incident.finalizeAt ? Math.min(now, incident.finalizeAt) : now;
    const sessionChunks = await this.db.getChunksBySession(this.sessionId);
    // Associa apenas chunks ocorridos até o encerramento real do incidente
    const relevantChunks = sessionChunks.filter((c) => c.startedAt <= finalizedAt);
    const allChunkIds = Array.from(new Set([...incident.chunkIds, ...relevantChunks.map((c) => c.id)]));

    incident.recordingIssues = [...new Set([...(incident.recordingIssues ?? []), ...(this.config.getRecordingIssues?.() ?? [])])];
    incident.state = 'finalized';
    incident.finalizedAt = finalizedAt;
    incident.chunkIds = allChunkIds;

    await this.db.putIncident(incident);

    if (this.pendingIncident?.id === incidentId) {
      this.pendingIncident = null;
      this.hasExtendedOnce = false;
    }

    if (this.onIncidentFinalizedCallback) {
      this.onIncidentFinalizedCallback(incident);
    }
  }

  /**
   * Exporta um incidente em um artefato canônico v1 (.ffr.json).
   */
  public async exportArtifact(incidentId: string): Promise<FlightRecorderArtifactV1> {
    if (this.beforeFinalizeCallback) {
      try {
        await this.beforeFinalizeCallback();
      } catch {
        // Ignora erro de flush
      }
    }

    const incident = await this.db.getIncident(incidentId);
    if (!incident) {
      throw new Error(`Incidente "${incidentId}" não encontrado.`);
    }

    const issues = new Set(incident.recordingIssues ?? []);
    const chunks = await this.db.getChunksByIds(incident.chunkIds);
    const foundIds = new Set(chunks.map((chunk) => chunk.id));
    let hasMissingChunks = false;
    let hasCorruptedChunks = false;

    const missingChunkIds = incident.chunkIds.filter((id) => !foundIds.has(id));
    if (missingChunkIds.length > 0) {
      hasMissingChunks = true;
      issues.add('Um ou mais lotes da gravação não foram encontrados.');
    }
    chunks.sort((a, b) => (a.startedAt !== b.startedAt ? a.startedAt - b.startedAt : a.sequence - b.sequence));

    const mergedTimeline = chunks.flatMap((c) => c.timeline || []);
    const sortedTimeline = sortTimelineEvents(mergedTimeline);
    const filteredTimeline = sortedTimeline.filter(
      (e) => e.timestamp >= incident.startedAt && e.timestamp <= (incident.finalizedAt ?? incident.finalizeAt)
    );
    const rawReplay = (
      await Promise.all(
        chunks.map(async (c) => {
          if (c.replayCompressed && c.replayCompressed.length > 0) {
            try {
              const text = await decompressGzip(c.replayCompressed);
              const replay: unknown = JSON.parse(text);
              if (!Array.isArray(replay)) throw new Error('Replay inválido');
              return replay as RrwebEvent[];
            } catch {
              hasCorruptedChunks = true;
              issues.add('Parte do replay não pôde ser descomprimida; a gravação pode estar incompleta.');
              return c.replay || [];
            }
          }
          return c.replay || [];
        })
      )
    ).flat();
    const { events: slicedReplay, replayWindow, degradedReasons: replayIssues } = sliceReplayEventsWithMetadata(
      rawReplay,
      incident.startedAt,
      incident.finalizedAt ?? incident.finalizeAt
    );

    for (const rIssue of replayIssues) {
      issues.add(rIssue);
    }

    const totalStorageBytes = chunks.reduce((acc, c) => acc + (c.sizeBytes || 0), 0);
    const knownDroppedEvents = this.config.getDroppedEventsCount?.() ?? 0;
    const hasUnquantifiableLoss = hasMissingChunks || hasCorruptedChunks;

    const artifact: FlightRecorderArtifactV1 = {
      formatVersion: 1,
      recorderVersion: this.config.recorderVersion,
      incident: {
        id: incident.id,
        reason: incident.reason,
        triggers: incident.triggers,
        startedAt: incident.startedAt,
        triggeredAt: incident.triggeredAt,
        finalizedAt: incident.finalizedAt ?? incident.finalizeAt,
        annotationImage:
          (incident.triggers?.find((t) => t.detail?.annotationImage)?.detail
            ?.annotationImage as string) || undefined,
        annotations:
          (incident.triggers?.find((t) => t.detail?.annotations)?.detail
            ?.annotations as Record<string, unknown>) || undefined
      },
      environment: incident.environment ?? this.resolveFallbackEnvironment(incident, filteredTimeline),
      replayWindow,
      timeline: filteredTimeline,
      replay: slicedReplay,
      diagnostics: {
        droppedEvents: knownDroppedEvents,
        droppedEventsUnknown: hasUnquantifiableLoss || (issues.size > 0 && knownDroppedEvents === 0),
        storageBytes: totalStorageBytes,
        degraded: issues.size > 0,
        degradedReasons: [...issues]
      }
    };

    return artifact;
  }

  public async listIncidents(): Promise<IncidentSummary[]> {
    return this.db.listIncidents();
  }

  public deleteIncident(incidentId: string): Promise<void> {
    return this.serializeOperation(() =>
      this.executeDeleteIncident(incidentId)
    );
  }

  private async executeDeleteIncident(incidentId: string): Promise<void> {
    if (this.pendingIncident?.id === incidentId) {
      if (this.finalizeTimer) {
        clearTimeout(this.finalizeTimer);
        this.finalizeTimer = null;
      }
      this.pendingIncident = null;
    }
    await this.db.deleteIncident(incidentId);
  }

  public destroy(): void {
    if (this.finalizeTimer) {
      clearTimeout(this.finalizeTimer);
      this.finalizeTimer = null;
    }
    this.pendingIncident = null;
  }
}
