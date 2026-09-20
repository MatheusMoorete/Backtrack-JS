export type TimelineEventType =
  | 'console'
  | 'error'
  | 'network'
  | 'navigation'
  | 'marker';

export interface TimelineEventBase {
  id: string;
  timestamp: number;
  sequence: number;
  type: TimelineEventType;
}

export type ConsoleLogLevel = 'log' | 'warn' | 'error';

export interface ConsoleTimelineEvent extends TimelineEventBase {
  type: 'console';
  level: ConsoleLogLevel;
  args: unknown[];
}

export type ErrorSource = 'window' | 'unhandledrejection' | 'react' | 'manual';

export interface ErrorTimelineEvent extends TimelineEventBase {
  type: 'error';
  name: string;
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  source: ErrorSource;
  componentStack?: string;
}

export type NetworkResult = 'success' | 'error' | 'timeout' | 'abort';

export interface NetworkTimelineEvent extends TimelineEventBase {
  type: 'network';
  method: string;
  url: string;
  status: number;
  durationMs: number;
  result: NetworkResult;
}

export type NavigationKind =
  | 'initial'
  | 'pushState'
  | 'replaceState'
  | 'popstate'
  | 'hashchange';

export interface NavigationTimelineEvent extends TimelineEventBase {
  type: 'navigation';
  fromUrl?: string;
  toUrl: string;
  kind: NavigationKind;
}

export interface MarkerTimelineEvent extends TimelineEventBase {
  type: 'marker';
  label: string;
  data?: Record<string, unknown>;
}

export type TimelineEvent =
  | ConsoleTimelineEvent
  | ErrorTimelineEvent
  | NetworkTimelineEvent
  | NavigationTimelineEvent
  | MarkerTimelineEvent;
