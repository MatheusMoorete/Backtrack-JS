import type { FlightRecorderDB } from './db';
import type {
  StoredIncident,
  IncidentReason,
  IncidentTrigger,
  IncidentSummary
} from '../types/incident';
import type { RrwebEvent } from '../types/chunk';
import type { FlightRecorderArtifactV1, EnvironmentMetadata } from '../types/artifact';
import { sortTimelineEvents } from '../validation/validate';

export interface IncidentManagerConfig {
  afterErrorSeconds: number; // default 15
  recorderVersion: string;   // default '0.1.0'
}

/**
 * Fatia e ajusta os eventos de replay para que caibam estritamente na janela [startedAt, finalizedAt],
 * garantindo que o FullSnapshot inicial (type: 2) mais recente seja reposicionado no início
 * da janela (com seu Meta type: 4 correspondente). Isso evita que o player apresente tela em branco
 * e garante que a duração do replay corresponda com exatidão à duração solicitada.
 */
export function sliceReplayEventsForWindow(
  events: RrwebEvent[],
  startedAt: number,
  finalizedAt: number
): RrwebEvent[] {
  if (!events || events.length === 0) {
    return [];
  }

  // Ordena por timestamp
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // Eventos dentro da janela
  const inWindow = sorted.filter(
    (e) => e.timestamp >= startedAt && e.timestamp <= finalizedAt
  );

  // Verifica se a janela já possui um FullSnapshot logo no início (primeiros 1000ms)
  const hasEarlySnapshot = inWindow.some(
    (e) => e.type === 2 && e.timestamp - startedAt <= 1000
  );

  if (hasEarlySnapshot) {
    return inWindow;
  }

  // Busca o FullSnapshot (type: 2) mais recente anterior ou igual a startedAt
  const priorSnapshots = sorted.filter((e) => e.type === 2 && e.timestamp <= startedAt);
  const baseSnapshot =
    priorSnapshots.length > 0
      ? priorSnapshots[priorSnapshots.length - 1]
      : sorted.find((e) => e.type === 2);

  if (!baseSnapshot) {
    // Se não encontrou snapshot nenhum, retorna os eventos da janela
    return inWindow;
  }

  // Busca o evento Meta (type: 4) mais recente anterior ou junto do snapshot
  const priorMetas = sorted.filter(
    (e) => e.type === 4 && e.timestamp <= baseSnapshot.timestamp
  );
  const baseMeta = priorMetas.length > 0 ? priorMetas[priorMetas.length - 1] : null;

  const result: RrwebEvent[] = [];

  if (baseMeta) {
    result.push({
      ...baseMeta,
      timestamp: startedAt - 1
    });
  }

  // Snapshot reposicionado exatamente no início da janela
  result.push({
    ...baseSnapshot,
    timestamp: startedAt
  });

  // Eventos incrementais ocorridos dentro da janela
  for (const ev of inWindow) {
    if (ev.type === 2 && ev.timestamp === baseSnapshot.timestamp) {
      continue;
    }
    result.push(ev);
  }

  return result;
}

export class IncidentManager {
  private db: FlightRecorderDB;
  private sessionId: string;
  private tabId: string;
  private environment: EnvironmentMetadata;
  private config: IncidentManagerConfig;

  private pendingIncident: StoredIncident | null = null;
  private hasExtendedOnce = false;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private onIncidentFinalizedCallback?: (incident: StoredIncident) => void;
  private beforeFinalizeCallback?: () => Promise<void>;

  constructor(
    db: FlightRecorderDB,
    sessionId: string,
    tabId: string,
    environment: EnvironmentMetadata,
    config?: Partial<IncidentManagerConfig>
  ) {
    this.db = db;
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.environment = environment;
    this.config = {
      afterErrorSeconds: config?.afterErrorSeconds ?? 15,
      recorderVersion: config?.recorderVersion ?? '0.1.0'
    };
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
      await this.finalize(existing.id);
    } else {
      const remainingMs = existing.finalizeAt - now;
      this.finalizeTimer = setTimeout(() => {
        this.finalize(existing.id);
      }, remainingMs);
    }
  }

  /**
   * Registra um gatilho de incidente (automático ou manual).
   */
  public async trigger(
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
      const incidentId = `inc_${this.sessionId}_${now}`;
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
        chunkIds: chunks.map((c) => c.id)
      };

      this.pendingIncident = newIncident;
      this.hasExtendedOnce = false;
      await this.db.putIncident(newIncident);

      this.finalizeTimer = setTimeout(() => {
        this.finalize(incidentId);
      }, this.config.afterErrorSeconds * 1000);

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

  private async createAndFinalizeManualIncident(
    triggerData: IncidentTrigger,
    now: number,
    windowSeconds?: number
  ): Promise<string> {
    const incidentId = `inc_manual_${this.sessionId}_${now}`;
    const chunks = await this.db.getChunksBySession(this.sessionId);
    chunks.sort((a, b) => a.sequence - b.sequence);

    const sessionStartedAt = chunks.length > 0 ? chunks[0].startedAt : now;
    let selectedChunks = chunks;
    let startedAt = sessionStartedAt;

    if (windowSeconds && windowSeconds > 0) {
      const windowMs = windowSeconds * 1000;
      const cutoff = Math.max(sessionStartedAt, now - windowMs);
      startedAt = cutoff;

      // Chunks que intersectam a janela [cutoff, now]
      const candidateChunks = chunks.filter((c) => (c.endedAt || c.startedAt) >= cutoff);

      if (candidateChunks.length > 0) {
        // Verifica se os candidatos possuem FullSnapshot do rrweb (type: 2)
        const hasFullSnapshot = candidateChunks.some((c) =>
          c.replay?.some((r) => r.type === 2)
        );

        if (!hasFullSnapshot) {
          // Busca o chunk anterior mais próximo que contém o snapshot inicial
          const priorChunkWithSnapshot = [...chunks]
            .reverse()
            .find(
              (c) =>
                c.startedAt < candidateChunks[0].startedAt &&
                c.replay?.some((r) => r.type === 2)
            );

          if (priorChunkWithSnapshot) {
            candidateChunks.unshift(priorChunkWithSnapshot);
          }
        }
        selectedChunks = candidateChunks;
      } else if (chunks.length > 0) {
        // Fallback se nenhum chunk intersecta a janela (ex: usuário inativo)
        const lastChunk = chunks[chunks.length - 1];
        const hasSnapshot = lastChunk.replay?.some((r) => r.type === 2);
        if (hasSnapshot) {
          selectedChunks = [lastChunk];
        } else {
          const priorChunkWithSnapshot = [...chunks]
            .reverse()
            .find((c) => c.replay?.some((r) => r.type === 2));
          selectedChunks =
            priorChunkWithSnapshot && priorChunkWithSnapshot.id !== lastChunk.id
              ? [priorChunkWithSnapshot, lastChunk]
              : [lastChunk];
        }
      }
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
      chunkIds: selectedChunks.map((c) => c.id)
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
  public async finalize(incidentId: string): Promise<void> {
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
    const sessionChunks = await this.db.getChunksBySession(this.sessionId);
    const allChunkIds = Array.from(new Set([...incident.chunkIds, ...sessionChunks.map((c) => c.id)]));

    incident.state = 'finalized';
    incident.finalizedAt = now;
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

    const chunks = await this.db.getChunksByIds(incident.chunkIds);
    chunks.sort((a, b) => a.sequence - b.sequence);

    const mergedTimeline = chunks.flatMap((c) => c.timeline || []);
    const sortedTimeline = sortTimelineEvents(mergedTimeline);
    const filteredTimeline = sortedTimeline.filter(
      (e) => e.timestamp >= incident.startedAt && e.timestamp <= (incident.finalizedAt ?? incident.finalizeAt)
    );
    const rawReplay = chunks.flatMap((c) => c.replay || []);
    const slicedReplay = sliceReplayEventsForWindow(
      rawReplay,
      incident.startedAt,
      incident.finalizedAt ?? incident.finalizeAt
    );

    const totalStorageBytes = chunks.reduce((acc, c) => acc + (c.sizeBytes || 0), 0);

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
      environment: this.environment,
      timeline: filteredTimeline,
      replay: slicedReplay,
      diagnostics: {
        droppedEvents: 0,
        storageBytes: totalStorageBytes,
        degraded: false,
        degradedReasons: []
      }
    };

    return artifact;
  }

  public async listIncidents(): Promise<IncidentSummary[]> {
    return this.db.listIncidents();
  }

  public async deleteIncident(incidentId: string): Promise<void> {
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
  }
}
