import { sanitizeAndSerialize } from './sanitizer';
import type { BatchWriter } from '../storage/batch-writer';
import type { ConsoleLogLevel, ConsoleTimelineEvent } from '../types/timeline';

export class ConsoleCapturer {
  private writer: BatchWriter;
  private isRecording = false;
  private sequenceProvider: () => number;

  private originalLog: typeof console.log | null = null;
  private originalWarn: typeof console.warn | null = null;
  private originalError: typeof console.error | null = null;

  private wrappedLog: typeof console.log | null = null;
  private wrappedWarn: typeof console.warn | null = null;
  private wrappedError: typeof console.error | null = null;

  private isInsideHook = false;

  constructor(writer: BatchWriter, sequenceProvider: () => number) {
    this.writer = writer;
    this.sequenceProvider = sequenceProvider;
  }

  public start(): void {
    if (this.isRecording) return;
    this.isRecording = true;

    this.originalLog = console.log;
    this.originalWarn = console.warn;
    this.originalError = console.error;

    this.wrappedLog = (...args: unknown[]) => {
      this.handleConsole('log', this.originalLog!, args);
    };
    this.wrappedWarn = (...args: unknown[]) => {
      this.handleConsole('warn', this.originalWarn!, args);
    };
    this.wrappedError = (...args: unknown[]) => {
      this.handleConsole('error', this.originalError!, args);
    };

    console.log = this.wrappedLog;
    console.warn = this.wrappedWarn;
    console.error = this.wrappedError;
  }

  private handleConsole(
    level: ConsoleLogLevel,
    originalMethod: (...args: unknown[]) => void,
    args: unknown[]
  ): void {
    // 1. Sempre chama o método original com os argumentos intocados
    try {
      originalMethod.apply(console, args);
    } catch {
      // Ignora erro do método original
    }

    // Evita recursão infinita se a sanitização ou o storage invocarem console
    if (this.isInsideHook || !this.isRecording) return;
    this.isInsideHook = true;

    try {
      const sanitizedArgs = args.map((arg) => sanitizeAndSerialize(arg));
      const event: ConsoleTimelineEvent = {
        id: `con_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
        sequence: this.sequenceProvider(),
        type: 'console',
        level,
        args: sanitizedArgs
      };
      this.writer.addTimelineEvent(event);
    } catch {
      // Falhas no capturador nunca sobem
    } finally {
      this.isInsideHook = false;
    }
  }

  public stop(): void {
    if (!this.isRecording) return;
    this.isRecording = false;

    // Restaura apenas se os métodos atuais ainda forem os wrappers instalados
    if (console.log === this.wrappedLog && this.originalLog) {
      console.log = this.originalLog;
    }
    if (console.warn === this.wrappedWarn && this.originalWarn) {
      console.warn = this.originalWarn;
    }
    if (console.error === this.wrappedError && this.originalError) {
      console.error = this.originalError;
    }

    this.originalLog = null;
    this.originalWarn = null;
    this.originalError = null;
    this.wrappedLog = null;
    this.wrappedWarn = null;
    this.wrappedError = null;
  }
}
