export type IncidentReason =
  | 'manual'
  | 'error'
  | 'unhandledrejection'
  | 'react'
  | 'http';

export interface IncidentTrigger {
  id: string;
  timestamp: number;
  type: IncidentReason;
  signature: string;
  detail?: Record<string, unknown>;
}

export interface StoredIncident {
  id: string;
  sessionId: string;
  tabId: string;
  reason: IncidentReason;
  triggers: IncidentTrigger[];
  startedAt: number;
  triggeredAt: number;
  finalizeAt: number;
  finalizedAt?: number;
  state: 'pending' | 'finalized';
  chunkIds: string[];
  recordingIssues?: string[];
}

export interface IncidentSummary {
  id: string;
  reason: IncidentReason;
  startedAt: number;
  triggeredAt: number;
  finalizedAt?: number;
  eventCount: number;
  triggerCount: number;
}
