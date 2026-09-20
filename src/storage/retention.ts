import type { FlightRecorderDB } from './db';
import type { StoredChunk } from '../types/chunk';

export interface RetentionConfig {
  bufferMinutes: number; // default 5
  maxStorageMb: number;  // default 50
}

export interface PruneResult {
  deletedChunkIds: string[];
  droppedEventsCount: number;
  reclaimedBytes: number;
  remainingBytes: number;
}

export class RetentionEngine {
  private db: FlightRecorderDB;
  private config: RetentionConfig;
  private droppedEventsTotal = 0;

  constructor(db: FlightRecorderDB, config?: Partial<RetentionConfig>) {
    this.db = db;
    this.config = {
      bufferMinutes: config?.bufferMinutes ?? 5,
      maxStorageMb: config?.maxStorageMb ?? 50
    };
  }

  public getDroppedEventsTotal(): number {
    return this.droppedEventsTotal;
  }

  /**
   * Executa limpeza de retenção:
   * 1. Protege todos os chunks vinculados a incidentes (pendentes ou finalizados).
   * 2. Exclui chunks não protegidos expirados pelo tempo (bufferMinutes).
   * 3. Se exceder maxStorageMb, exclui os chunks não protegidos mais antigos.
   */
  public async prune(now: number = Date.now()): Promise<PruneResult> {
    const incidents = await this.db.getAllIncidents();
    const protectedChunkIds = new Set<string>();

    for (const inc of incidents) {
      for (const cid of inc.chunkIds) {
        protectedChunkIds.add(cid);
      }
    }

    const allChunks = await this.db.getAllChunks();
    const maxAgeMs = this.config.bufferMinutes * 60 * 1000;
    const expirationThreshold = now - maxAgeMs;

    const toDelete: StoredChunk[] = [];
    const remaining: StoredChunk[] = [];

    for (const chunk of allChunks) {
      const isProtected = protectedChunkIds.has(chunk.id);
      if (!isProtected && chunk.endedAt < expirationThreshold) {
        toDelete.push(chunk);
      } else {
        remaining.push(chunk);
      }
    }

    // Checagem de limite por tamanho (bytes)
    const maxStorageBytes = this.config.maxStorageMb * 1024 * 1024;
    let currentBytes = remaining.reduce((sum, c) => sum + (c.sizeBytes || 0), 0);

    if (currentBytes > maxStorageBytes) {
      // Ordena não-protegidos do mais antigo para o mais novo
      const unproRemaining = remaining
        .filter((c) => !protectedChunkIds.has(c.id))
        .sort((a, b) => a.startedAt - b.startedAt);

      for (const chunk of unproRemaining) {
        if (currentBytes <= maxStorageBytes) break;
        toDelete.push(chunk);
        currentBytes -= chunk.sizeBytes || 0;
      }
    }

    const deletedChunkIds = toDelete.map((c) => c.id);
    let droppedEventsCount = 0;
    let reclaimedBytes = 0;

    for (const chunk of toDelete) {
      droppedEventsCount += (chunk.replay?.length || 0) + (chunk.timeline?.length || 0);
      reclaimedBytes += chunk.sizeBytes || 0;
    }

    this.droppedEventsTotal += droppedEventsCount;

    if (deletedChunkIds.length > 0) {
      await this.db.deleteChunks(deletedChunkIds);
    }

    return {
      deletedChunkIds,
      droppedEventsCount,
      reclaimedBytes,
      remainingBytes: currentBytes
    };
  }
}
