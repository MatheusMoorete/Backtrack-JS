import { sanitizeUrl } from './sanitizer';
import type { BatchWriter } from '../storage/batch-writer';
import type { NavigationTimelineEvent, NavigationKind } from '../types/timeline';

export interface NavigationCapturerConfig {
  sanitizeUrlCallback?: (url: URL) => string;
}

export class NavigationCapturer {
  private writer: BatchWriter;
  private sequenceProvider: () => number;
  private config: NavigationCapturerConfig;
  private isRecording = false;

  private currentUrl = '';
  private originalPushState: typeof window.history.pushState | null = null;
  private originalReplaceState: typeof window.history.replaceState | null = null;

  private popstateHandler?: () => void;
  private hashchangeHandler?: () => void;

  constructor(
    writer: BatchWriter,
    sequenceProvider: () => number,
    config?: NavigationCapturerConfig
  ) {
    this.writer = writer;
    this.sequenceProvider = sequenceProvider;
    this.config = config || {};
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;

    if (typeof window === 'undefined') return;

    // 1. Carga inicial
    this.currentUrl = window.location.href;
    this.recordNavigation('initial', this.currentUrl);

    // 2. Monkey-patch pushState & replaceState
    const self = this;
    const history = window.history;

    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      self.originalPushState!.apply(this, args);
      const newUrl = window.location.href;
      self.recordNavigation('pushState', newUrl);
    };

    history.replaceState = function (...args) {
      self.originalReplaceState!.apply(this, args);
      const newUrl = window.location.href;
      self.recordNavigation('replaceState', newUrl);
    };

    // 3. Listeners de popstate e hashchange
    this.popstateHandler = () => {
      this.recordNavigation('popstate', window.location.href);
    };
    window.addEventListener('popstate', this.popstateHandler);

    this.hashchangeHandler = () => {
      this.recordNavigation('hashchange', window.location.href);
    };
    window.addEventListener('hashchange', this.hashchangeHandler);
  }

  private recordNavigation(kind: NavigationKind, toRawUrl: string): void {
    if (!this.isRecording) return;

    const fromSanitized = this.currentUrl ? sanitizeUrl(this.currentUrl, this.config.sanitizeUrlCallback) : undefined;
    const toSanitized = sanitizeUrl(toRawUrl, this.config.sanitizeUrlCallback);
    this.currentUrl = toRawUrl;

    const event: NavigationTimelineEvent = {
      id: `nav_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      sequence: this.sequenceProvider(),
      type: 'navigation',
      kind,
      fromUrl: fromSanitized,
      toUrl: toSanitized
    };

    this.writer.addTimelineEvent(event);
  }

  public stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (typeof window !== 'undefined') {
      if (this.originalPushState) {
        window.history.pushState = this.originalPushState;
      }
      if (this.originalReplaceState) {
        window.history.replaceState = this.originalReplaceState;
      }
      if (this.popstateHandler) {
        window.removeEventListener('popstate', this.popstateHandler);
      }
      if (this.hashchangeHandler) {
        window.removeEventListener('hashchange', this.hashchangeHandler);
      }
    }

    this.originalPushState = null;
    this.originalReplaceState = null;
    this.popstateHandler = undefined;
    this.hashchangeHandler = undefined;
  }
}
