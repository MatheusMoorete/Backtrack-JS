export type RecorderState =
  | 'stopped'
  | 'recording'
  | 'incident_pending'
  | 'degraded';

export interface RecorderHealth {
  state: RecorderState;
  droppedEvents: number;
  storageBytes: number;
  pendingWrites: number;
  incidentCount: number;
  reasons: string[];
}
