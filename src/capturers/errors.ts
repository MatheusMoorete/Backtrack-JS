import { redactSensitiveString } from './sanitizer';
import type { BatchWriter } from '../storage/batch-writer';
import type { IncidentManager } from '../storage/incident-manager';
import type { ErrorSource, ErrorTimelineEvent } from '../types/timeline';
import type { ErrorContext } from '../types/options';

export class ErrorCapturer {
  private writer: BatchWriter;
  private incidentManager: IncidentManager;
  private sequenceProvider: () => number;
  private isRecording = false;

  private errorHandler?: (event: ErrorEvent) => void;
  private rejectionHandler?: (event: PromiseRejectionEvent) => void;

  constructor(
    writer: BatchWriter,
    incidentManager: IncidentManager,
    sequenceProvider: () => number
  ) {
    this.writer = writer;
    this.incidentManager = incidentManager;
    this.sequenceProvider = sequenceProvider;
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;

    if (typeof window === 'undefined') return;

    // 1. window.error em capture phase
    this.errorHandler = (event: ErrorEvent) => {
      this.handleGlobalError(event);
    };
    window.addEventListener('error', this.errorHandler, true);

    // 2. unhandledrejection
    this.rejectionHandler = (event: PromiseRejectionEvent) => {
      this.handleUnhandledRejection(event);
    };
    window.addEventListener('unhandledrejection', this.rejectionHandler);
  }

  private handleGlobalError(event: ErrorEvent): void {
    if (!this.isRecording) return;

    try {
      const errorObj = event.error instanceof Error ? event.error : null;
      const name = errorObj?.name || 'Error';
      const message = redactSensitiveString(event.message || errorObj?.message || 'Unknown error');
      const stack = errorObj?.stack ? redactSensitiveString(errorObj.stack) : undefined;
      const filename = event.filename || undefined;
      const lineno = event.lineno || undefined;
      const colno = event.colno || undefined;

      this.recordAndTriggerError({
        source: 'window',
        name,
        message,
        stack,
        filename,
        lineno,
        colno
      });
    } catch {
      // Ignora erro interno
    }
  }

  private handleUnhandledRejection(event: PromiseRejectionEvent): void {
    if (!this.isRecording) return;

    try {
      const reason = event.reason;
      let name = 'UnhandledRejection';
      let message = 'Promise rejeitada';
      let stack: string | undefined;

      if (reason instanceof Error) {
        name = reason.name;
        message = redactSensitiveString(reason.message);
        stack = reason.stack ? redactSensitiveString(reason.stack) : undefined;
      } else if (typeof reason === 'string') {
        message = redactSensitiveString(reason);
      } else if (reason && typeof reason === 'object') {
        message = redactSensitiveString(JSON.stringify(reason));
      }

      this.recordAndTriggerError({
        source: 'unhandledrejection',
        name,
        message,
        stack
      });
    } catch {
      // Ignora erro interno
    }
  }

  /**
   * API pública para capturar exceções explicitamente (ex: do SentryBoundary do uTicket).
   */
  public captureException(error: unknown, context?: ErrorContext): void {
    if (!this.isRecording) return;

    try {
      let name = 'Error';
      let message = 'Exceção capturada';
      let stack: string | undefined;
      let componentStack: string | undefined;

      if (error instanceof Error) {
        name = error.name;
        message = redactSensitiveString(error.message);
        stack = error.stack ? redactSensitiveString(error.stack) : undefined;
      } else if (typeof error === 'string') {
        message = redactSensitiveString(error);
      }

      if (context?.componentStack) {
        componentStack = redactSensitiveString(context.componentStack);
      }

      const source: ErrorSource = context?.source === 'react' ? 'react' : 'manual';

      this.recordAndTriggerError({
        source,
        name,
        message,
        stack,
        componentStack
      });
    } catch {
      // Não relança
    }
  }

  private recordAndTriggerError(params: {
    source: ErrorSource;
    name: string;
    message: string;
    stack?: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    componentStack?: string;
  }): void {
    const now = Date.now();
    const event: ErrorTimelineEvent = {
      id: `err_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      sequence: this.sequenceProvider(),
      type: 'error',
      source: params.source,
      name: params.name,
      message: params.message,
      stack: params.stack,
      filename: params.filename,
      lineno: params.lineno,
      colno: params.colno,
      componentStack: params.componentStack
    };

    this.writer.addTimelineEvent(event);

    // Cria assinatura do gatilho para deduplicação
    const firstStackLine = params.stack ? params.stack.split('\n')[1]?.trim() || '' : '';
    const signature = `${params.name}:${params.message}:${firstStackLine}`;

    const reason =
      params.source === 'react'
        ? 'react'
        : params.source === 'unhandledrejection'
        ? 'unhandledrejection'
        : 'error';

    this.incidentManager.trigger(reason, {
      id: `trig_${now}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: now,
      type: reason,
      signature,
      detail: {
        source: params.source,
        message: params.message,
        filename: params.filename
      }
    });
  }

  public stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    if (typeof window !== 'undefined') {
      if (this.errorHandler) {
        window.removeEventListener('error', this.errorHandler, true);
        this.errorHandler = undefined;
      }
      if (this.rejectionHandler) {
        window.removeEventListener('unhandledrejection', this.rejectionHandler);
        this.rejectionHandler = undefined;
      }
    }
  }
}
