import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { BatchWriter } from '../../src/storage/batch-writer';
import {
  claimSessionContext,
  closeSessionChannel,
  resetSessionContext
} from '../../src/storage/session';

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

describe('Lote 1 — Isolamento de Sessões entre Abas', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    closeSessionChannel();
    resetSessionContext();
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(() => {
    closeSessionChannel();
    db.close();
  });

  it('duas abas gravam sessões separadas no mesmo IndexedDB sem misturar eventos', async () => {
    const writerTabA = new BatchWriter(db, 'sess_tab_a', 'tab_a');
    const writerTabB = new BatchWriter(db, 'sess_tab_b', 'tab_b');

    writerTabA.addTimelineEvent({
      id: 'a1',
      timestamp: 100,
      sequence: 1,
      type: 'marker',
      label: 'tab_a_event'
    });

    writerTabB.addTimelineEvent({
      id: 'b1',
      timestamp: 105,
      sequence: 1,
      type: 'marker',
      label: 'tab_b_event'
    });

    await writerTabA.flush();
    await writerTabB.flush();

    const chunksA = await db.getChunksBySession('sess_tab_a');
    const chunksB = await db.getChunksBySession('sess_tab_b');

    expect(chunksA.length).toBe(1);
    expect(chunksB.length).toBe(1);

    const evtA = chunksA[0].timeline[0];
    const evtB = chunksB[0].timeline[0];

    expect(evtA.id).toBe('a1');
    if (evtA.type === 'marker') {
      expect(evtA.label).toBe('tab_a_event');
    }

    expect(evtB.id).toBe('b1');
    if (evtB.type === 'marker') {
      expect(evtB.label).toBe('tab_b_event');
    }

    writerTabA.destroy();
    writerTabB.destroy();
  });

  it('reutilização dos IDs após reload', async () => {
    const storage = createMockStorage();

    // Primeira inicialização da aba
    const firstContext = await claimSessionContext({ storage, timeoutMs: 20 });
    expect(firstContext.tabId).toBeDefined();
    expect(firstContext.sessionId).toBeDefined();

    // Simula reload da página: a instância anterior descarrega seu canal, mas o storage persiste
    closeSessionChannel();

    const reloadContext = await claimSessionContext({ storage, timeoutMs: 20 });
    expect(reloadContext.tabId).toBe(firstContext.tabId);
    expect(reloadContext.sessionId).toBe(firstContext.sessionId);
  });

  it('detecção de duas abas com storage inicialmente clonado e renovação de ambos os IDs na aba que detectar a colisão', async () => {
    const storageTabA = createMockStorage();
    const ctxA = await claimSessionContext({
      storage: storageTabA,
      timeoutMs: 20,
      channelName: 'test_isolation_dup_channel'
    });

    // Simula aba duplicada pelo navegador: herda o mesmo sessionStorage da aba original
    const storageTabB = createMockStorage({
      __backtrack_tab_id__: ctxA.tabId,
      __backtrack_session_id__: ctxA.sessionId
    });

    // Aba B tenta reivindicar o tabId herdado via BroadcastChannel
    const ctxB = await claimSessionContext({
      storage: storageTabB,
      timeoutMs: 20,
      channelName: 'test_isolation_dup_channel'
    });

    // Aba B deve detectar a colisão com a Aba A ativa e gerar novas identidades
    expect(ctxB.tabId).not.toBe(ctxA.tabId);
    expect(ctxB.sessionId).not.toBe(ctxA.sessionId);

    // O storage da Aba B deve ter sido atualizado com as novas identidades
    expect(storageTabB.getItem('__backtrack_tab_id__')).toBe(ctxB.tabId);
    expect(storageTabB.getItem('__backtrack_session_id__')).toBe(ctxB.sessionId);

    // O storage da Aba A permanece intacto
    expect(storageTabA.getItem('__backtrack_tab_id__')).toBe(ctxA.tabId);
    expect(storageTabA.getItem('__backtrack_session_id__')).toBe(ctxA.sessionId);
  });

  it('isolamento dos chunks após essa renovação', async () => {
    const storageTabA = createMockStorage();
    const ctxA = await claimSessionContext({
      storage: storageTabA,
      timeoutMs: 20,
      channelName: 'test_chunks_dup_channel'
    });

    const storageTabB = createMockStorage({
      __backtrack_tab_id__: ctxA.tabId,
      __backtrack_session_id__: ctxA.sessionId
    });

    const ctxB = await claimSessionContext({
      storage: storageTabB,
      timeoutMs: 20,
      channelName: 'test_chunks_dup_channel'
    });

    // Ambas as abas gravam no mesmo banco de dados
    const writerA = new BatchWriter(db, ctxA.sessionId, ctxA.tabId);
    const writerB = new BatchWriter(db, ctxB.sessionId, ctxB.tabId);

    writerA.addTimelineEvent({
      id: 'evt_tab_a',
      timestamp: 1000,
      sequence: 1,
      type: 'marker',
      label: 'aba_original'
    });

    writerB.addTimelineEvent({
      id: 'evt_tab_b',
      timestamp: 1005,
      sequence: 1,
      type: 'marker',
      label: 'aba_duplicada'
    });

    await writerA.flush();
    await writerB.flush();

    const chunksA = await db.getChunksBySession(ctxA.sessionId);
    const chunksB = await db.getChunksBySession(ctxB.sessionId);

    expect(chunksA.length).toBe(1);
    expect(chunksB.length).toBe(1);

    expect(chunksA[0].tabId).toBe(ctxA.tabId);
    expect(chunksB[0].tabId).toBe(ctxB.tabId);

    expect(chunksA[0].timeline[0].id).toBe('evt_tab_a');
    expect(chunksB[0].timeline[0].id).toBe('evt_tab_b');

    writerA.destroy();
    writerB.destroy();
  });

  it('inicia normalmente mesmo na ausência de BroadcastChannel (fallback seguro)', async () => {
    const storage = createMockStorage();
    const ctx = await claimSessionContext({ storage, disableBroadcastChannel: true });

    expect(ctx.tabId).toBeDefined();
    expect(ctx.sessionId).toBeDefined();
    expect(storage.getItem('__backtrack_tab_id__')).toBe(ctx.tabId);
    expect(storage.getItem('__backtrack_session_id__')).toBe(ctx.sessionId);
  });
});

