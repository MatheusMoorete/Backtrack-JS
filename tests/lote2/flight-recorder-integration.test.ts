import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { validateFlightRecorderArtifact } from '../../src/validation/validate';

describe('Lote 2 — FlightRecorder Integrado', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;
  let recorder: FlightRecorderImpl;

  beforeEach(async () => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
    recorder = new FlightRecorderImpl(
      {
        bufferMinutes: 5,
        afterErrorSeconds: 0.1
      },
      db
    );
    await recorder.start();
  });

  afterEach(() => {
    recorder.stop();
    db.close();
  });

  it('start() é idempotente', async () => {
    expect(recorder.getHealth().state).toBe('recording');
    await recorder.start();
    expect(recorder.getHealth().state).toBe('recording');
  });

  it('captura manual cria e finaliza incidente com sucesso', async () => {
    console.log('Mensagem de log antes da captura manual');

    const incidentId = await recorder.capture('teste_manual_usuario');
    expect(incidentId).toBeDefined();

    const incidents = await recorder.listIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].id).toBe(incidentId);
    expect(incidents[0].reason).toBe('manual');

    // Valida exportação do artefato gerado pela captura
    const artifact = await recorder.getArtifact(incidentId);
    const valResult = validateFlightRecorderArtifact(artifact);
    expect(valResult.success).toBe(true);
  });

  it('captureException dispara incidente automático e gera artefato v1 válido', async () => {
    recorder.captureException(new Error('Erro simulado em componente'), {
      source: 'react',
      componentStack: '\n    at TestComponent'
    });

    // Aguarda o tempo de finalização automática (0.1s)
    await new Promise((resolve) => setTimeout(resolve, 200));

    const incidents = await recorder.listIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].reason).toBe('react');

    const artifact = await recorder.getArtifact(incidents[0].id);
    const valResult = validateFlightRecorderArtifact(artifact);
    expect(valResult.success).toBe(true);
    expect(artifact.timeline.some((e) => e.type === 'error')).toBe(true);
  });

  it('stop() impede novas capturas e restaura o recorder para stopped', () => {
    recorder.stop();
    expect(recorder.getHealth().state).toBe('stopped');
  });
});
