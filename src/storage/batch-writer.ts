import type { FlightRecorderDB } from './db';
import type { StoredChunk, RrwebEvent } from '../types/chunk';
import type { TimelineEvent } from '../types/timeline';
import { compressGzip } from '../utils/compression';

export interface FlushMetrics {
  flushIndex: number;
  durationMs: number;
  serializationMs: number;
  compressionMs: number;
  writeMs: number;
  chunkSizeBytes: number;
  replayEventsInBatch: number;
  timelineEventsInBatch: number;
  totalReplayInChunk: number;
  totalTimelineInChunk: number;
  totalEventsInChunk: number;
  timestamp: number;
}

export interface BatchWriterConfig {
  flushIntervalMs: number; // default 1000ms
  maxBatchEvents: number;  // default 250
  chunkDurationMs: number; // default 60000ms (60s)
  initialChunkSequence?: number;
  onFlushMetrics?: (metrics: FlushMetrics) => void;
}

export class BatchWriter {
  private db: FlightRecorderDB;
  private config: BatchWriterConfig;
  private sessionId: string;
  private tabId: string;

  private chunkSequence = 0;
  private pendingTimelineEvents: TimelineEvent[] = [];
  private pendingReplayEvents: RrwebEvent[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWritesCount = 0;
  private onErrorCallback?: (error: unknown) => void;
  private onChunkPersistedCallback?: (chunk: StoredChunk) => void;
  private pageHideHandler?: () => void;
  private visibilityChangeHandler?: () => void;
  private flushCount = 0;
  private onFlushMetricsCallback?: (metrics: FlushMetrics) => void;

  constructor(
    db: FlightRecorderDB,
    sessionId: string,
    tabId: string,
    config?: Partial<BatchWriterConfig>,
    onError?: (error: unknown) => void
  ) {
    this.db = db;
    this.sessionId = sessionId;
    this.tabId = tabId;
    this.config = {
      flushIntervalMs: config?.flushIntervalMs ?? 1000,
      maxBatchEvents: config?.maxBatchEvents ?? 250,
      chunkDurationMs: config?.chunkDurationMs ?? 60000,
      initialChunkSequence: config?.initialChunkSequence ?? 0,
      onFlushMetrics: config?.onFlushMetrics
    };
    this.chunkSequence = config?.initialChunkSequence ?? 0;
    this.onErrorCallback = onError;
    this.onFlushMetricsCallback = config?.onFlushMetrics;

    this.initLifecycleListeners();
  }

  public getChunkSequence(): number {
    return this.chunkSequence;
  }

  public setOnFlushMetrics(callback: (metrics: FlushMetrics) => void): void {
    this.onFlushMetricsCallback = callback;
  }

  public setOnChunkPersisted(callback: (chunk: StoredChunk) => void): void {
    this.onChunkPersistedCallback = callback;
  }

  public getPendingWrites(): number {
    return this.pendingWritesCount;
  }

  public addTimelineEvent(event: TimelineEvent): void {
    this.pendingTimelineEvents.push(event);
    this.checkThresholds();
  }

  public addReplayEvent(event: RrwebEvent): void {
    this.pendingReplayEvents.push(event);
    this.checkThresholds();
  }

  private checkThresholds(): void {
    const totalEvents = this.pendingTimelineEvents.length + this.pendingReplayEvents.length;
    if (totalEvents >= this.config.maxBatchEvents) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flush();
      }, this.config.flushIntervalMs);
    }
  }

  /**
   * Força a gravação de todos os eventos pendentes no IndexedDB.
   */
  public flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.pendingTimelineEvents.length === 0 && this.pendingReplayEvents.length === 0) {
      return this.writeChain;
    }

    const timelineToFlush = [...this.pendingTimelineEvents];
    const replayToFlush = [...this.pendingReplayEvents];
    this.pendingTimelineEvents = [];
    this.pendingReplayEvents = [];

    const now = Date.now();
    const allEventsTs = [
      ...timelineToFlush.map((e) => e.timestamp),
      ...replayToFlush.map((e) => e.timestamp)
    ];
    const startedAt = allEventsTs.length > 0 ? Math.min(...allEventsTs) : now;
    const endedAt = allEventsTs.length > 0 ? Math.max(...allEventsTs) : now;

    this.chunkSequence++;

    const snapshotTimestamps = replayToFlush
      .filter((r) => r.type === 2)
      .map((r) => r.timestamp);

    const chunkCopy: StoredChunk = {
      id: `chk_${this.sessionId}_${this.chunkSequence}_${startedAt}`,
      sessionId: this.sessionId,
      tabId: this.tabId,
      sequence: this.chunkSequence,
      startedAt,
      endedAt,
      sizeBytes: 0,
      hasFullSnapshot: snapshotTimestamps.length > 0,
      snapshotTimestamps,
      timeline: timelineToFlush,
      replay: replayToFlush
    };

    const flushIndex = ++this.flushCount;
    const replayEventsInBatch = replayToFlush.length;
    const timelineEventsInBatch = timelineToFlush.length;
    const totalReplayInChunk = replayEventsInBatch;
    const totalTimelineInChunk = timelineEventsInBatch;
    const totalEventsInChunk = totalReplayInChunk + totalTimelineInChunk;

    this.pendingWritesCount++;

    this.writeChain = this.writeChain
      .then(async () => {
        const tStart = performance.now();
        let serializationMs = 0;
        let compressionMs = 0;

        const timelineBytes = new TextEncoder().encode(
          JSON.stringify(chunkCopy.timeline)
        ).byteLength;

        if (chunkCopy.replay.length > 0) {
          try {
            const t0 = performance.now();
            const json = JSON.stringify(chunkCopy.replay);
            const t1 = performance.now();
            serializationMs = t1 - t0;

            const compressed = await compressGzip(json);
            const t2 = performance.now();
            compressionMs = t2 - t1;

            chunkCopy.replayCompressed = compressed;
            chunkCopy.sizeBytes = compressed.byteLength + timelineBytes;
            chunkCopy.replay = [];
          } catch {
            // Em caso de falha, mantém replay original
            const replayBytes = new TextEncoder().encode(
              JSON.stringify(chunkCopy.replay)
            ).byteLength;
            chunkCopy.sizeBytes = replayBytes + timelineBytes;
          }
        } else {
          chunkCopy.sizeBytes = timelineBytes;
        }
        const tWriteStart = performance.now();
        await this.db.putChunk(chunkCopy);
        const tWriteEnd = performance.now();
        const writeMs = tWriteEnd - tWriteStart;
        const durationMs = tWriteEnd - tStart;

        if (this.onFlushMetricsCallback) {
          this.onFlushMetricsCallback({
            flushIndex,
            durationMs,
            serializationMs,
            compressionMs,
            writeMs,
            chunkSizeBytes: chunkCopy.sizeBytes,
            replayEventsInBatch,
            timelineEventsInBatch,
            totalReplayInChunk,
            totalTimelineInChunk,
            totalEventsInChunk,
            timestamp: Date.now()
          });
        }

        if (this.onChunkPersistedCallback) {
          this.onChunkPersistedCallback(chunkCopy);
        }
      })
      .catch((err) => {
        if (this.onErrorCallback) {
          this.onErrorCallback(err);
        }
      })
      .finally(() => {
        this.pendingWritesCount = Math.max(0, this.pendingWritesCount - 1);
      });

    return this.writeChain;
  }

  private initLifecycleListeners(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.pageHideHandler = () => {
        this.flush();
      };
      window.addEventListener('pagehide', this.pageHideHandler);
    }

    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      this.visibilityChangeHandler = () => {
        if (document.visibilityState === 'hidden') {
          this.flush();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    }
  }

  public destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function' &&
      this.pageHideHandler
    ) {
      window.removeEventListener('pagehide', this.pageHideHandler);
      this.pageHideHandler = undefined;
    }
    if (
      typeof document !== 'undefined' &&
      typeof document.removeEventListener === 'function' &&
      this.visibilityChangeHandler
    ) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = undefined;
    }
  }
}
