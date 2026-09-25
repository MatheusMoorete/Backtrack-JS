import { FlightRecorderDB } from '../storage/db';
import { BatchWriter } from '../storage/batch-writer';
import { RetentionEngine } from '../storage/retention';
import { IncidentManager } from '../storage/incident-manager';
import { claimSessionContext } from '../storage/session';
import { RecorderStateMachine } from './state-machine';

import { ConsoleCapturer } from '../capturers/console';
import { ErrorCapturer } from '../capturers/errors';
import { NetworkCapturer } from '../capturers/network';
import { NavigationCapturer } from '../capturers/navigation';
import { RrwebCapturer } from '../capturers/rrweb';
import { PerformanceCapturer } from '../capturers/performance';

import { BacktrackWidget } from '../widget/widget';

import type {
  FlightRecorder,
  FlightRecorderOptions,
  CaptureOptions,
  ErrorContext
} from '../types/options';
import type { RecorderHealth } from '../types/health';
import type { IncidentSummary } from '../types/incident';
import type { EnvironmentMetadata, FlightRecorderArtifactV1 } from '../types/artifact';
import { compressArtifact } from '../utils/compression';

export class FlightRecorderImpl implements FlightRecorder {
  private static activeInstance: FlightRecorderImpl | null = null;

  private options: FlightRecorderOptions;
  private stateMachine: RecorderStateMachine;
  private db: FlightRecorderDB;
  private writer: BatchWriter | null = null;
  private retention: RetentionEngine;
  private incidentManager: IncidentManager | null = null;
  private widget: BacktrackWidget | null = null;

  private consoleCapturer: ConsoleCapturer | null = null;
  private errorCapturer: ErrorCapturer | null = null;
  private networkCapturer: NetworkCapturer | null = null;
  private navigationCapturer: NavigationCapturer | null = null;
  private rrwebCapturer: RrwebCapturer | null = null;
  private performanceCapturer: PerformanceCapturer | null = null;

  private sequence = 0;
  private retentionIntervalTimer: ReturnType<typeof setInterval> | null = null;
  private retentionPromise: Promise<void> | null = null;
  private cachedStorageBytes = 0;
  private cachedIncidentCount = 0;
  private cachedProtectedBytes = 0;
  private cachedBrowserEstimateBytes?: number;
  private cachedBrowserQuotaBytes?: number;

  constructor(options?: FlightRecorderOptions, customDb?: FlightRecorderDB) {
    this.options = {
      bufferMinutes: options?.bufferMinutes ?? 5,
      afterErrorSeconds: options?.afterErrorSeconds ?? 15,
      maxStorageMb: options?.maxStorageMb ?? 50,
      captureHttpStatus: options?.captureHttpStatus ?? [500, 502, 503, 504],
      showWidget: options?.showWidget ?? false,
      widgetOptions: options?.widgetOptions,
      metadata: options?.metadata,
      recorderVersion: options?.recorderVersion,
      ignoredUrls: options?.ignoredUrls,
      privacy: {
        maskAllInputs: options?.privacy?.maskAllInputs ?? true,
        maskAllText: options?.privacy?.maskAllText ?? false,
        blockMedia: options?.privacy?.blockMedia ?? true,
        blockSelector: options?.privacy?.blockSelector,
        maskTextSelector: options?.privacy?.maskTextSelector,
        sanitizeUrl: options?.privacy?.sanitizeUrl,
        sensitiveRoutes: options?.privacy?.sensitiveRoutes,
        autoMaskPII: options?.privacy?.autoMaskPII,
        recordCanvas: options?.privacy?.recordCanvas
      },
      storage: options?.storage,
      sessionOptions: options?.sessionOptions,
      batchWriterConfig: options?.batchWriterConfig
    };

    this.stateMachine = new RecorderStateMachine('stopped');
    this.db = customDb || new FlightRecorderDB();
    this.retention = new RetentionEngine(this.db, {
      bufferMinutes: this.options.bufferMinutes,
      maxStorageMb: this.options.maxStorageMb
    });
  }

  public static async init(
    options?: FlightRecorderOptions,
    customDb?: FlightRecorderDB
  ): Promise<FlightRecorderImpl> {
    if (FlightRecorderImpl.activeInstance) {
      return FlightRecorderImpl.activeInstance;
    }
    const recorder = new FlightRecorderImpl(options, customDb);
    await recorder.start();
    FlightRecorderImpl.activeInstance = recorder;

    if (typeof window !== 'undefined') {
      const win = window as any;
      win.Backtrack = FlightRecorderImpl;
      win.flightRecorder = recorder;
      win.hideBacktrack = () => FlightRecorderImpl.hideWidget();
      win.showBacktrack = () => FlightRecorderImpl.showWidget();
      win.toggleBacktrack = () => FlightRecorderImpl.toggleWidget();
    }

    return recorder;
  }

  public static hideWidget(): void {
    const inst = FlightRecorderImpl.activeInstance;
    if (inst?.widget) {
      inst.widget.hide();
    } else {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('backtrack_widget_hidden', 'true');
        }
        if (typeof document !== 'undefined') {
          const el = document.getElementById('__backtrack_widget_host__');
          if (el) el.style.display = 'none';
        }
      } catch {}
    }
  }

  public static showWidget(): void {
    const inst = FlightRecorderImpl.activeInstance;
    if (inst?.widget) {
      inst.widget.show();
    } else {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('backtrack_widget_hidden');
        }
        if (typeof document !== 'undefined') {
          const el = document.getElementById('__backtrack_widget_host__');
          if (el) el.style.display = '';
        }
      } catch {}
    }
  }

  public static toggleWidget(): boolean {
    const inst = FlightRecorderImpl.activeInstance;
    if (inst?.widget) {
      return inst.widget.toggle();
    }
    const isHidden =
      typeof localStorage !== 'undefined' && localStorage.getItem('backtrack_widget_hidden') === 'true';
    if (isHidden) {
      FlightRecorderImpl.showWidget();
      return true;
    } else {
      FlightRecorderImpl.hideWidget();
      return false;
    }
  }

  public static hide(): void {
    FlightRecorderImpl.hideWidget();
  }

  public static show(): void {
    FlightRecorderImpl.showWidget();
  }

  public static toggle(): boolean {
    return FlightRecorderImpl.toggleWidget();
  }

  public static async resetInstance(): Promise<void> {
    if (FlightRecorderImpl.activeInstance) {
      await FlightRecorderImpl.activeInstance.stop();
      FlightRecorderImpl.activeInstance = null;
    }
  }

  public static getInstance(): FlightRecorderImpl | null {
    return FlightRecorderImpl.activeInstance;
  }

  public hideWidget(): void {
    if (this.widget) {
      this.widget.hide();
    } else {
      FlightRecorderImpl.hideWidget();
    }
  }

  public showWidget(): void {
    if (this.widget) {
      this.widget.show();
    } else {
      FlightRecorderImpl.showWidget();
    }
  }

  public toggleWidget(): boolean {
    if (this.widget) {
      return this.widget.toggle();
    }
    return FlightRecorderImpl.toggleWidget();
  }

  private nextSequence = (): number => {
    this.sequence++;
    return this.sequence;
  };

  private getEnvironmentMetadata(): EnvironmentMetadata {
    const custom = this.options.metadata;
    if (typeof window === 'undefined') {
      return {
        url: 'http://localhost',
        userAgent: 'node',
        viewport: { width: 1280, height: 720 },
        ...custom
      };
    }

    const win = window as unknown as {
      __APP_VERSION__?: string;
      __GIT_BRANCH__?: string;
      __GIT_COMMIT__?: string;
      __UTICKET_APP_VERSION__?: string;
      __UTICKET_GIT_BRANCH__?: string;
      __UTICKET_GIT_COMMIT__?: string;
    };

    return {
      url: window.location.href,
      userAgent: window.navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      },
      appVersion: custom?.appVersion ?? win.__APP_VERSION__ ?? win.__UTICKET_APP_VERSION__,
      gitBranch: custom?.gitBranch ?? win.__GIT_BRANCH__ ?? win.__UTICKET_GIT_BRANCH__,
      gitCommit: custom?.gitCommit ?? win.__GIT_COMMIT__ ?? win.__UTICKET_GIT_COMMIT__,
      ...custom
    };
  }

  public async start(): Promise<void> {
    // Idempotente: se já estiver gravando, ignora
    if (this.stateMachine.isRecording()) return;

    try {
      await this.db.open();
      const sessionCtx = await claimSessionContext({
        ...this.options.sessionOptions,
        ...(this.options.storage ? { storage: this.options.storage } : {})
      });

      const existingChunks = await this.db.getChunksBySession(sessionCtx.sessionId);
      const lastTimelineSequence = Math.max(
        0,
        ...existingChunks.flatMap((chunk) => (chunk.timeline || []).map((event) => event.sequence))
      );
      const lastChunkSequence = Math.max(
        0,
        ...existingChunks.map((chunk) => chunk.sequence)
      );
      this.sequence = lastTimelineSequence;

      this.writer = new BatchWriter(
        this.db,
        sessionCtx.sessionId,
        sessionCtx.tabId,
        {
          ...this.options.batchWriterConfig,
          initialChunkSequence: lastChunkSequence
        },
        (err) => {
          const isQuota =
            (err instanceof Error && (err.name === 'QuotaExceededError' || err.message?.includes('QuotaExceededError'))) ||
            (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'QuotaExceededError');

          if (isQuota) {
            this.handleQuotaExceeded();
          } else {
            this.stateMachine.transition({
              type: 'DEGRADE',
              reason: 'Falha ao persistir um lote; a gravação pode estar incompleta.'
            });
          }
        }
      );

      this.writer.setOnChunkPersisted(() => {
        this.scheduleRetention();
      });

      this.incidentManager = new IncidentManager(
        this.db,
        sessionCtx.sessionId,
        sessionCtx.tabId,
        () => this.getEnvironmentMetadata(),
        {
          afterErrorSeconds: this.options.afterErrorSeconds,
          recorderVersion: this.options.recorderVersion ?? '0.3.6',
          getRecordingIssues: () => [
            ...this.stateMachine.getDegradedReasons(),
            ...((this.rrwebCapturer?.getDroppedEventsCount() ?? 0) > 0
              ? ['O capturador não conseguiu registrar parte do replay.'] : [])
          ],
          getDroppedEventsCount: () => this.rrwebCapturer?.getDroppedEventsCount() ?? 0
        }
      );

      this.incidentManager.setOnIncidentPending(() => {
        this.stateMachine.transition({ type: 'TRIGGER_AUTO' });
      });

      this.incidentManager.setOnIncidentFinalized(() => {
        if (!this.incidentManager?.getPendingIncident()) {
          this.stateMachine.transition({ type: 'FINALIZE_INCIDENT' });
        }
        this.updateStatsCache();
      });

      this.incidentManager.setOnError((err) => {
        const isQuota =
          (err instanceof Error && (err.name === 'QuotaExceededError' || err.message?.includes('QuotaExceededError'))) ||
          (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'QuotaExceededError');

        if (isQuota) {
          this.handleQuotaExceeded();
        } else {
          this.stateMachine.transition({
            type: 'DEGRADE',
            reason: 'Falha no gerenciamento de incidentes; o incidente pode não ter sido salvo completamente.'
          });
        }
      });

      this.incidentManager.setBeforeFinalize(async () => {
        if (this.writer) {
          await this.writer.flush();
        }
      });

      // Recupera incidente pendente de reload
      await this.incidentManager.init();

      // Inicializa os capturadores
      this.consoleCapturer = new ConsoleCapturer(this.writer, this.nextSequence);
      this.errorCapturer = new ErrorCapturer(
        this.writer,
        this.incidentManager,
        this.nextSequence
      );
      this.networkCapturer = new NetworkCapturer(
        this.writer,
        this.incidentManager,
        this.nextSequence,
        {
          captureHttpStatus: this.options.captureHttpStatus,
          ignoredUrls: this.options.ignoredUrls,
          sanitizeUrlCallback: this.options.privacy?.sanitizeUrl
        }
      );
      this.navigationCapturer = new NavigationCapturer(
        this.writer,
        this.nextSequence,
        {
          sanitizeUrlCallback: this.options.privacy?.sanitizeUrl
        }
      );
      this.rrwebCapturer = new RrwebCapturer(this.writer, {
        privacy: this.options.privacy
      });
      this.performanceCapturer = new PerformanceCapturer(this.writer, this.nextSequence);

      // Ativa capturadores
      this.consoleCapturer.start();
      this.errorCapturer.start();
      this.networkCapturer.start();
      this.navigationCapturer.start();
      this.rrwebCapturer.start();
      this.performanceCapturer.start();

      this.stateMachine.transition({ type: 'START' });

      if (this.incidentManager.getPendingIncident()) {
        this.stateMachine.transition({ type: 'TRIGGER_AUTO' });
      }

      // Inicia ciclo de retenção periódico como fallback (a cada 30 segundos)
      this.retentionIntervalTimer = setInterval(() => {
        this.scheduleRetention();
      }, 30000);

      this.updateStatsCache();

      // Monta o widget flutuante caso showWidget esteja ativo
      if (this.options.showWidget && typeof window !== 'undefined') {
        this.widget = new BacktrackWidget(this, this.options.widgetOptions);
        this.widget.mount();
      }
    } catch (err) {
      this.stateMachine.transition({
        type: 'DEGRADE',
        reason: `Falha ao iniciar recorder: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }

  private scheduleRetention(): Promise<void> | null {
    if (this.retentionPromise) {
      return this.retentionPromise;
    }

    this.retentionPromise = (async () => {
      try {
        await this.retention.prune();
        await this.updateStatsCache();
      } catch (err) {
        this.stateMachine.transition({
          type: 'DEGRADE',
          reason: 'Falha na manutenção do armazenamento local.'
        });
      } finally {
        this.retentionPromise = null;
      }
    })();

    return this.retentionPromise;
  }

  private async handleQuotaExceeded(): Promise<void> {
    try {
      await this.retention.emergencyPrune();
      await this.updateStatsCache();
    } catch {
      // Ignora erro no prune emergencial
    }

    const breakdown = await this.retention.getStorageBreakdown().catch(() => null);
    const onlyProtectedRemains = breakdown ? breakdown.bufferBytes === 0 && breakdown.protectedBytes > 0 : false;

    const reason = onlyProtectedRemains || breakdown?.protectedExceedsLimit
      ? 'A quota do navegador foi excedida. Apenas conteúdo protegido permanece salvo; é necessário excluir incidentes ou limpar gravações para liberar espaço.'
      : 'A quota do navegador impediu a gravação de um lote. Um prune emergencial de dados não protegidos foi executado.';

    this.stateMachine.transition({
      type: 'DEGRADE',
      reason
    });
  }

  private async updateStatsCache(): Promise<void> {
    try {
      const breakdown = await this.retention.getStorageBreakdown();
      this.cachedStorageBytes = breakdown.totalBytes;
      this.cachedProtectedBytes = breakdown.protectedBytes;
      this.cachedIncidentCount = breakdown.incidentCount;

      if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
        try {
          const est = await navigator.storage.estimate();
          this.cachedBrowserEstimateBytes = est.usage;
          this.cachedBrowserQuotaBytes = est.quota;
        } catch {
          // Ignora erro na estimativa complementar
        }
      }

      if (breakdown.protectedExceedsLimit) {
        this.stateMachine.transition({
          type: 'DEGRADE',
          reason: 'O armazenamento protegido por incidentes excede o limite configurado (maxStorageMb).'
        });
      } else if (!breakdown.isOverLimit && this.stateMachine.isDegraded()) {
        const reasons = this.stateMachine.getDegradedReasons();
        const onlyStorageReasons = reasons.every((r) =>
          r.includes('maxStorageMb') || r.includes('quota') || r.includes('Quota') || r.includes('armazenamento')
        );
        if (onlyStorageReasons && reasons.length > 0) {
          this.stateMachine.transition({ type: 'RECOVER' });
        }
      }
    } catch {
      // Ignora erro ao atualizar cache de stats
    }
  }

  private stoppingPromise?: Promise<void>;

  private stopCapturers(): void {
    this.rrwebCapturer?.stop();
    this.navigationCapturer?.stop();
    this.networkCapturer?.stop();
    this.errorCapturer?.stop();
    this.consoleCapturer?.stop();
    this.performanceCapturer?.stop();
  }

  private clearRuntimeReferences(): void {
    this.rrwebCapturer = null;
    this.navigationCapturer = null;
    this.networkCapturer = null;
    this.errorCapturer = null;
    this.consoleCapturer = null;
    this.performanceCapturer = null;
    this.writer = null;
    this.incidentManager = null;
  }

  public async stop(): Promise<void> {
    if (this.stateMachine.getState() === 'stopped') return;
    if (this.stoppingPromise) return this.stoppingPromise;

    this.stoppingPromise = (async () => {
      this.stopCapturers();

      if (this.retentionIntervalTimer) {
        clearInterval(this.retentionIntervalTimer);
        this.retentionIntervalTimer = null;
      }

      if (this.widget) {
        this.widget.unmount();
        this.widget = null;
      }

      if (FlightRecorderImpl.activeInstance === this) {
        FlightRecorderImpl.activeInstance = null;
      }

      if (this.writer) {
        await this.writer.flush();
      }
      this.writer?.destroy();
      this.incidentManager?.destroy();

      this.clearRuntimeReferences();
      this.stateMachine.transition({ type: 'STOP' });
    })();

    try {
      await this.stoppingPromise;
    } finally {
      this.stoppingPromise = undefined;
    }
  }

  public async capture(
    reason: string = 'manual',
    windowSeconds?: number,
    options?: CaptureOptions
  ): Promise<string> {
    if (!this.incidentManager || !this.writer) {
      throw new Error('FlightRecorder não está em execução.');
    }

    const now = Date.now();

    // Registra marcador da captura manual na timeline
    this.writer.addTimelineEvent({
      id: `marker_manual_${now}`,
      timestamp: now,
      sequence: this.nextSequence(),
      type: 'marker',
      label: `Captura manual: ${reason}`
    });

    // Flush antes de capturar para garantir integridade e persistência do chunk ativo
    await this.writer.flush();

    const incidentId = await this.incidentManager.trigger(
      'manual',
      {
        id: `trig_manual_${now}`,
        timestamp: now,
        type: 'manual',
        signature: `manual_capture_${reason}`,
        detail: {
          userReason: reason,
          windowSeconds,
          annotationImage: options?.annotationImage,
          notes: options?.notes,
          annotations: options?.annotations
        }
      },
      windowSeconds
    );

    await this.updateStatsCache();
    return incidentId;
  }

  public captureException(error: unknown, context?: ErrorContext): Promise<string | undefined> | void {
    if (!this.errorCapturer) return;
    try {
      return this.errorCapturer.captureException(error, context);
    } catch {
      // captureException nunca relança
    }
  }

  public async listIncidents(): Promise<IncidentSummary[]> {
    try {
      return await this.db.listIncidents();
    } catch {
      return [];
    }
  }

  public async getArtifact(incidentId: string): Promise<FlightRecorderArtifactV1> {
    if (!this.incidentManager) {
      // Instancia manager ad-hoc para exportar mesmo se parado
      const mgr = new IncidentManager(this.db, '', '', () => this.getEnvironmentMetadata(), {
        recorderVersion: this.options.recorderVersion ?? '0.3.6',
        getRecordingIssues: () => this.stateMachine.getDegradedReasons()
      });
      return mgr.exportArtifact(incidentId);
    }
    return this.incidentManager.exportArtifact(incidentId);
  }

  public async exportIncident(
    incidentId: string,
    options?: { compress?: boolean; aiOptimized?: boolean }
  ): Promise<FlightRecorderArtifactV1> {
    const artifact = await this.getArtifact(incidentId);

    const dateStr = new Date(artifact.incident.triggeredAt)
      .toISOString()
      .replace(/:/g, '-')
      .replace(/\..+/, '');
    const isAi = options?.aiOptimized ?? false;
    const isCompressed = !isAi && (options?.compress ?? false);
    const ext = isAi ? '.ai.json' : isCompressed ? '.ffr.json.gz' : '.ffr.json';
    const filename = `flight-recorder-${dateStr}-${artifact.incident.reason}-${incidentId}${ext}`;

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      let blob: Blob;
      if (isCompressed) {
        const compressed = await compressArtifact(artifact);
        blob = new Blob([compressed as unknown as BlobPart], { type: 'application/gzip' });
      } else if (isAi) {
        const aiPayload = {
          ...artifact,
          replay: [],
          _aiNote: 'Replay visual removido para otimizacao de IA (tamanho < 100 KB). Timeline, erros de console e rede preservados.'
        };
        const jsonStr = JSON.stringify(aiPayload, null, 2);
        blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      } else {
        const jsonStr = JSON.stringify(artifact, null, 2);
        blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return artifact;
  }

  public async deleteIncident(incidentId: string): Promise<void> {
    if (this.incidentManager) await this.incidentManager.deleteIncident(incidentId);
    else await this.db.deleteIncident(incidentId);
    await this.retention.prune();
    await this.updateStatsCache();
  }

  public async clear(): Promise<void> {
    await this.db.clearAll();
    this.cachedStorageBytes = 0;
    this.cachedProtectedBytes = 0;
    this.cachedIncidentCount = 0;
  }

  public getHealth(): RecorderHealth {
    const droppedEvents =
      this.rrwebCapturer?.getDroppedEventsCount() ?? 0;

    const limitBytes = (this.options.maxStorageMb ?? 50) * 1024 * 1024;
    return {
      state: this.stateMachine.getState(),
      droppedEvents,
      storageBytes: this.cachedStorageBytes,
      protectedStorageBytes: this.cachedProtectedBytes,
      storageLimitBytes: limitBytes,
      storageLimitExceeded: this.cachedStorageBytes > limitBytes,
      protectedStorageExceeded: this.cachedProtectedBytes > limitBytes,
      browserStorageEstimateBytes: this.cachedBrowserEstimateBytes,
      browserStorageQuotaBytes: this.cachedBrowserQuotaBytes,
      pendingWrites: this.writer?.getPendingWrites() ?? 0,
      incidentCount: this.cachedIncidentCount,
      reasons: this.stateMachine.getDegradedReasons()
    };
  }

  public getSequence(): number {
    return this.sequence;
  }

  public async flush(): Promise<void> {
    if (this.writer) {
      await this.writer.flush();
    }
  }

  public async destroy(): Promise<void> {
    await this.stop();
  }
}

/**
 * Função factory pública para instanciar o Flight Recorder.
 */
export function createFlightRecorder(options?: FlightRecorderOptions): FlightRecorder {
  return new FlightRecorderImpl(options);
}
