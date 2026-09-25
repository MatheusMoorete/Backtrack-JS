import type { TimelineEvent } from './timeline';

/**
 * Evento genérico do rrweb com timestamp e dados do snapshot/mutação.
 */
export interface RrwebEvent {
  type: number;
  data: unknown;
  timestamp: number;
  [key: string]: unknown;
}

/**
 * Chunk de gravação persistido no IndexedDB.
 */
export interface StoredChunk {
  id: string;
  sessionId: string;
  tabId: string;
  sequence: number;
  startedAt: number;
  endedAt: number;
  /**
   * Estimativa de tamanho do chunk em bytes (payload comprimido do replay + bytes UTF-8 da timeline).
   * É uma estimativa pois o overhead interno do IndexedDB não é mensurável dessa forma.
   */
  sizeBytes: number;
  replay: RrwebEvent[];
  replayCompressed?: Uint8Array;
  hasFullSnapshot?: boolean;
  snapshotTimestamps?: number[];
  timeline: TimelineEvent[];
}
