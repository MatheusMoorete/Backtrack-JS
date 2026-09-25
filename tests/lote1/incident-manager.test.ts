import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { IncidentManager, sliceReplayEventsForWindow } from '../../src/storage/incident-manager';
import { validateFlightRecorderArtifact } from '../../src/validation/validate';
import { compressGzip } from '../../src/utils/compression';
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

  it('dois gatilhos simultâneos são serializados e criam um único incidente compartilhado', async () => {
    const manager = new IncidentManager(db, 'sess_simultaneous', 'tab_simultaneous', mockEnv, {
      afterErrorSeconds: 0.15
    });

    const pendingCallbackSpy = vi.fn();
    manager.setOnIncidentPending(pendingCallbackSpy);

    // Insere um chunk inicial
    await db.putChunk({
      id: 'chk_sim_1',
      sessionId: 'sess_simultaneous',
      tabId: 'tab_simultaneous',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      replay: [],
      timeline: []
    });

    const t1Promise = manager.trigger('http', {
      id: 'trig_http_500',
      timestamp: Date.now(),
      type: 'http',
      signature: 'HTTP 500: /api/checkout'
    });

    const t2Promise = manager.trigger('error', {
      id: 'trig_js_error',
      timestamp: Date.now(),
      type: 'error',
      signature: 'TypeError: Cannot read properties of undefined'
    });

    const [id1, id2] = await Promise.all([t1Promise, t2Promise]);

    // Ambos devem retornar o mesmo incidentId
    expect(id1).toBe(id2);

    // Callback onIncidentPending deve ser executado apenas uma vez
    expect(pendingCallbackSpy).toHaveBeenCalledTimes(1);

    // Apenas 1 incidente no IndexedDB
    const incidents = await db.getAllIncidents();
    const sessionIncidents = incidents.filter((i) => i.sessionId === 'sess_simultaneous');
    expect(sessionIncidents.length).toBe(1);

    const stored = sessionIncidents[0];
    expect(stored.id).toBe(id1);
    expect(stored.state).toBe('pending');
    expect(stored.triggers.length).toBe(2);
    expect(stored.triggers[0].signature).toBe('HTTP 500: /api/checkout');
    expect(stored.triggers[1].signature).toBe('TypeError: Cannot read properties of undefined');

    // Aguarda a finalização
    await sleep(250);

    const finalized = await db.getIncident(id1);
    expect(finalized?.state).toBe('finalized');

    manager.destroy();
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
      hasFullSnapshot: true,
      replay: [
        { type: 4, data: { href: 'http://localhost/', width: 1024, height: 768 }, timestamp: 1000 },
        { type: 2, data: { node: { id: 1, type: 0 } }, timestamp: 1000 }
      ],
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
      hasFullSnapshot: false,
      replay: [{ type: 3, data: { source: 1, positions: [{ x: 10, y: 10 }] }, timestamp: 2000 }],
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
    expect(artifact.replay.length).toBe(3);
    expect(artifact.incident.id).toBe(incidentId);
    expect(artifact.diagnostics.degraded).toBe(false);
    expect(artifact.diagnostics.degradedReasons).toEqual([]);
    expect(artifact.diagnostics.droppedEvents).toBe(0);

    manager.destroy();
  });

  it('marca artefato como incompleto (degraded: true) e droppedEventsUnknown quando lote referenciado não é encontrado', async () => {
    const manager = new IncidentManager(db, 'sess_missing', 'tab_missing', mockEnv);

    // Salva chunk1, mas não chunk2
    const chunk1: StoredChunk = {
      id: 'chk_ok',
      sessionId: 'sess_missing',
      tabId: 'tab_missing',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 150,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: []
    };
    await db.putChunk(chunk1);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_miss',
      timestamp: 3000,
      type: 'manual',
      signature: 'manual'
    });

    // Simula que o incidente referenciou um chunk que depois foi perdido/apagado
    const storedInc = await db.getIncident(incidentId);
    if (storedInc) {
      storedInc.chunkIds.push('chk_lost_id');
      await db.putIncident(storedInc);
    }

    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.diagnostics.degraded).toBe(true);
    expect(artifact.diagnostics.degradedReasons).toContain('Um ou mais lotes da gravação não foram encontrados.');
    expect(artifact.diagnostics.droppedEventsUnknown).toBe(true);

    manager.destroy();
  });

  it('marca artefato como incompleto (degraded: true) e droppedEventsUnknown quando lote tem replay corrompido', async () => {
    const manager = new IncidentManager(db, 'sess_corrupt', 'tab_corrupt', mockEnv);

    const chunkCorrupt: StoredChunk = {
      id: 'chk_corrupt',
      sessionId: 'sess_corrupt',
      tabId: 'tab_corrupt',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 150,
      replay: [],
      // Bytes gzip corrompidos / inválidos
      replayCompressed: new Uint8Array([0x1f, 0x8b, 0xff, 0xff, 0x00, 0x11]),
      timeline: []
    };
    await db.putChunk(chunkCorrupt);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_corrupt',
      timestamp: 2000,
      type: 'manual',
      signature: 'manual'
    });

    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.diagnostics.degraded).toBe(true);
    expect(
      artifact.diagnostics.degradedReasons.some((r) => r.includes('Parte do replay não pôde ser descomprimida'))
    ).toBe(true);
    expect(artifact.diagnostics.droppedEventsUnknown).toBe(true);

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

  it('captura manual com janela começando em 10s inclui lote anterior com snapshot e intermediários quando novo snapshot está aos 15s', async () => {
    const manager = new IncidentManager(db, 'sess_gap', 'tab_gap', mockEnv);
    const now = 20000;
    const windowSeconds = 10; // cutoff = 10000

    const chunk0: StoredChunk = {
      id: 'chk_0',
      sessionId: 'sess_gap',
      tabId: 'tab_gap',
      sequence: 1,
      startedAt: 0,
      endedAt: 5000,
      sizeBytes: 100,
      hasFullSnapshot: true,
      replay: [
        { type: 4, data: { width: 1920, height: 1080 }, timestamp: 500 },
        { type: 2, data: { node: 'root_initial' }, timestamp: 1000 }
      ],
      timeline: []
    };

    const chunk1: StoredChunk = {
      id: 'chk_1',
      sessionId: 'sess_gap',
      tabId: 'tab_gap',
      sequence: 2,
      startedAt: 5000,
      endedAt: 8000,
      sizeBytes: 100,
      hasFullSnapshot: false,
      replay: [{ type: 3, data: { d: 'intermediate_mutation' }, timestamp: 6000 }],
      timeline: []
    };

    const chunk2: StoredChunk = {
      id: 'chk_2',
      sessionId: 'sess_gap',
      tabId: 'tab_gap',
      sequence: 3,
      startedAt: 8000,
      endedAt: 20000,
      sizeBytes: 100,
      hasFullSnapshot: true,
      replay: [
        { type: 2, data: { node: 'root_at_15s' }, timestamp: 15000 },
        { type: 3, data: { d: 'late_mutation' }, timestamp: 18000 }
      ],
      timeline: []
    };

    await db.putChunk(chunk0);
    await db.putChunk(chunk1);
    await db.putChunk(chunk2);

    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_gap',
        timestamp: now,
        type: 'manual',
        signature: 'manual'
      },
      windowSeconds
    );

    const stored = await db.getIncident(incidentId);
    expect(stored).not.toBeNull();
    // Garante que chk_0 (base snapshot) e chk_1 (mutações intermediárias) foram incluídos junto com chk_2
    expect(stored?.chunkIds).toEqual(['chk_0', 'chk_1', 'chk_2']);

    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.incident.startedAt).toBe(10000);

    // Meta (9999), Snapshot base de chk_0 (10000), Mutação de chk_1 (10000), Novo snapshot aos 15s (15000), Mutação aos 18s (18000)
    expect(artifact.replay.length).toBe(5);
    expect(artifact.replay[0].type).toBe(4);
    expect(artifact.replay[0].timestamp).toBe(9999);
    expect(artifact.replay[1].type).toBe(2);
    expect(artifact.replay[1].timestamp).toBe(10000);
    expect(artifact.replay[1].data).toEqual({ node: 'root_initial' });
    expect(artifact.replay[2].type).toBe(3);
    expect(artifact.replay[2].timestamp).toBe(10000);
    expect(artifact.replay[2].data).toEqual({ d: 'intermediate_mutation' });
    expect(artifact.replay[3].type).toBe(2);
    expect(artifact.replay[3].timestamp).toBe(15000);
    expect(artifact.replay[3].data).toEqual({ node: 'root_at_15s' });
    expect(artifact.replay[4].type).toBe(3);
    expect(artifact.replay[4].timestamp).toBe(18000);
    expect(artifact.replay[4].data).toEqual({ d: 'late_mutation' });

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

  it('persiste ambiente no momento da criação do incidente e usa na exportação mesmo se ambiente mudar', async () => {
    let currentUrl = 'https://app.uticket.com.br/checkout';
    const dynamicEnv = () => ({
      url: currentUrl,
      userAgent: 'TestBrowser/1.0',
      viewport: { width: 1024, height: 768 }
    });

    const manager = new IncidentManager(db, 'sess_env', 'tab_env', dynamicEnv);

    const chunk: StoredChunk = {
      id: 'chk_env',
      sessionId: 'sess_env',
      tabId: 'tab_env',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: []
    };
    await db.putChunk(chunk);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_env',
      timestamp: 2000,
      type: 'manual',
      signature: 'manual'
    });

    const stored = await db.getIncident(incidentId);
    expect(stored?.environment).toBeDefined();
    expect(stored?.environment?.url).toBe('https://app.uticket.com.br/checkout');

    // Simula navegação da aplicação para /home após o incidente
    currentUrl = 'https://app.uticket.com.br/home';

    // A exportação do artefato deve refletir o ambiente de quando o incidente ocorreu (/checkout)
    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.environment.url).toBe('https://app.uticket.com.br/checkout');

    manager.destroy();
  });

  it('incidente legado sem environment recupera URL a partir do evento de navegação na timeline', async () => {
    const chunk: StoredChunk = {
      id: 'chk_legacy_nav',
      sessionId: 'sess_leg',
      tabId: 'tab_leg',
      sequence: 1,
      startedAt: 1000,
      endedAt: 3000,
      sizeBytes: 120,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: [
        {
          id: 'nav_1',
          timestamp: 1500,
          sequence: 1,
          type: 'navigation',
          toUrl: 'https://app.uticket.com.br/event/123/tickets',
          kind: 'pushState'
        }
      ]
    };
    await db.putChunk(chunk);

    // Salva incidente diretamente sem campo environment (legado)
    await db.putIncident({
      id: 'inc_legacy',
      sessionId: 'sess_leg',
      tabId: 'tab_leg',
      reason: 'error',
      triggers: [
        {
          id: 'trig_leg',
          timestamp: 2000,
          type: 'error',
          signature: 'error_sig'
        }
      ],
      startedAt: 1000,
      triggeredAt: 2000,
      finalizeAt: 3000,
      finalizedAt: 3000,
      state: 'finalized',
      chunkIds: ['chk_legacy_nav']
    });

    const manager = new IncidentManager(db, 'sess_leg', 'tab_leg', mockEnv);
    const artifact = await manager.exportArtifact('inc_legacy');

    // URL deve ser inferida da navegação da timeline e não do mockEnv atual
    expect(artifact.environment.url).toBe('https://app.uticket.com.br/event/123/tickets');

    manager.destroy();
  });

  it('incidente legado sem navegação na timeline faz fallback para o ambiente base', async () => {
    const chunk: StoredChunk = {
      id: 'chk_legacy_plain',
      sessionId: 'sess_leg_plain',
      tabId: 'tab_leg_plain',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: []
    };
    await db.putChunk(chunk);

    await db.putIncident({
      id: 'inc_legacy_plain',
      sessionId: 'sess_leg_plain',
      tabId: 'tab_leg_plain',
      reason: 'error',
      triggers: [
        {
          id: 'trig_plain',
          timestamp: 1500,
          type: 'error',
          signature: 'sig'
        }
      ],
      startedAt: 1000,
      triggeredAt: 1500,
      finalizeAt: 2000,
      finalizedAt: 2000,
      state: 'finalized',
      chunkIds: ['chk_legacy_plain']
    });

    const manager = new IncidentManager(db, 'sess_leg_plain', 'tab_leg_plain', mockEnv);
    const artifact = await manager.exportArtifact('inc_legacy_plain');

    expect(artifact.environment.url).toBe(mockEnv.url);

    manager.destroy();
  });

  it('Chunk legado com apenas hasFullSnapshot não é considerado prova temporal para o corte', async () => {
    // Chunk 1 com hasFullSnapshot: true mas sem replay nem timestamps recuperáveis
    const chunk1: StoredChunk = {
      id: 'chk_legacy_full',
      sessionId: 'sess_proof',
      tabId: 'tab_proof',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      hasFullSnapshot: true,
      replay: [],
      timeline: []
    };

    // Chunk 2 na janela
    const chunk2: StoredChunk = {
      id: 'chk_window',
      sessionId: 'sess_proof',
      tabId: 'tab_proof',
      sequence: 2,
      startedAt: 2000,
      endedAt: 3000,
      sizeBytes: 100,
      replay: [{ type: 3, data: {}, timestamp: 2500 }],
      timeline: []
    };

    await db.putChunk(chunk1);
    await db.putChunk(chunk2);

    const manager = new IncidentManager(db, 'sess_proof', 'tab_proof', mockEnv);
    // Captura manual com janela de 1s (corte em 2000)
    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_proof',
        timestamp: 3000,
        type: 'manual',
        signature: 'proof'
      },
      1
    );

    const stored = await db.getIncident(incidentId);
    expect(stored?.recordingIssues).toContain(
      'Ausência de prova temporal para snapshot em lote legado com hasFullSnapshot.'
    );

    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.diagnostics.degraded).toBe(true);

    manager.destroy();
  });

  it('duas capturas manuais no mesmo milissegundo geram IDs diferentes e persistem ambos os incidentes', async () => {
    const manager = new IncidentManager(db, 'sess_duo', 'tab_duo', mockEnv);
    const now = 1700000000000;

    const p1 = manager.trigger('manual', {
      id: 'trig_duo_1',
      timestamp: now,
      type: 'manual',
      signature: 'sig_1'
    });
    const p2 = manager.trigger('manual', {
      id: 'trig_duo_2',
      timestamp: now,
      type: 'manual',
      signature: 'sig_2'
    });

    const [id1, id2] = await Promise.all([p1, p2]);

    expect(id1).not.toBe(id2);

    const inc1 = await db.getIncident(id1);
    const inc2 = await db.getIncident(id2);
    expect(inc1).not.toBeNull();
    expect(inc2).not.toBeNull();
    expect(inc1?.id).toBe(id1);
    expect(inc2?.id).toBe(id2);

    manager.destroy();
  });

  it('artefato distingue janela solicitada de eventos preparatórios através de replayWindow', async () => {
    const manager = new IncidentManager(db, 'sess_prep', 'tab_prep', mockEnv);

    // Chunk com Meta e FullSnapshot aos 1000ms, mutação aos 1500ms, e evento na janela aos 2500ms
    const chunk: StoredChunk = {
      id: 'chk_prep',
      sessionId: 'sess_prep',
      tabId: 'tab_prep',
      sequence: 1,
      startedAt: 1000,
      endedAt: 3000,
      sizeBytes: 150,
      replay: [
        { type: 4, data: { href: 'http://localhost/', width: 1920, height: 1080 }, timestamp: 1000 },
        { type: 2, data: { node: { id: 1 } }, timestamp: 1005 },
        { type: 3, data: { source: 1, d: 'mutation pre' }, timestamp: 1500 },
        { type: 3, data: { source: 1, d: 'mutation in window' }, timestamp: 2500 }
      ],
      timeline: []
    };
    await db.putChunk(chunk);

    // Janela solicitada de 1s: cutoff aos 2000ms (now=3000ms)
    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_prep',
        timestamp: 3000,
        type: 'manual',
        signature: 'sig_prep'
      },
      1
    );

    const artifact = await manager.exportArtifact(incidentId);

    expect(artifact.replayWindow).toBeDefined();
    expect(artifact.replayWindow?.requestedStartedAt).toBe(2000);
    expect(artifact.replayWindow?.requestedEndedAt).toBe(3000);
    // Preparatórios: Meta (repositioned to 1999) + Snapshot (repositioned to 2000) + Mutation pre (repositioned to 2000) = 3
    expect(artifact.replayWindow?.preparationEventCount).toBe(3);
    expect(artifact.replayWindow?.baseSnapshotOriginalTimestamp).toBe(1005);

    const valResult = validateFlightRecorderArtifact(artifact);
    expect(valResult.success).toBe(true);

    manager.destroy();
  });

  it('droppedEvents contém a contagem real conhecida provida por getDroppedEventsCount', async () => {
    const manager = new IncidentManager(db, 'sess_drop', 'tab_drop', mockEnv, {
      getDroppedEventsCount: () => 42
    });

    const chunk: StoredChunk = {
      id: 'chk_drop',
      sessionId: 'sess_drop',
      tabId: 'tab_drop',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 100,
      replay: [{ type: 2, data: {}, timestamp: 1000 }],
      timeline: []
    };
    await db.putChunk(chunk);

    const incidentId = await manager.trigger('manual', {
      id: 'trig_drop',
      timestamp: 2000,
      type: 'manual',
      signature: 'drop'
    });

    const artifact = await manager.exportArtifact(incidentId);
    expect(artifact.diagnostics.droppedEvents).toBe(42);

    manager.destroy();
  });

  it('recorte positivo usando replay comprimido com gzip descomprime e preserva snapshot e mutações', async () => {
    const manager = new IncidentManager(db, 'sess_gzip', 'tab_gzip', mockEnv);

    const originalReplay = [
      { type: 4, data: { href: 'http://localhost/', width: 1920, height: 1080 }, timestamp: 1000 },
      { type: 2, data: { node: { id: 1 } }, timestamp: 1005 },
      { type: 3, data: { source: 1, d: 'compressed mutation 1' }, timestamp: 1500 },
      { type: 3, data: { source: 1, d: 'compressed mutation 2' }, timestamp: 2500 }
    ];

    const compressed = await compressGzip(JSON.stringify(originalReplay));

    const chunk: StoredChunk = {
      id: 'chk_gzip',
      sessionId: 'sess_gzip',
      tabId: 'tab_gzip',
      sequence: 1,
      startedAt: 1000,
      endedAt: 3000,
      sizeBytes: compressed.byteLength,
      replay: [],
      replayCompressed: compressed,
      timeline: []
    };
    await db.putChunk(chunk);

    // Janela de 1s (corte em 2000ms até 3000ms)
    const incidentId = await manager.trigger(
      'manual',
      {
        id: 'trig_gzip',
        timestamp: 3000,
        type: 'manual',
        signature: 'sig_gzip'
      },
      1
    );

    const artifact = await manager.exportArtifact(incidentId);

    expect(artifact.replay.length).toBe(4);
    expect(artifact.replay[0].type).toBe(4);
    expect(artifact.replay[0].timestamp).toBe(1999);
    expect(artifact.replay[1].type).toBe(2);
    expect(artifact.replay[1].timestamp).toBe(2000);
    expect(artifact.replay[2].data).toEqual({ source: 1, d: 'compressed mutation 1' });
    expect(artifact.replay[2].timestamp).toBe(2000);
    expect(artifact.replay[3].data).toEqual({ source: 1, d: 'compressed mutation 2' });
    expect(artifact.replay[3].timestamp).toBe(2500);

    const valResult = validateFlightRecorderArtifact(artifact);
    expect(valResult.success).toBe(true);

    manager.destroy();
  });

  it('reload depois do prazo finaliza incidente automático real sem estender artificialmente a duração', async () => {
    const fixedNow = 1700000000000;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(fixedNow);

    // 1. Instância 1 dispara um incidente automático com prazo de 10 segundos
    const manager1 = new IncidentManager(db, 'sess_reload_auto', 'tab_reload_auto', mockEnv, {
      afterErrorSeconds: 10
    });

    const incidentId = await manager1.trigger('error', {
      id: 'trig_auto_reload',
      timestamp: fixedNow,
      type: 'error',
      signature: 'TypeError: auto reload test'
    });

    const storedPending = await db.getIncident(incidentId);
    expect(storedPending?.state).toBe('pending');
    expect(storedPending?.finalizeAt).toBe(fixedNow + 10000);

    // Simula destruição da aba (reload)
    manager1.destroy();

    // 2. O usuário recarrega a página 15 segundos após o erro (já expirou os 10s)
    vi.setSystemTime(fixedNow + 15000);

    const manager2 = new IncidentManager(db, 'sess_reload_auto', 'tab_reload_auto', mockEnv, {
      afterErrorSeconds: 10
    });

    // init() deve detectar que o prazo venceu durante a ausência da aba e finalizar imediatamente
    await manager2.init();

    const storedFinal = await db.getIncident(incidentId);
    expect(storedFinal?.state).toBe('finalized');
    // finalizedAt não deve ser o momento do reload (15s), mas sim clampado em finalizeAt (10s)!
    expect(storedFinal?.finalizedAt).toBe(fixedNow + 10000);

    manager2.destroy();
    vi.useRealTimers();
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

    it('preserva mutações ocorridas no mesmo milissegundo após o snapshot base', () => {
      const events = [
        { type: 4, data: { width: 1920, height: 1080 }, timestamp: 1000 },
        { type: 2, data: { node: 'root' }, timestamp: 1000 },
        // Mutação no mesmo milissegundo (1000) mas posterior na sequência
        { type: 3, data: { d: 'mutation same ms' }, timestamp: 1000 },
        { type: 3, data: { d: 'mutation window' }, timestamp: 2000 }
      ];

      // Janela de 2000 a 3000
      const sliced = sliceReplayEventsForWindow(events, 2000, 3000);

      // Deve conter Meta (1999), Snapshot (2000), Mutação same ms (2000) e Mutação window (2000)
      expect(sliced.length).toBe(4);
      expect(sliced[0].type).toBe(4);
      expect(sliced[0].timestamp).toBe(1999);
      expect(sliced[1].type).toBe(2);
      expect(sliced[1].timestamp).toBe(2000);
      expect(sliced[2].data).toEqual({ d: 'mutation same ms' });
      expect(sliced[2].timestamp).toBe(2000);
      expect(sliced[3].data).toEqual({ d: 'mutation window' });
      expect(sliced[3].timestamp).toBe(2000);
    });

    it('preserva evento Meta e base snapshot mesmo quando o snapshot da janela está após o início', () => {
      const events = [
        { type: 4, data: { width: 1920, height: 1080 }, timestamp: 1000 },
        { type: 2, data: { node: 'root 1' }, timestamp: 1000 },
        { type: 3, data: { d: 'mut 1' }, timestamp: 1500 },
        { type: 2, data: { node: 'root 2' }, timestamp: 2500 }
      ];

      // Janela de 2000 a 3000: há um snapshot em 2500, mas o início em 2000 precisa da base de 1000
      const sliced = sliceReplayEventsForWindow(events, 2000, 3000);

      // Deve ter Meta (1999), Snapshot 1 (2000), mut 1 (2000) e Snapshot 2 (2500)
      expect(sliced.length).toBe(4);
      expect(sliced[0].type).toBe(4);
      expect(sliced[1].type).toBe(2);
      expect(sliced[1].data).toEqual({ node: 'root 1' });
      expect(sliced[2].data).toEqual({ d: 'mut 1' });
      expect(sliced[3].type).toBe(2);
      expect(sliced[3].data).toEqual({ node: 'root 2' });
    });

    it('Meta posterior ao corte não é movido para o início e replay não fabrica contexto temporal', () => {
      const events = [
        { type: 3, data: { d: 'mutation within window' }, timestamp: 2500 },
        { type: 4, data: { width: 1920, height: 1080 }, timestamp: 3500 } // Meta futuro (> 3000)
      ];

      // Janela de 2000 a 3000 (sem snapshot e sem Meta anterior)
      const sliced = sliceReplayEventsForWindow(events, 2000, 3000);

      // O Meta em 3500 NÃO pode ser movido para 1999 (startedAt - 1)
      expect(sliced.some((e) => e.type === 4 && e.timestamp < 2000)).toBe(false);
      expect(sliced.length).toBe(1);
      expect(sliced[0].timestamp).toBe(2500);
    });
  });
});
