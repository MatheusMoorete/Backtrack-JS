import { record } from '@rrweb/record';
import type { BatchWriter } from '../storage/batch-writer';
import type { PrivacyOptions } from '../types/options';
import type { RrwebEvent } from '../types/chunk';

import { matchesSensitiveRoute } from './route-matcher';

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
      const blockSelector = [
        privacy.blockSelector,
        '.backtrack-block',
        '.ffr-block',
        '[data-backtrack-block]',
        '#__backtrack_annotator_overlay__',
        '#__backtrack_widget_host__',
        '.backtrack-ignore',
        '.rr-ignore',
        '.rr-block',
        '[data-rr-ignore]',
        '[data-backtrack-ignore]'
      ]
        .filter(Boolean)
        .join(', ');

      const maskTextSelector = [
        privacy.maskTextSelector,
        '.backtrack-mask',
        '.ffr-mask',
        '[data-backtrack-mask]'
      ]
        .filter(Boolean)
        .join(', ');

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
        maskTextSelector: maskTextSelector || undefined,
        blockSelector: blockSelector || undefined,
        blockClass: 'backtrack-block',
        ignoreClass: 'backtrack-ignore',
        maskTextClass: 'backtrack-mask',
        maskTextFn: (text: string) => {
          const isSensitive =
            privacy.maskAllText ||
            (typeof window !== 'undefined' &&
              matchesSensitiveRoute(window.location.pathname, privacy.sensitiveRoutes));

          if (isSensitive) {
            return text.replace(/[^\s]/g, '*');
          }
          return text;
        },
        checkoutEveryNms: this.config.checkoutEveryNms ?? 30000,
        sampling: {
          mousemove: 50, // amostrado
          mouseInteraction: true,
          scroll: 150,
          input: 'last'
        },
        // Gravação de canvas: respeita flag explícita ou habilita quando blockMedia for false
        recordCanvas: privacy.recordCanvas ?? (privacy.blockMedia === false),
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
