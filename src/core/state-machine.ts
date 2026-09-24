import type { RecorderState } from '../types/health';

/**
 * Eventos que causam transição de estado no Flight Recorder.
 */
export type RecorderTransitionEvent =
  | { type: 'START' }
  | { type: 'STOP' }
  | { type: 'TRIGGER_AUTO' }
  | { type: 'TRIGGER_MANUAL' }
  | { type: 'FINALIZE_INCIDENT' }
  | { type: 'DEGRADE'; reason: string }
  | { type: 'RECOVER' };

/**
 * Representação da máquina de estados descrita na Seção 8 do SPEC.md:
 *
 * ```text
 * stopped
 *    │ start
 *    ▼
 * recording
 *    │ trigger
 *    ▼
 * incident_pending
 *    │ prazo posterior ou captura manual
 *    ▼
 * incident_finalized (lógico / transitório para persistência)
 *    │ gravação contínua
 *    └──────────────────────────────► recording
 *
 * qualquer estado operacional
 *    │ falha parcial
 *    ▼
 * degraded
 * ```
 */
export class RecorderStateMachine {
  private currentState: RecorderState = 'stopped';
  private degradedReasons: Set<string> = new Set();
  private previousOperationalState: RecorderState = 'stopped';

  constructor(initialState: RecorderState = 'stopped') {
    this.currentState = initialState;
  }

  public getState(): RecorderState {
    return this.currentState;
  }

  public getDegradedReasons(): string[] {
    return Array.from(this.degradedReasons);
  }

  public isDegraded(): boolean {
    return this.currentState === 'degraded';
  }

  public isRecording(): boolean {
    return (
      this.currentState === 'recording' ||
      this.currentState === 'incident_pending' ||
      (this.currentState === 'degraded' &&
        (this.previousOperationalState === 'recording' ||
          this.previousOperationalState === 'incident_pending'))
    );
  }

  public transition(event: RecorderTransitionEvent): RecorderState {
    switch (event.type) {
      case 'START':
        if (this.currentState === 'stopped') {
          this.currentState = 'recording';
        }
        break;

      case 'STOP':
        this.currentState = 'stopped';
        this.degradedReasons.clear();
        this.previousOperationalState = 'stopped';
        break;

      case 'TRIGGER_AUTO':
        if (this.currentState === 'recording') {
          this.currentState = 'incident_pending';
        } else if (this.currentState === 'degraded') {
          this.previousOperationalState = 'incident_pending';
        }
        break;

      case 'TRIGGER_MANUAL':
        // Captura manual é imediata e inócua para a máquina de estados (não altera incident_pending)
        break;

      case 'FINALIZE_INCIDENT':
        if (this.currentState === 'incident_pending') {
          this.currentState = 'recording';
        } else if (this.currentState === 'degraded') {
          this.previousOperationalState = 'recording';
        }
        break;

      case 'DEGRADE':
        this.degradedReasons.add(event.reason);
        if (this.currentState !== 'degraded') {
          this.previousOperationalState = this.currentState;
          this.currentState = 'degraded';
        }
        break;

      case 'RECOVER':
        this.degradedReasons.clear();
        if (this.currentState === 'degraded') {
          this.currentState =
            this.previousOperationalState === 'stopped'
              ? 'stopped'
              : this.previousOperationalState;
        }
        break;
    }

    return this.currentState;
  }
}
