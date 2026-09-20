import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { BatchWriter } from '../../src/storage/batch-writer';
import type { TimelineEvent } from '../../src/types';

describe('Lote 1 — DB e BatchWriter', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(() => {
    db.close();
  });

  it('abre o banco e cria as object stores (sessions, chunks, incidents)', async () => {
    const rawDb = await db.open();
    expect(rawDb.objectStoreNames.contains('sessions')).toBe(true);
    expect(rawDb.objectStoreNames.contains('chunks')).toBe(true);
    expect(rawDb.objectStoreNames.contains('incidents')).toBe(true);
  });

  it('BatchWriter grava eventos em lote e preserva sequência cronológica', async () => {
    const writer = new BatchWriter(db, 'sess_test_1', 'tab_test_1', {
      flushIntervalMs: 50,
      maxBatchEvents: 10,
      chunkDurationMs: 10000
    });

    const evt1: TimelineEvent = {
      id: 'e1',
      timestamp: 1000,
      sequence: 1,
      type: 'marker',
      label: 'start'
    };
    const evt2: TimelineEvent = {
      id: 'e2',
      timestamp: 1005,
      sequence: 2,
      type: 'marker',
      label: 'middle'
    };

    writer.addTimelineEvent(evt1);
    writer.addTimelineEvent(evt2);

    await writer.flush();

    const chunks = await db.getChunksBySession('sess_test_1');
    expect(chunks.length).toBe(1);
    expect(chunks[0].sequence).toBe(1);
    expect(chunks[0].timeline.length).toBe(2);
    expect(chunks[0].timeline[0].id).toBe('e1');
    expect(chunks[0].timeline[1].id).toBe('e2');

    writer.destroy();
  });

  it('BatchWriter notifica onError em falha sem lançar na aplicação', async () => {
    let capturedError: unknown = null;
    const writer = new BatchWriter(
      db,
      'sess_test_2',
      'tab_test_2',
      { maxBatchEvents: 1 },
      (err) => {
        capturedError = err;
      }
    );

    // Força erro no putChunk
    vi.spyOn(db, 'putChunk').mockRejectedValueOnce(new Error('QuotaExceededError'));

    // Adiciona evento
    writer.addTimelineEvent({
      id: 'e3',
      timestamp: 2000,
      sequence: 3,
      type: 'marker',
      label: 'will_fail'
    });

    await writer.flush();

    expect(capturedError).not.toBeNull();
    expect((capturedError as Error).message).toBe('QuotaExceededError');
    writer.destroy();
  });
});
