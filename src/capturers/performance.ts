import type { BatchWriter } from '../storage/batch-writer';
import type { PerformanceTimelineEvent } from '../types/timeline';

export interface PerformanceCapturerConfig {
  longTaskThresholdMs?: number; // default 50ms
}

export class PerformanceCapturer {
  private writer: BatchWriter;
  private sequenceProvider: () => number;
  private observer: PerformanceObserver | null = null;
  private isRecording = false;
  private thresholdMs: number;

  constructor(
    writer: BatchWriter,
    sequenceProvider: () => number,
    config?: PerformanceCapturerConfig
  ) {
    this.writer = writer;
    this.sequenceProvider = sequenceProvider;
    this.thresholdMs = config?.longTaskThresholdMs ?? 50;
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;

    if (typeof PerformanceObserver === 'undefined') {
      return;
    }

    try {
      // Verifica se o tipo 'longtask' é suportado pelo navegador
      const supported = PerformanceObserver.supportedEntryTypes || [];
      if (!supported.includes('longtask')) {
        return;
      }

      this.observer = new PerformanceObserver((list) => {
        if (!this.isRecording) return;
        const entries = list.getEntries();
        for (const entry of entries) {
          if (entry.duration >= this.thresholdMs) {
            const now = Date.now();
            const event: PerformanceTimelineEvent = {
              id: `perf_${now}_${Math.random().toString(36).substring(2, 7)}`,
              timestamp: now,
              sequence: this.sequenceProvider(),
              type: 'performance',
              metric: 'longtask',
              durationMs: Math.round(entry.duration),
              details: entry.name || 'Main thread blocked'
            };
            this.writer.addTimelineEvent(event);
          }
        }
      });

      this.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // Falhas ao inicializar PerformanceObserver nunca quebram o app
      this.observer = null;
    }
  }

  public stop(): void {
    this.isRecording = false;
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch {
        // Noop
      }
      this.observer = null;
    }
  }
}
