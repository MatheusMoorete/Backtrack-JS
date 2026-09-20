import type { FlightRecorderDB } from './db';
import type { StoredChunk, RrwebEvent } from '../types/chunk';
import type { TimelineEvent } from '../types/timeline';

export interface BatchWriterConfig {
  flushIntervalMs: number; // default 1000ms
  maxBatchEvents: number;  // default 250
  chunkDurationMs: number; // default 60000ms (60s)
}

export class BatchWriter {
  private db: FlightRecorderDB;
  private config: BatchWriterConfig;
  private sessionId: string;
  private tabId: string;

  private currentChunk: StoredChunk | null = null;
  private chunkSequence = 0;
  private pendingTimelineEvents: TimelineEvent[] = [];
  private pendingReplayEvents: RrwebEvent[] = [];

  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private pendingWritesCount = 0;
  private onErrorCallback?: (error: unknown) => void;
  private onChunkPersistedCallback?: (chunk: StoredChunk) => void;
  private pageHideHandler?: () => void;

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
      chunkDurationMs: config?.chunkDurationMs ?? 60000
    };
    this.onErrorCallback = onError;

    this.initPageHideListener();
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

    // Se não há chunk atual ou se o chunk excedeu a duração padrão, abre um novo
    if (!this.currentChunk || now - this.currentChunk.startedAt >= this.config.chunkDurationMs) {
      this.chunkSequence++;
      this.currentChunk = {
        id: `chk_${this.sessionId}_${this.chunkSequence}_${now}`,
        sessionId: this.sessionId,
        tabId: this.tabId,
        sequence: this.chunkSequence,
        startedAt: now,
        endedAt: now,
        sizeBytes: 0,
        replay: [],
        timeline: []
      };
    }

    this.currentChunk.timeline.push(...timelineToFlush);
    this.currentChunk.replay.push(...replayToFlush);
    this.currentChunk.endedAt = now;

    // Estimativa grosseira de bytes do chunk
    const serialized = JSON.stringify(this.currentChunk);
    this.currentChunk.sizeBytes = serialized.length;

    const chunkCopy: StoredChunk = {
      ...this.currentChunk,
      timeline: [...this.currentChunk.timeline],
      replay: [...this.currentChunk.replay]
    };

    this.pendingWritesCount++;

    this.writeChain = this.writeChain
      .then(async () => {
        await this.db.putChunk(chunkCopy);
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

  private initPageHideListener(): void {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.pageHideHandler = () => {
        this.flush();
      };
      window.addEventListener('pagehide', this.pageHideHandler);
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
    }
  }
}
