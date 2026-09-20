import { describe, it, expect } from 'vitest';
import { RecorderStateMachine } from '../../src/core/state-machine';

describe('Lote 0 — Máquina de Estados do Recorder', () => {
  it('inicia no estado stopped', () => {
    const sm = new RecorderStateMachine();
    expect(sm.getState()).toBe('stopped');
    expect(sm.isRecording()).toBe(false);
  });

  it('transita de stopped para recording ao receber START', () => {
    const sm = new RecorderStateMachine();
    sm.transition({ type: 'START' });
    expect(sm.getState()).toBe('recording');
    expect(sm.isRecording()).toBe(true);
  });

  it('START e STOP são idempotentes', () => {
    const sm = new RecorderStateMachine();
    sm.transition({ type: 'START' });
    sm.transition({ type: 'START' });
    expect(sm.getState()).toBe('recording');

    sm.transition({ type: 'STOP' });
    expect(sm.getState()).toBe('stopped');
    sm.transition({ type: 'STOP' });
    expect(sm.getState()).toBe('stopped');
  });

  it('transita de recording para incident_pending em TRIGGER_AUTO', () => {
    const sm = new RecorderStateMachine();
    sm.transition({ type: 'START' });
    sm.transition({ type: 'TRIGGER_AUTO' });
    expect(sm.getState()).toBe('incident_pending');
    expect(sm.isRecording()).toBe(true);
  });

  it('retorna a recording após FINALIZE_INCIDENT ou TRIGGER_MANUAL', () => {
    const sm = new RecorderStateMachine();
    sm.transition({ type: 'START' });
    sm.transition({ type: 'TRIGGER_AUTO' });
    expect(sm.getState()).toBe('incident_pending');

    sm.transition({ type: 'FINALIZE_INCIDENT' });
    expect(sm.getState()).toBe('recording');
  });

  it('transita para degraded em caso de erro de persistência e preserva contexto', () => {
    const sm = new RecorderStateMachine();
    sm.transition({ type: 'START' });
    sm.transition({ type: 'DEGRADE', reason: 'IndexedDB QuotaExceededError' });

    expect(sm.getState()).toBe('degraded');
    expect(sm.isDegraded()).toBe(true);
    expect(sm.isRecording()).toBe(true); // Ainda tenta gravar o que puder
    expect(sm.getDegradedReasons()).toContain('IndexedDB QuotaExceededError');

    sm.transition({ type: 'RECOVER' });
    expect(sm.getState()).toBe('recording');
    expect(sm.isDegraded()).toBe(false);
  });
});
