import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { IncidentManager, sliceReplayEventsForWindow } from '../../src/storage/incident-manager';
import { validateFlightRecorderArtifact } from '../../src/validation/validate';
import type { EnvironmentMetadata } from '../../src/types/artifact';
import type { StoredChunk } from '../../src/types/chunk';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Lote 1 — IncidentManager e Exportação', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  const mockEnv: EnvironmentMetadata = {
    url: 'http://localhost:3000/test',
    userAgent: 'TestBrowser/1.0',
    viewport: { width: 1024, height: 768 }
  };

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(() => {
    db.close();
  });

  it('incidente manual finaliza imediatamente', async () => {
    const manager = new IncidentManager(db, 'sess_m1', 'tab_m1', mockEnv);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_m1',
      timestamp: Date.now(),
      type: 'manual',
      signature: 'manual_capture'
    });

    const stored = await db.getIncident(incidentId);
    expect(stored).not.toBeNull();
    expect(stored?.state).toBe('finalized');
    expect(stored?.reason).toBe('manual');
    expect(stored?.finalizedAt).toBeDefined();

    manager.destroy();
  });

  it('incidente automático cria estado pending e finaliza no prazo afterErrorSeconds', async () => {
    // Usa prazo de 0.15s para teste rápido
    const manager = new IncidentManager(db, 'sess_a1', 'tab_a1', mockEnv, {
      afterErrorSeconds: 0.15
    });

    const incidentId = await manager.trigger('error', {
      id: 'trig_err_1',
      timestamp: Date.now(),
      type: 'error',
      signature: 'TypeError: crash'
    });

    let stored = await db.getIncident(incidentId);
    expect(stored?.state).toBe('pending');

    // Aguarda o término do prazo
    await sleep(250);

    stored = await db.getIncident(incidentId);
    expect(stored?.state).toBe('finalized');

    manager.destroy();
  });

  it('recupera incidente pendente após reload se dentro do prazo', async () => {
    // 1. Cria incidente na primeira sessão com prazo de 0.3s
    const manager1 = new IncidentManager(db, 'sess_reload', 'tab_reload', mockEnv, {
      afterErrorSeconds: 0.3
    });
    const incidentId = await manager1.trigger('error', {
      id: 'trig_r1',
      timestamp: Date.now(),
      type: 'error',
      signature: 'Error: reload test'
    });
    manager1.destroy();

    // 2. Simula reload após 50ms (ainda dentro do prazo)
    await sleep(50);
    const manager2 = new IncidentManager(db, 'sess_reload', 'tab_reload', mockEnv, {
      afterErrorSeconds: 0.3
    });

    await manager2.init();
    expect(manager2.getPendingIncident()?.id).toBe(incidentId);

    // 3. Aguarda o tempo restante para finalizar
    await sleep(350);

    const stored = await db.getIncident(incidentId);
    expect(stored?.state).toBe('finalized');

    manager2.destroy();
  });

  it('exporta incidente como artefato canônico v1 válido', async () => {
    const manager = new IncidentManager(db, 'sess_exp', 'tab_exp', mockEnv);

    // Insere chunks sintéticos para a sessão
    const chunk1: StoredChunk = {
      id: 'chk_e1',
      sessionId: 'sess_exp',
      tabId: 'tab_exp',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 150,
      replay: [{ type: 4, data: {}, timestamp: 1000 }],
      timeline: [{ id: 't1', timestamp: 1000, sequence: 1, type: 'marker', label: 'm1' }]
    };
    const chunk2: StoredChunk = {
      id: 'chk_e2',
      sessionId: 'sess_exp',
      tabId: 'tab_exp',
      sequence: 2,
      startedAt: 2000,
      endedAt: 3000,
      sizeBytes: 150,
      replay: [{ type: 2, data: {}, timestamp: 2000 }],
      timeline: [{ id: 't2', timestamp: 2500, sequence: 2, type: 'marker', label: 'm2' }]
    };

    await db.putChunk(chunk1);
    await db.putChunk(chunk2);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_exp',
      timestamp: 3000,
      type: 'manual',
      signature: 'manual'
    });

    const artifact = await manager.exportArtifact(incidentId);

    // Valida com o validador canônico do Lote 0
    const valResult = validateFlightRecorderArtifact(artifact);
    expect(valResult.success).toBe(true);

    expect(artifact.timeline.length).toBe(2);
    expect(artifact.replay.length).toBe(2);
    expect(artifact.incident.id).toBe(incidentId);

    manager.destroy();
  });

  it('captura manual com janela de tempo (windowSeconds) restringe startedAt e timeline', async () => {
    const manager = new IncidentManager(db, 'sess_win', 'tab_win', mockEnv);

    // Chunks de 0 a 10s (passado distante) e de 50 a 60s (recente)
    const oldChunk: StoredChunk = {
      id: 'chk_old',
      sessionId: 'sess_win',
      tabId: 'tab_win',
      sequence: 1,
      startedAt: 1000,
      endedAt: 10000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: [{ id: 't_old', timestamp: 5000, sequence: 1, type: 'marker', label: 'antigo' }]
    };
    const recentChunk: StoredChunk = {
      id: 'chk_recent',
      sessionId: 'sess_win',
      tabId: 'tab_win',
      sequence: 2,
      startedAt: 50000,
      endedAt: 60000,
      sizeBytes: 100,
      replay: [{ type: 3, data: {}, timestamp: 55000 }],
      timeline: [{ id: 't_recent', timestamp: 58000, sequence: 2, type: 'marker', label: 'recente' }]
    };

    await db.putChunk(oldChunk);
    await db.putChunk(recentChunk);

    // Captura apenas os últimos 15 segundos (a partir de 45000)
    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_win',
        timestamp: 60000,
        type: 'manual',
        signature: 'manual'
      },
      15 // 15 segundos
    );

    const artifact = await manager.exportArtifact(incidentId);

    // startedAt deve ser restrito ao corte da janela (45000)
    expect(artifact.incident.startedAt).toBe(45000);
    // Timeline exportada deve conter apenas o evento recente
    expect(artifact.timeline.length).toBe(1);
    expect(artifact.timeline[0].id).toBe('t_recent');
    // Deve conter o FullSnapshot reposicionado no início da janela e o evento recente
    expect(artifact.replay.length).toBe(2);
    expect(artifact.replay[0].type).toBe(2);
    expect(artifact.replay[0].timestamp).toBe(45000);
    expect(artifact.replay[1].type).toBe(3);
    expect(artifact.replay[1].timestamp).toBe(55000);

    manager.destroy();
  });

  it('captura manual de 5 minutos em sessão longa (69 min) restringe startedAt para exatamente 5 minutos', async () => {
    const manager = new IncidentManager(db, 'sess_long', 'tab_long', mockEnv);
    const now = 69 * 60 * 1000 + 41 * 1000; // 69m 41s
    const windowSeconds = 300; // 5 minutos

    const initialChunk: StoredChunk = {
      id: 'chk_init',
      sessionId: 'sess_long',
      tabId: 'tab_long',
      sequence: 1,
      startedAt: 0,
      endedAt: 60000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 0 }],
      timeline: []
    };
    await db.putChunk(initialChunk);

    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_long',
        timestamp: now,
        type: 'manual',
        signature: 'manual'
      },
      windowSeconds
    );

    const stored = await db.getIncident(incidentId);
    expect(stored).not.toBeNull();
    // startedAt deve ser estritamente now - 5 minutos (300000ms), NÃO 0
    expect(stored?.startedAt).toBe(now - 300 * 1000);
    expect(stored?.finalizedAt).toBe(now);
    expect(stored!.finalizedAt! - stored!.startedAt).toBe(300 * 1000);

    const summaries = await db.listIncidents();
    expect(summaries[0].startedAt).toBe(now - 300 * 1000);

    manager.destroy();
  });

  it('captura manual com usuário inativo (sem chunks recentes) mantém startedAt na janela solicitada', async () => {
    const manager = new IncidentManager(db, 'sess_idle', 'tab_idle', mockEnv);
    const now = 3600 * 1000; // 1 hora de sessão
    const windowSeconds = 60; // 1 minuto

    // Apenas um chunk no início da sessão (1h atrás)
    const oldChunk: StoredChunk = {
      id: 'chk_idle_old',
      sessionId: 'sess_idle',
      tabId: 'tab_idle',
      sequence: 1,
      startedAt: 0,
      endedAt: 10000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 0 }],
      timeline: []
    };
    await db.putChunk(oldChunk);

    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_idle',
        timestamp: now,
        type: 'manual',
        signature: 'manual'
      },
      windowSeconds
    );

    const stored = await db.getIncident(incidentId);
    expect(stored?.startedAt).toBe(now - 60 * 1000);
    expect(stored!.finalizedAt! - stored!.startedAt).toBe(60 * 1000);

    manager.destroy();
  });

  it('exclui incidente específico da listagem sem apagar chunks', async () => {
    const manager = new IncidentManager(db, 'sess_del', 'tab_del', mockEnv);

    const chunk: StoredChunk = {
      id: 'chk_keep',
      sessionId: 'sess_del',
      tabId: 'tab_del',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      replay: [],
      timeline: []
    };
    await db.putChunk(chunk);

    const inc1 = await manager.trigger('manual', {
      id: 'trig_d1',
      timestamp: 2000,
      type: 'manual',
      signature: 'd1'
    });

    const inc2 = await manager.trigger('manual', {
      id: 'trig_d2',
      timestamp: 3000,
      type: 'manual',
      signature: 'd2'
    });

    let list = await db.listIncidents();
    expect(list.length).toBe(2);

    // Remove apenas o inc1
    await db.deleteIncident(inc1);

    list = await db.listIncidents();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(inc2);

    // O chunk ainda existe no banco
    const storedChunk = await db.getChunk('chk_keep');
    expect(storedChunk).not.toBeNull();

    manager.destroy();
  });

  describe('sliceReplayEventsForWindow', () => {
    it('retorna array vazio quando recebe lista vazia', () => {
      expect(sliceReplayEventsForWindow([], 1000, 2000)).toEqual([]);
    });

    it('reposiciona o FullSnapshot e Meta no início da janela preservando mutações intermediárias para reconstituir o DOM', () => {
      const events = [
        { type: 4, data: { width: 1920, height: 1080 }, timestamp: 1000 },
        { type: 2, data: { node: 'root' }, timestamp: 1005 },
        { type: 3, data: { d: 'intermediate mutation' }, timestamp: 5000 },
        { type: 3, data: { d: 'mutation 1' }, timestamp: 60000 },
        { type: 3, data: { d: 'mutation 2' }, timestamp: 65000 }
      ];

      // Janela de 60s a 70s
      const sliced = sliceReplayEventsForWindow(events, 60000, 70000);

      // Deve conter Meta (59999), FullSnapshot (60000), a mutação intermediária reposicionada no início (60000)
      // para garantir a reconstrução correta do DOM, e as duas mutações dentro da janela
      expect(sliced.length).toBe(5);
      expect(sliced[0].type).toBe(4);
      expect(sliced[0].timestamp).toBe(59999);
      expect(sliced[1].type).toBe(2);
      expect(sliced[1].timestamp).toBe(60000);
      expect(sliced[2].data).toEqual({ d: 'intermediate mutation' });
      expect(sliced[2].timestamp).toBe(60000);
      expect(sliced[3].data).toEqual({ d: 'mutation 1' });
      expect(sliced[3].timestamp).toBe(60000);
      expect(sliced[4].data).toEqual({ d: 'mutation 2' });
      expect(sliced[4].timestamp).toBe(65000);
    });

    it('NÃO busca snapshots futuros fora da janela se não houver snapshot anterior', () => {
      const events = [
        { type: 3, data: { d: 'mutation early' }, timestamp: 2000 },
        { type: 2, data: { node: 'future root' }, timestamp: 5000 }
      ];

      // Janela de 2000 a 3000 (termina antes do snapshot de 5000)
      const sliced = sliceReplayEventsForWindow(events, 2000, 3000);

      // Não deve puxar o snapshot futuro de 5000 para o início
      expect(sliced.length).toBe(1);
      expect(sliced[0].data).toEqual({ d: 'mutation early' });
    });

    it('preserva eventos quando a janela já possui FullSnapshot no início', () => {
      const events = [
        { type: 2, data: { node: 'root' }, timestamp: 60050 },
        { type: 3, data: { d: 'mut' }, timestamp: 61000 }
      ];

      const sliced = sliceReplayEventsForWindow(events, 60000, 70000);
      expect(sliced.length).toBe(2);
      expect(sliced[0].timestamp).toBe(60050);
    });
  });
});
