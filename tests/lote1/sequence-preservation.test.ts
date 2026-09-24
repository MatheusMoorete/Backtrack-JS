import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { BatchWriter } from '../../src/storage/batch-writer';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import {
  closeSessionChannel,
  resetSessionContext
} from '../../src/storage/session';
import { sortTimelineEvents } from '../../src/validation/validate';

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

describe('Lote 1 — Preservação de Sequências após Reload', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    vi.useRealTimers();
    closeSessionChannel();
    resetSessionContext();
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(() => {
    vi.useRealTimers();
    closeSessionChannel();
    db.close();
  });

  it('BatchWriter inicializa com initialChunkSequence configurado', async () => {
    const writer = new BatchWriter(db, 'sess_custom_seq', 'tab_custom_seq', {
      initialChunkSequence: 2,
      maxBatchEvents: 1
    });

    expect(writer.getChunkSequence()).toBe(2);

    writer.addTimelineEvent({
      id: 'evt_1',
      timestamp: 1000,
      sequence: 3,
      type: 'marker',
      label: 'test_marker'
    });

    await writer.flush();

    expect(writer.getChunkSequence()).toBe(3);

    const chunks = await db.getChunksBySession('sess_custom_seq');
    expect(chunks.length).toBe(1);
    expect(chunks[0].sequence).toBe(3);

    writer.destroy();
  });

  it('preserva sequências de timeline e de chunks após reload com relógio controlado', async () => {
    const fixedTimestamp = 1700000000000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(fixedTimestamp);

    const sharedStorage = createMockStorage();

    // 1. Inicia o primeiro recorder (Aba antes do reload)
    const recorder1 = new FlightRecorderImpl(
      {
        storage: sharedStorage,
        sessionOptions: { timeoutMs: 10 },
        batchWriterConfig: {
          chunkDurationMs: 1000,
          flushIntervalMs: 50
        }
      },
      db
    );
    await recorder1.start();

    // 2. Grava eventos na instância 1
    // Evento 1 é a navegação inicial automática (sequence 1)
    // Evento 2: Mensagem de log (sequence 2)
    console.log('Mensagem 1');
    await recorder1.flush();

    // Avança tempo para forçar abertura de novo chunk na mesma sessão
    vi.setSystemTime(fixedTimestamp + 2000);

    // Evento 3: Mensagem de log em novo chunk (sequence 3, chunk sequence 2)
    console.log('Mensagem 2');
    await recorder1.flush();

    // Valida o estado antes do reload
    const initialSessionId = sharedStorage.getItem('__backtrack_session_id__');
    expect(initialSessionId).toBeTruthy();

    const chunksBeforeReload = await db.getChunksBySession(initialSessionId!);
    expect(chunksBeforeReload.length).toBe(2);
    expect(chunksBeforeReload[0].sequence).toBe(1);
    expect(chunksBeforeReload[1].sequence).toBe(2);

    const timelineSeqsBeforeReload = chunksBeforeReload.flatMap((c) =>
      c.timeline.map((e) => e.sequence)
    );
    expect(timelineSeqsBeforeReload).toEqual([1, 2, 3]);

    // 3. Destrói a primeira instância simulando encerramento/reload da aba
    recorder1.destroy();
    closeSessionChannel();
    resetSessionContext();

    // 4. Inicia uma nova instância com o mesmo storage e mesmo IndexedDB (após reload)
    // Mantém timestamp idêntico ao último evento para verificar ordenação determinística
    vi.setSystemTime(fixedTimestamp + 2000);

    const recorder2 = new FlightRecorderImpl(
      {
        storage: sharedStorage,
        sessionOptions: { timeoutMs: 10 },
        batchWriterConfig: {
          chunkDurationMs: 1000,
          flushIntervalMs: 50
        }
      },
      db
    );
    await recorder2.start();

    // 5. Grava novos eventos após o reload:
    // Evento 4 é a navegação inicial da nova instância (sequence 4)
    // Evento 5: nova mensagem após reload (sequence 5, chunk sequence 3)
    console.log('Mensagem 3 pós-reload');
    await recorder2.flush();

    // 6. Confirma que as sequências continuam crescendo e não voltam para 1
    const chunksAfterReload = await db.getChunksBySession(initialSessionId!);
    expect(chunksAfterReload.length).toBe(3);

    const chunkSequences = chunksAfterReload.map((c) => c.sequence);
    expect(chunkSequences).toEqual([1, 2, 3]);

    const allTimelineEvents = chunksAfterReload.flatMap((c) => c.timeline);
    const allTimelineSeqs = allTimelineEvents.map((e) => e.sequence);
    expect(allTimelineSeqs).toEqual([1, 2, 3, 4, 5]);

    // Nenhuma sequência pode ser reiniciada ou duplicada
    const uniqueSeqs = new Set(allTimelineSeqs);
    expect(uniqueSeqs.size).toBe(allTimelineSeqs.length);

    // Valida ordenação determinística com eventos que compartilham o mesmo timestamp
    const sorted = sortTimelineEvents(allTimelineEvents);
    expect(sorted.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);

    recorder2.destroy();
  });
});
