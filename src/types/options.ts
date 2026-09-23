import type { IncidentSummary } from './incident';
import type { RecorderHealth } from './health';
import type { FlightRecorderArtifactV1, EnvironmentMetadata } from './artifact';

export interface ErrorContext {
  source?: 'react' | 'manual' | 'window' | 'unhandledrejection';
  componentStack?: string;
  [key: string]: unknown;
}

export type RouteMatcher = string | RegExp | ((pathname: string) => boolean);

export interface PrivacyOptions {
  maskAllInputs?: boolean;
  maskAllText?: boolean;
  blockMedia?: boolean;
  blockSelector?: string;
  maskTextSelector?: string;
  sanitizeUrl?: (url: URL) => string;
  sensitiveRoutes?: RouteMatcher[];
  autoMaskPII?: boolean;
  recordCanvas?: boolean;
}

export interface WidgetOptions {
  position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  defaultViewerUrl?: string;
  zIndex?: number;
  defaultDurationSeconds?: number;
}

export interface FlightRecorderOptions {
  bufferMinutes?: number;
  afterErrorSeconds?: number;
  /** Retention target; saved incidents are protected and may exceed it. */
  maxStorageMb?: number;
  captureHttpStatus?: number[];
  ignoredUrls?: (string | RegExp)[];
  privacy?: PrivacyOptions;
  metadata?: Partial<EnvironmentMetadata>;
  recorderVersion?: string;
  showWidget?: boolean;
  widgetOptions?: WidgetOptions;
}

export interface CaptureOptions {
  annotationImage?: string;
  notes?: string;
  annotations?: Record<string, unknown>;
}

export interface FlightRecorder {
  start(): Promise<void>;
  stop(): void;
  capture(reason?: string, windowSeconds?: number, options?: CaptureOptions): Promise<string>;
  captureException(error: unknown, context?: ErrorContext): void;
  listIncidents(): Promise<IncidentSummary[]>;
  getArtifact(incidentId: string): Promise<FlightRecorderArtifactV1>;
  exportIncident(
    incidentId: string,
    options?: { compress?: boolean; aiOptimized?: boolean }
  ): Promise<FlightRecorderArtifactV1>;
  deleteIncident(incidentId: string): Promise<void>;
  clear(): Promise<void>;
  getHealth(): RecorderHealth;
  hideWidget?(): void;
  showWidget?(): void;
  toggleWidget?(): boolean;
}
