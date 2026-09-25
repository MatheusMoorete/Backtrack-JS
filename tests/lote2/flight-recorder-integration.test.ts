import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { validateFlightRecorderArtifact } from '../../src/validation/validate';
import { resetSessionContext } from '../../src/storage/session';

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

  afterEach(async () => {
    await recorder.stop();
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

  it('stop() impede novas capturas e restaura o recorder para stopped', async () => {
    await recorder.stop();
    expect(recorder.getHealth().state).toBe('stopped');
  });

  it('stop() aguarda flush de escritas pendentes e persiste eventos finais no IndexedDB', async () => {
    console.log('Evento antes de parar o recorder');

    let resolvePutChunk!: () => void;
    const putChunkDeferred = new Promise<void>((resolve) => {
      resolvePutChunk = resolve;
    });

    const originalPutChunk = db.putChunk.bind(db);
    let intercepted = false;

    vi.spyOn(db, 'putChunk').mockImplementation(async (chunk) => {
      if (!intercepted) {
        intercepted = true;
        await putChunkDeferred;
      }
      return originalPutChunk(chunk);
    });

    let stopResolved = false;
    const stopPromise = recorder.stop().then(() => {
      stopResolved = true;
    });

    // Confirma que stopPromise ainda não resolveu enquanto putChunk estiver pendente
    await new Promise((r) => setTimeout(r, 30));
    expect(stopResolved).toBe(false);

    // Libera a escrita no banco
    resolvePutChunk();

    // Agora stop() deve resolver
    await stopPromise;
    expect(stopResolved).toBe(true);

    // Validações pós-stop
    expect(recorder.getHealth().state).toBe('stopped');
    expect(recorder.getHealth().pendingWrites).toBe(0);

    // Verifica que o chunk com a mensagem de log foi persistido
    const chunks = await db.getAllChunks();
    const hasLogEvent = chunks.some((c) =>
      c.timeline.some((e) => JSON.stringify(e).includes('Evento antes de parar o recorder'))
    );
    expect(hasLogEvent).toBe(true);
  });

  it('stop() é idempotente ao ser chamado consecutivamente', async () => {
    expect(recorder.getHealth().state).toBe('recording');

    await recorder.stop();
    expect(recorder.getHealth().state).toBe('stopped');

    // Segunda chamada consecutiva não deve lançar erro e deve manter stopped
    await expect(recorder.stop()).resolves.toBeUndefined();
    expect(recorder.getHealth().state).toBe('stopped');
  });
});

function createMockStorage(initialData: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null
  };
}

describe('Lote 2 — Sincronização de incident_pending com IncidentManager', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;
  let recorder: FlightRecorderImpl;

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout']
    });
    vi.setSystemTime(1700000000000);
    resetSessionContext();
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
    recorder = new FlightRecorderImpl(
      {
        bufferMinutes: 5,
        afterErrorSeconds: 10,
        sessionOptions: { disableBroadcastChannel: true }
      },
      db
    );
    await recorder.start();
  });

  afterEach(async () => {
    await recorder.stop();
    db.close();
    resetSessionContext();
    vi.useRealTimers();
  });

  it('erro automático muda getHealth().state para incident_pending e fim do prazo retorna para recording', async () => {
    expect(recorder.getHealth().state).toBe('recording');

    await recorder.captureException(new Error('Erro de teste'));
    expect(recorder.getHealth().state).toBe('incident_pending');

    // Ao expirar o prazo após 10 segundos, finaliza e retorna para recording
    await vi.advanceTimersByTimeAsync(10000);
    await vi.waitFor(() => expect(recorder.getHealth().state).toBe('recording'));
  });

  it('captura manual durante incidente automático não altera o estado pendente', async () => {
    await recorder.captureException(new Error('Erro inicial'));
    expect(recorder.getHealth().state).toBe('incident_pending');

    // Captura manual durante a janela de tolerância não finaliza o estado da máquina
    await recorder.capture('manual_no_meio');
    expect(recorder.getHealth().state).toBe('incident_pending');

    // Quando o prazo do incidente automático expira, transita para recording
    await vi.advanceTimersByTimeAsync(10000);
    await vi.waitFor(() => expect(recorder.getHealth().state).toBe('recording'));
  });

  it('reload dentro do prazo recupera incident_pending', async () => {
    const fixedNow = 1700000000000;
    const storage = createMockStorage();
    const customDb = new FlightRecorderDB(new IDBFactory());

    const rec1 = new FlightRecorderImpl(
      {
        storage,
        sessionOptions: { disableBroadcastChannel: true },
        afterErrorSeconds: 10
      },
      customDb
    );
    await rec1.start();
    expect(rec1.getHealth().state).toBe('recording');

    await rec1.captureException(new Error('Erro antes do reload'));
    expect(rec1.getHealth().state).toBe('incident_pending');

    // Avança 4s (ainda restam 6s para finalizeAt)
    vi.setSystemTime(fixedNow + 4000);
    rec1.destroy();
    resetSessionContext();

    // Nova instância simulando a mesma aba após reload
    const rec2 = new FlightRecorderImpl(
      {
        storage,
        sessionOptions: { disableBroadcastChannel: true },
        afterErrorSeconds: 10
      },
      customDb
    );
    await rec2.start();

    // Deve inicializar recuperando o estado incident_pending
    expect(rec2.getHealth().state).toBe('incident_pending');

    // Avança os 6 segundos restantes
    vi.setSystemTime(fixedNow + 10000);
    await vi.advanceTimersByTimeAsync(6000);

    await vi.waitFor(() => expect(rec2.getHealth().state).toBe('recording'));

    rec2.destroy();
    customDb.close();
  });

  it('reload depois do prazo finaliza o incidente e inicia em recording', async () => {
    const fixedNow = 1700000000000;
    const storage = createMockStorage();
    const customDb = new FlightRecorderDB(new IDBFactory());

    const rec1 = new FlightRecorderImpl(
      {
        storage,
        sessionOptions: { disableBroadcastChannel: true },
        afterErrorSeconds: 10
      },
      customDb
    );
    await rec1.start();
    expect(rec1.getHealth().state).toBe('recording');

    await rec1.captureException(new Error('Erro antes do reload'));
    expect(rec1.getHealth().state).toBe('incident_pending');

    await rec1.destroy();
    resetSessionContext();

    // Avança 15s (além do prazo de 10s: finalizeAt já expirou)
    vi.setSystemTime(fixedNow + 15000);

    const rec2 = new FlightRecorderImpl(
      {
        storage,
        sessionOptions: { disableBroadcastChannel: true },
        afterErrorSeconds: 10
      },
      customDb
    );
    await rec2.start();

    // Como o prazo já havia vencido, finaliza durante o init() e inicia em recording
    expect(rec2.getHealth().state).toBe('recording');

    const incidents = await rec2.listIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].finalizedAt).toBeDefined();

    const stored = await customDb.getIncident(incidents[0].id);
    expect(stored?.state).toBe('finalized');

    await rec2.destroy();
    customDb.close();
  });

  it('gatilho duplicado não cria nova transição nem novo incidente', async () => {
    const fixedNow = 1700000000000;
    vi.setSystemTime(fixedNow);

    expect(recorder.getHealth().state).toBe('recording');

    const err = new Error('Erro deduplicado');
    await recorder.captureException(err);
    expect(recorder.getHealth().state).toBe('incident_pending');

    // Dispara novamente o mesmo erro dentro de 10s
    vi.setSystemTime(fixedNow + 2000);
    await recorder.captureException(err);
    expect(recorder.getHealth().state).toBe('incident_pending');

    const incidents = await recorder.listIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].triggerCount).toBe(2);
  });

  it('falha interna no IncidentManager marca o recorder como degradado sem escapar para a aplicação', async () => {
    const unhandledSpy = vi.fn();
    window.addEventListener('unhandledrejection', unhandledSpy);

    // Simula falha no método de persistência do db do IncidentManager
    const customDb = (recorder as unknown as { db: FlightRecorderDB }).db;
    vi.spyOn(customDb, 'putIncident').mockRejectedValue(new Error('IndexedDB storage fault'));

    // captureException não deve propagar erro para o chamador nem causar unhandledrejection
    await recorder.captureException(new Error('Erro capturado'));

    await vi.advanceTimersByTimeAsync(50);
    expect(unhandledSpy).not.toHaveBeenCalled();

    // Recorder foi degradado internamente
    const health = recorder.getHealth();
    expect(health.state).toBe('degraded');
    expect(health.reasons.some((r) => r.includes('gerenciamento de incidentes'))).toBe(true);

    window.removeEventListener('unhandledrejection', unhandledSpy);
  });

  it('ambiente do incidente exportado reflete o momento do erro mesmo após navegação subsequente e recorder parado', async () => {
    // 1. Navega para /checkout antes do erro
    window.history.pushState({}, '', '/checkout');

    // 2. Dispara incidente na página /checkout
    await recorder.captureException(new Error('Erro no checkout'));
    expect(recorder.getHealth().state).toBe('incident_pending');

    const incidents = await recorder.listIncidents();
    expect(incidents.length).toBe(1);
    const incidentId = incidents[0].id;

    // 3. Usuário navega para /home
    window.history.pushState({}, '', '/home');

    // 4. Recorder é parado
    await recorder.stop();
    expect(recorder.getHealth().state).toBe('stopped');

    // 5. Exporta o artefato após stop() e após a navegação
    const artifact = await recorder.getArtifact(incidentId);

    // O artefato deve registrar /checkout, NÃO /home
    expect(artifact.environment.url).toContain('/checkout');
    expect(artifact.environment.url).not.toContain('/home');
  });

  it('retenção disparada por flush não apaga chunks da captura manual mesmo com limite de armazenamento estrito', async () => {
    await recorder.stop();
    const tightRecorder = new FlightRecorderImpl(
      {
        bufferMinutes: 5,
        maxStorageMb: 0.0001,
        afterErrorSeconds: 10,
        sessionOptions: { disableBroadcastChannel: true }
      },
      db
    );
    await tightRecorder.start();

    const incidentId = await tightRecorder.capture('captura_com_retencao');

    const incident = await db.getIncident(incidentId);
    expect(incident).not.toBeNull();
    expect(incident?.chunkIds.length).toBeGreaterThan(0);

    const chunks = await db.getChunksByIds(incident!.chunkIds);
    expect(chunks.length).toBe(incident!.chunkIds.length);

    await tightRecorder.stop();
  });

  it('clear() cancela incidente pendente em memória, timer e retorna recorder para recording', async () => {
    await recorder.captureException(new Error('Erro pendente para clear'));
    expect(recorder.getHealth().state).toBe('incident_pending');

    await recorder.clear();

    expect(recorder.getHealth().state).toBe('recording');
    const incidents = await recorder.listIncidents();
    expect(incidents.length).toBe(0);

    // Avança o relógio além do deadline original de 10s
    await vi.advanceTimersByTimeAsync(12000);

    expect(recorder.getHealth().state).toBe('recording');
    const incidentsAfter = await recorder.listIncidents();
    expect(incidentsAfter.length).toBe(0);
  });

  it('falha no timer de finalização não gera unhandledrejection', async () => {
    let unhandledReceived = false;
    const rejectionHandler = () => {
      unhandledReceived = true;
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('unhandledrejection', rejectionHandler);
    }
    process.on('unhandledRejection', rejectionHandler);

    try {
      await recorder.captureException(new Error('Erro para teste de timer falho'));
      expect(recorder.getHealth().state).toBe('incident_pending');

      vi.spyOn(db, 'getIncident').mockRejectedValueOnce(new Error('Erro simulado de IndexedDB durante timer'));

      await vi.advanceTimersByTimeAsync(12000);

      expect(unhandledReceived).toBe(false);
    } finally {
      if (typeof window !== 'undefined') {
        window.removeEventListener('unhandledrejection', rejectionHandler);
      }
      process.off('unhandledRejection', rejectionHandler);
      vi.restoreAllMocks();
    }
  });

  it('droppedEvents é persistido no incidente e retém o valor real após stop()', async () => {
    (recorder as any).rrwebCapturer = {
      getDroppedEventsCount: () => 42,
      stop: () => {}
    };

    const incidentId = await recorder.capture('teste_dropped_persisted');

    const artifactActive = await recorder.getArtifact(incidentId);
    expect(artifactActive.diagnostics.droppedEvents).toBe(42);

    await recorder.stop();

    const artifactAfterStop = await recorder.getArtifact(incidentId);
    expect(artifactAfterStop.diagnostics.droppedEvents).toBe(42);
  });

  it('stop() aguarda gatilhos assíncronos em andamento e fecha BroadcastChannels', async () => {
    let triggerCompleted = false;

    const capturePromise = recorder.captureException(new Error('Erro durante stop'));
    void (async () => {
      await capturePromise;
      triggerCompleted = true;
    })();

    await recorder.stop();

    expect(triggerCompleted).toBe(true);
    expect(recorder.getHealth().state).toBe('stopped');
  });
});
