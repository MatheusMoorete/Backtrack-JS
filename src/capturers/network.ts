import { sanitizeUrl, sanitizePayloadString, sanitizeHeaders } from './sanitizer';
import type { BatchWriter } from '../storage/batch-writer';
import type { IncidentManager } from '../storage/incident-manager';
import type { NetworkTimelineEvent, NetworkResult } from '../types/timeline';

export interface NetworkCapturerConfig {
  captureHttpStatus: number[]; // default [500, 502, 503, 504]
  ignoredUrls?: (string | RegExp)[];
  sanitizeUrlCallback?: (url: URL) => string;
  capturePayloads?: boolean; // default true
  maxPayloadSize?: number; // default 64KB
}

interface XHRMetadata {
  method: string;
  url: string;
  startTime: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
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
  private originalXHRSetHeader: typeof XMLHttpRequest.prototype.setRequestHeader | null = null;
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
      ignoredUrls: config?.ignoredUrls ?? [],
      sanitizeUrlCallback: config?.sanitizeUrlCallback,
      capturePayloads: config?.capturePayloads ?? true,
      maxPayloadSize: config?.maxPayloadSize ?? 64 * 1024
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
      let rawReqHeaders = init?.headers;
      let rawReqBody: string | undefined = undefined;

      if (typeof input === 'string') {
        rawUrl = input;
      } else if (input instanceof URL) {
        rawUrl = input.href;
      } else if (input && typeof (input as Request).url === 'string') {
        const req = input as Request;
        rawUrl = req.url;
        method = req.method || method;
        rawReqHeaders = rawReqHeaders || req.headers;
      }

      if (self.config.capturePayloads && init?.body) {
        try {
          if (typeof init.body === 'string') {
            rawReqBody = init.body;
          } else if (typeof URLSearchParams !== 'undefined' && init.body instanceof URLSearchParams) {
            rawReqBody = init.body.toString();
          }
        } catch {
          // Ignora erro ao extrair body de request
        }
      }

      if (!self.isRecording || self.shouldIgnoreUrl(rawUrl)) {
        return self.originalFetch!.call(this, input, init);
      }

      const startTime = Date.now();
      const sanitized = sanitizeUrl(rawUrl, self.config.sanitizeUrlCallback);
      const reqHeaders = self.config.capturePayloads
        ? sanitizeHeaders(rawReqHeaders as Headers | Record<string, string>)
        : undefined;
      const reqBody = self.config.capturePayloads && rawReqBody
        ? sanitizePayloadString(rawReqBody, self.config.maxPayloadSize)
        : undefined;

      try {
        const response = await self.originalFetch!.call(this, input, init);
        const durationMs = Date.now() - startTime;
        const status = response.status;
        const result: NetworkResult = status >= 400 ? 'error' : 'success';

        let resHeaders: Record<string, string> | undefined = undefined;
        let resBody: string | undefined = undefined;

        if (self.config.capturePayloads) {
          try {
            resHeaders = sanitizeHeaders(response.headers);
            const ctype = response.headers?.get('content-type') || '';
            if (
              ctype.includes('json') ||
              ctype.includes('text') ||
              ctype.includes('xml') ||
              ctype.includes('javascript') ||
              ctype.includes('form')
            ) {
              const clone = response.clone();
              const text = await clone.text();
              resBody = sanitizePayloadString(text, self.config.maxPayloadSize);
            }
          } catch {
            // Ignora falhas de clonagem ou leitura assíncrona
          }
        }

        self.recordNetworkEvent({
          method: method.toUpperCase(),
          url: sanitized,
          status,
          durationMs,
          result,
          requestHeaders: reqHeaders,
          requestBody: reqBody,
          responseHeaders: resHeaders,
          responseBody: resBody
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
          result,
          requestHeaders: reqHeaders,
          requestBody: reqBody
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
    this.originalXHRSetHeader = proto.setRequestHeader;

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
          startTime: 0,
          requestHeaders: {}
        });
      }
      return self.originalXHROpen!.call(this, method, url, async, username, password);
    };

    proto.setRequestHeader = function (header: string, value: string) {
      const meta = self.xhrMetadata.get(this);
      if (meta && meta.requestHeaders) {
        meta.requestHeaders[header] = value;
      }
      return self.originalXHRSetHeader!.call(this, header, value);
    };

    proto.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
      const meta = self.xhrMetadata.get(this);
      if (self.isRecording && meta && !self.shouldIgnoreUrl(meta.url)) {
        meta.startTime = Date.now();
        const sanitized = sanitizeUrl(meta.url, self.config.sanitizeUrlCallback);

        if (self.config.capturePayloads && typeof body === 'string') {
          meta.requestBody = body;
        }

        let hasFinished = false;
        const onFinish = (result: NetworkResult, status: number) => {
          if (hasFinished) return;
          hasFinished = true;
          const durationMs = meta.startTime ? Date.now() - meta.startTime : 0;

          let resHeaders: Record<string, string> | undefined = undefined;
          let resBody: string | undefined = undefined;

          if (self.config.capturePayloads) {
            try {
              const rawRespHeaders = this.getAllResponseHeaders();
              if (rawRespHeaders) {
                const headerMap: Record<string, string> = {};
                for (const line of rawRespHeaders.trim().split(/[\r\n]+/)) {
                  const parts = line.split(': ');
                  const header = parts.shift();
                  const value = parts.join(': ');
                  if (header) headerMap[header] = value;
                }
                resHeaders = sanitizeHeaders(headerMap);
              }

              if (this.responseType === '' || this.responseType === 'text') {
                if (typeof this.responseText === 'string') {
                  resBody = sanitizePayloadString(this.responseText, self.config.maxPayloadSize);
                }
              }
            } catch {
              // Ignora
            }
          }

          self.recordNetworkEvent({
            method: meta.method,
            url: sanitized,
            status,
            durationMs,
            result,
            requestHeaders: sanitizeHeaders(meta.requestHeaders),
            requestBody: meta.requestBody
              ? sanitizePayloadString(meta.requestBody, self.config.maxPayloadSize)
              : undefined,
            responseHeaders: resHeaders,
            responseBody: resBody
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
    requestHeaders?: Record<string, string>;
    requestBody?: string;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
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
      result: params.result,
      requestHeaders: params.requestHeaders,
      requestBody: params.requestBody,
      responseHeaders: params.responseHeaders,
      responseBody: params.responseBody
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
