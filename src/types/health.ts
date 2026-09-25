export type RecorderState =
  | 'stopped'
  | 'recording'
  | 'incident_pending'
  | 'degraded';

export interface RecorderHealth {
  state: RecorderState;
  droppedEvents: number;
  storageBytes: number;
  protectedStorageBytes?: number;
  storageLimitBytes?: number;
  storageLimitExceeded?: boolean;
  protectedStorageExceeded?: boolean;
  browserStorageEstimateBytes?: number;
  browserStorageQuotaBytes?: number;
  pendingWrites: number;
  incidentCount: number;
  reasons: string[];
}
