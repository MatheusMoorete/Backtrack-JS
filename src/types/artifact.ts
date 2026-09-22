import type { IncidentReason, IncidentTrigger } from './incident';
import type { TimelineEvent } from './timeline';
import type { RrwebEvent } from './chunk';

export interface IncidentMetadata {
  id: string;
  reason: IncidentReason;
  triggers: IncidentTrigger[];
  startedAt: number;
  triggeredAt: number;
  finalizedAt: number;
  annotationImage?: string;
  annotations?: Record<string, unknown>;
}

export interface EnvironmentMetadata {
  url: string;
  userAgent: string;
  viewport: {
    width: number;
    height: number;
  };
  appVersion?: string;
  gitBranch?: string;
  gitCommit?: string;
}

export interface DiagnosticsMetadata {
  /** Known losses only; see droppedEventsUnknown for unquantifiable gaps. */
  droppedEvents: number;
  droppedEventsUnknown?: boolean;
  storageBytes: number;
  degraded: boolean;
  degradedReasons: string[];
}

export interface FlightRecorderArtifactV1 {
  formatVersion: 1;
  recorderVersion: string;
  incident: IncidentMetadata;
  environment: EnvironmentMetadata;
  timeline: TimelineEvent[];
  replay: RrwebEvent[];
  diagnostics: DiagnosticsMetadata;
}
