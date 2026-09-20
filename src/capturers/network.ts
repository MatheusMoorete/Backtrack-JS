import { sanitizeUrl } from './sanitizer';
import type { BatchWriter } from '../storage/batch-writer';
import type { IncidentManager } from '../storage/incident-manager';
import type { NetworkTimelineEvent, NetworkResult } from '../types/timeline';

export interface NetworkCapturerConfig {
  captureHttpStatus: number[]; // default [500, 502, 503, 504]
  ignoredUrls?: (string | RegExp)[];
  sanitizeUrlCallback?: (url: URL) => string;
}

interface XHRMetadata {
  method: string;
  url: string;
  startTime: number;
}

export class NetworkCapturer {
  private writer: BatchWriter;
  private incidentManager: IncidentManager;
  private sequenceProvider: () => number;
  private config: NetworkCapturerConfig;
  private isRecording = false;

  private originalFetch: typeof window.fetch | null = null;
  private wrappedFetch: typeof window.fetch | null = null;

  private originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXHRSend: typeof XMLHttpRequest.prototype.send | null = null;
  private xhrMetadata = new WeakMap<XMLHttpRequest, XHRMetadata>();

  constructor(
    writer: BatchWriter,
    incidentManager: IncidentManager,
    sequenceProvider: () => number,
    config?: Partial<NetworkCapturerConfig>
  ) {
    this.writer = writer;
    this.incidentManager = incidentManager;
    this.sequenceProvider = sequenceProvider;
    this.config = {
      captureHttpStatus: config?.captureHttpStatus ?? [500, 502, 503, 504],
      ignoredUrls: config?.ignoredUrls,
      sanitizeUrlCallback: config?.sanitizeUrlCallback
    };
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;

    this.instrumentFetch();
    this.instrumentXHR();
  }

  private shouldIgnoreUrl(urlStr: string): boolean {
    if (!urlStr) return true;

    // Ignora esquemas internos e extensões
    if (
      urlStr.startsWith('data:') ||
      urlStr.startsWith('blob:') ||
      urlStr.startsWith('chrome-extension:') ||
      urlStr.startsWith('moz-extension:')
    ) {
      return true;
    }

    // Ignora probes internos e tráfego com o próprio servidor do visualizador local
    if (
      urlStr.includes(':5173') ||
      urlStr.includes('localhost:5173') ||
      urlStr.includes('127.0.0.1:5173') ||
      urlStr.includes('__backtrack_') ||
      urlStr.includes('__ffr_')
    ) {
      return true;
    }

    if (this.config.ignoredUrls) {
      for (const pattern of this.config.ignoredUrls) {
        if (typeof pattern === 'string' && urlStr.includes(pattern)) return true;
        if (pattern instanceof RegExp && pattern.test(urlStr)) return true;
      }
    }

    return false;
  }

  private instrumentFetch(): void {
    if (typeof window === 'undefined' || !window.fetch) return;

    this.originalFetch = window.fetch;
    const self = this;

    this.wrappedFetch = async function (
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      let rawUrl = '';
      let method = init?.method || 'GET';

      if (typeof input === 'string') {
        rawUrl = input;
      } else if (input instanceof URL) {
        rawUrl = input.href;
      } else if (input && typeof (input as Request).url === 'string') {
        rawUrl = (input as Request).url;
        method = (input as Request).method || method;
      }

      if (!self.isRecording || self.shouldIgnoreUrl(rawUrl)) {
        return self.originalFetch!.call(this, input, init);
      }

      const startTime = Date.now();
      const sanitized = sanitizeUrl(rawUrl, self.config.sanitizeUrlCallback);

      try {
        const response = await self.originalFetch!.call(this, input, init);
        const durationMs = Date.now() - startTime;
        const status = response.status;
        const result: NetworkResult = status >= 400 ? 'error' : 'success';

        self.recordNetworkEvent({
          method: method.toUpperCase(),
          url: sanitized,
          status,
          durationMs,
          result
        });

        return response;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        const isAbort = err instanceof DOMException && err.name === 'AbortError';
        const result: NetworkResult = isAbort ? 'abort' : 'error';

        self.recordNetworkEvent({
          method: method.toUpperCase(),
          url: sanitized,
          status: 0,
          durationMs,
          result
        });

        throw err;
      }
    };

    window.fetch = this.wrappedFetch;
  }

  private instrumentXHR(): void {
    if (typeof window === 'undefined' || !window.XMLHttpRequest) return;

    const self = this;
    const proto = window.XMLHttpRequest.prototype;

    this.originalXHROpen = proto.open;
    this.originalXHRSend = proto.send;

    proto.open = function (
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ) {
      if (self.isRecording) {
        const rawUrl = typeof url === 'string' ? url : url.href;
        self.xhrMetadata.set(this, {
          method: (method || 'GET').toUpperCase(),
          url: rawUrl,
          startTime: 0
        });
      }
      return self.originalXHROpen!.call(this, method, url, async, username, password);
    };

    proto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = self.xhrMetadata.get(this);
      if (self.isRecording && meta && !self.shouldIgnoreUrl(meta.url)) {
        meta.startTime = Date.now();
        const sanitized = sanitizeUrl(meta.url, self.config.sanitizeUrlCallback);

        let hasFinished = false;
        const onFinish = (result: NetworkResult, status: number) => {
          if (hasFinished) return;
          hasFinished = true;
          const durationMs = meta.startTime ? Date.now() - meta.startTime : 0;
          self.recordNetworkEvent({
            method: meta.method,
            url: sanitized,
            status,
            durationMs,
            result
          });
        };

        this.addEventListener(
          'loadend',
          () => {
            const status = this.status || 0;
            const result: NetworkResult = status === 0 ? 'error' : status >= 400 ? 'error' : 'success';
            onFinish(result, status);
          },
          { once: true }
        );

        this.addEventListener('error', () => onFinish('error', this.status || 0), { once: true });
        this.addEventListener('timeout', () => onFinish('timeout', 0), { once: true });
        this.addEventListener('abort', () => onFinish('abort', 0), { once: true });

        try {
          return self.originalXHRSend!.call(this, body);
        } catch (err) {
          onFinish('error', 0);
          throw err;
        }
      }

      return self.originalXHRSend!.call(this, body);
    };
  }

  private recordNetworkEvent(params: {
    method: string;
    url: string;
    status: number;
    durationMs: number;
    result: NetworkResult;
  }): void {
    const now = Date.now();
    const event: NetworkTimelineEvent = {
      id: `net_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      sequence: this.sequenceProvider(),
      type: 'network',
      method: params.method,
      url: params.url,
      status: params.status,
      durationMs: params.durationMs,
      result: params.result
    };

    this.writer.addTimelineEvent(event);

    // Se o status HTTP estiver na lista de triggers (ex: 500+) ou falha de rede/CORS (status 0 e result error)
    const isTrigger =
      this.config.captureHttpStatus.includes(params.status) ||
      (params.status === 0 && params.result === 'error');

    if (isTrigger) {
      this.incidentManager.trigger('http', {
        id: `trig_http_${now}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: now,
        type: 'http',
        signature: `HTTP ${params.status === 0 ? 'CORS/ERR' : params.status} ${params.method} ${params.url}`,
        detail: {
          method: params.method,
          url: params.url,
          status: params.status,
          result: params.result
        }
      });
    }
  }

  public stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (typeof window !== 'undefined') {
      if (window.fetch === this.wrappedFetch && this.originalFetch) {
        window.fetch = this.originalFetch;
      }
      if (window.XMLHttpRequest) {
        if (
          window.XMLHttpRequest.prototype.open !== this.originalXHROpen &&
          this.originalXHROpen
        ) {
          window.XMLHttpRequest.prototype.open = this.originalXHROpen;
        }
        if (
          window.XMLHttpRequest.prototype.send !== this.originalXHRSend &&
          this.originalXHRSend
        ) {
          window.XMLHttpRequest.prototype.send = this.originalXHRSend;
        }
      }
    }

    this.originalFetch = null;
    this.wrappedFetch = null;
    this.originalXHROpen = null;
    this.originalXHRSend = null;
  }
}
