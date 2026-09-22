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
  sizeBytes: number;
  replay: RrwebEvent[];
  replayCompressed?: Uint8Array;
  hasFullSnapshot?: boolean;
  snapshotTimestamps?: number[];
  timeline: TimelineEvent[];
}
