import { record } from '@rrweb/record';
import type { BatchWriter } from '../storage/batch-writer';
import type { PrivacyOptions } from '../types/options';
import type { RrwebEvent } from '../types/chunk';

export interface RrwebCapturerConfig {
  privacy?: PrivacyOptions;
  checkoutEveryNms?: number; // default 60000ms (60s)
}

export class RrwebCapturer {
  private writer: BatchWriter;
  private config: RrwebCapturerConfig;
  private isRecording = false;
  private stopRecordFn: (() => void) | null = null;
  private droppedEventsCount = 0;

  constructor(writer: BatchWriter, config?: RrwebCapturerConfig) {
    this.writer = writer;
    this.config = config || {};
  }

  public getDroppedEventsCount(): number {
    return this.droppedEventsCount;
  }

  public start(): void {
    if (this.isRecording) return;
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    this.isRecording = true;

    try {
      const privacy = this.config.privacy || {};

      this.stopRecordFn = record({
        emit: (event: unknown, isCheckout?: boolean) => {
          if (!this.isRecording) return;

          try {
            const rrwebEvt = event as RrwebEvent;
            if (isCheckout) {
              // Checkout forces flush to synchronize chunk boundary
              this.writer.flush();
            }
            this.writer.addReplayEvent(rrwebEvt);
          } catch {
            this.droppedEventsCount++;
          }
        },
        maskAllInputs: privacy.maskAllInputs !== false,
        maskTextSelector: privacy.maskTextSelector,
        blockSelector: privacy.blockSelector,
        blockClass: 'ffr-block',
        ignoreClass: 'ffr-ignore',
        maskTextClass: 'ffr-mask',
        checkoutEveryNms: this.config.checkoutEveryNms ?? 30000,
        sampling: {
          mousemove: 50, // amostrado
          mouseInteraction: true,
          scroll: 150,
          input: 'last'
        },
        // Bloqueio estrito de mídia e canvas conforme SPEC.md
        recordCanvas: false,
        collectFonts: false
      }) || null;
    } catch {
      this.droppedEventsCount++;
      this.isRecording = false;
    }
  }

  public stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (this.stopRecordFn) {
      try {
        this.stopRecordFn();
      } catch {
        // Noop
      }
      this.stopRecordFn = null;
    }
  }
}
