import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { BatchWriter } from '../../src/storage/batch-writer';

describe('Lote 1 — Isolamento de Sessões entre Abas', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(() => {
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
});
