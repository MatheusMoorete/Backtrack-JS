import type { IncidentSummary } from './incident';
import type { RecorderHealth } from './health';
import type { FlightRecorderArtifactV1, EnvironmentMetadata } from './artifact';

export interface ErrorContext {
  source?: 'react' | 'manual' | 'window' | 'unhandledrejection';
  componentStack?: string;
  [key: string]: unknown;
}

export interface PrivacyOptions {
  maskAllInputs?: boolean;
  maskAllText?: boolean;
  blockMedia?: boolean;
  blockSelector?: string;
  maskTextSelector?: string;
  sanitizeUrl?: (url: URL) => string;
}

export interface FlightRecorderOptions {
  bufferMinutes?: number;
  afterErrorSeconds?: number;
  maxStorageMb?: number;
  captureHttpStatus?: number[];
  ignoredUrls?: (string | RegExp)[];
  privacy?: PrivacyOptions;
  metadata?: Partial<EnvironmentMetadata>;
  recorderVersion?: string;
}

export interface FlightRecorder {
  start(): Promise<void>;
  stop(): void;
  capture(reason?: string, windowSeconds?: number): Promise<string>;
  captureException(error: unknown, context?: ErrorContext): void;
  listIncidents(): Promise<IncidentSummary[]>;
  getArtifact(incidentId: string): Promise<FlightRecorderArtifactV1>;
  exportIncident(incidentId: string): Promise<FlightRecorderArtifactV1>;
  deleteIncident(incidentId: string): Promise<void>;
  clear(): Promise<void>;
  getHealth(): RecorderHealth;
}
