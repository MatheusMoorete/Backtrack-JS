import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { RetentionEngine } from '../../src/storage/retention';
import type { StoredChunk } from '../../src/types/chunk';
import type { StoredIncident } from '../../src/types/incident';

describe('Lote 1 — Motor de Retenção e Ring Buffer', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;
  let retention: RetentionEngine;

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
    retention = new RetentionEngine(db, {
      bufferMinutes: 5,
      maxStorageMb: 1 // 1 MB para facilitar testes
    });
  });

  afterEach(() => {
    db.close();
  });

  it('remove chunks expirados pelo tempo quando não protegidos', async () => {
    const now = 1000000;
    const sixMinutesAgo = now - 6 * 60 * 1000;
    const twoMinutesAgo = now - 2 * 60 * 1000;

    const oldChunk: StoredChunk = {
      id: 'chk_old',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 1,
      startedAt: sixMinutesAgo - 10000,
      endedAt: sixMinutesAgo,
      sizeBytes: 1000,
      replay: [],
      timeline: []
    };

    const recentChunk: StoredChunk = {
      id: 'chk_recent',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 2,
      startedAt: twoMinutesAgo - 10000,
      endedAt: twoMinutesAgo,
      sizeBytes: 1000,
      replay: [],
      timeline: []
    };

    await db.putChunk(oldChunk);
    await db.putChunk(recentChunk);

    const result = await retention.prune(now);
    expect(result.deletedChunkIds).toContain('chk_old');
    expect(result.deletedChunkIds).not.toContain('chk_recent');

    const remainingChunks = await db.getAllChunks();
    expect(remainingChunks.length).toBe(1);
    expect(remainingChunks[0].id).toBe('chk_recent');
  });

  it('NUNCA remove chunks protegidos por incidentes, mesmo que expirados', async () => {
    const now = 1000000;
    const tenMinutesAgo = now - 10 * 60 * 1000;

    const expiredProtectedChunk: StoredChunk = {
      id: 'chk_protected_incident',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 1,
      startedAt: tenMinutesAgo - 10000,
      endedAt: tenMinutesAgo,
      sizeBytes: 5000,
      replay: [],
      timeline: []
    };

    const expiredUnprotectedChunk: StoredChunk = {
      id: 'chk_unprotected',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 2,
      startedAt: tenMinutesAgo - 10000,
      endedAt: tenMinutesAgo,
      sizeBytes: 5000,
      replay: [],
      timeline: []
    };

    await db.putChunk(expiredProtectedChunk);
    await db.putChunk(expiredUnprotectedChunk);

    // Registra incidente que protege chk_protected_incident
    const incident: StoredIncident = {
      id: 'inc_1',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      reason: 'error',
      triggers: [],
      startedAt: tenMinutesAgo,
      triggeredAt: tenMinutesAgo,
      finalizeAt: now + 5000,
      state: 'pending',
      chunkIds: ['chk_protected_incident']
    };
    await db.putIncident(incident);

    const result = await retention.prune(now);
    expect(result.deletedChunkIds).toContain('chk_unprotected');
    expect(result.deletedChunkIds).not.toContain('chk_protected_incident');

    const remaining = await db.getAllChunks();
    expect(remaining.some((c) => c.id === 'chk_protected_incident')).toBe(true);
    expect(remaining.some((c) => c.id === 'chk_unprotected')).toBe(false);
  });

  it('remove os mais antigos primeiro quando o limite de bytes é atingido', async () => {
    // Configura retenção com limite de 100 KB para teste
    const smallRetention = new RetentionEngine(db, {
      bufferMinutes: 60,
      maxStorageMb: 0.0001 // ~104 bytes
    });

    const now = 100000;
    const chunkA: StoredChunk = {
      id: 'chk_a_oldest',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 1,
      startedAt: 1000,
      endedAt: 2000,
      sizeBytes: 60,
      replay: [],
      timeline: []
    };
    const chunkB: StoredChunk = {
      id: 'chk_b_middle',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 2,
      startedAt: 3000,
      endedAt: 4000,
      sizeBytes: 60,
      replay: [],
      timeline: []
    };
    const chunkC: StoredChunk = {
      id: 'chk_c_newest',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 3,
      startedAt: 5000,
      endedAt: 6000,
      sizeBytes: 60,
      replay: [],
      timeline: []
    };

    await db.putChunk(chunkA);
    await db.putChunk(chunkB);
    await db.putChunk(chunkC);

    const result = await smallRetention.prune(now);
    // Deve remover o mais antigo (chunkA) primeiro para caber no limite
    expect(result.deletedChunkIds).toContain('chk_a_oldest');
    expect(result.reclaimedBytes).toBe(120);
    expect((result as unknown as Record<string, unknown>).droppedEventsCount).toBeUndefined();
  });

  it('não calcula métrica incorreta de descarte para chunks comprimidos com replay vazio', async () => {
    const now = 1000000;
    const oldCompressedChunk: StoredChunk = {
      id: 'chk_compressed_old',
      sessionId: 'sess_1',
      tabId: 'tab_1',
      sequence: 1,
      startedAt: now - 10 * 60 * 1000,
      endedAt: now - 9 * 60 * 1000,
      sizeBytes: 1500,
      replay: [],
      replayCompressed: new Uint8Array([1, 2, 3, 4, 5]),
      timeline: []
    };

    await db.putChunk(oldCompressedChunk);

    const result = await retention.prune(now);
    expect(result.deletedChunkIds).toContain('chk_compressed_old');
    expect(result.reclaimedBytes).toBe(1500);
    // droppedEventsCount e getDroppedEventsTotal foram removidos
    expect((result as unknown as Record<string, unknown>).droppedEventsCount).toBeUndefined();
    expect((retention as unknown as Record<string, unknown>).getDroppedEventsTotal).toBeUndefined();
  });
});
