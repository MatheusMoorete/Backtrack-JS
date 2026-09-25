import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { RetentionEngine } from '../../src/storage/retention';
import { BatchWriter } from '../../src/storage/batch-writer';
import type { StoredChunk } from '../../src/types/chunk';
import type { StoredIncident } from '../../src/types/incident';
import type { TimelineEvent } from '../../src/types';

describe('Prioridade 4 — Comportamento de Quota e Retenção', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
  });

  afterEach(async () => {
    db.close();
  });

  describe('emergencyPrune()', () => {
    it('remove todos os chunks desprotegidos e preserva chunks protegidos por incidentes', async () => {
      const retention = new RetentionEngine(db, {
        bufferMinutes: 60,
        maxStorageMb: 50
      });

      const chunk1: StoredChunk = {
        id: 'chunk_unprotected_1',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 1,
        startedAt: 1000,
        endedAt: 2000,
        sizeBytes: 1024,
        replay: [],
        timeline: []
      };

      const chunk2: StoredChunk = {
        id: 'chunk_protected_1',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 2,
        startedAt: 2000,
        endedAt: 3000,
        sizeBytes: 2048,
        replay: [],
        timeline: []
      };

      const chunk3: StoredChunk = {
        id: 'chunk_unprotected_2',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 3,
        startedAt: 3000,
        endedAt: 4000,
        sizeBytes: 1024,
        replay: [],
        timeline: []
      };

      await db.putChunk(chunk1);
      await db.putChunk(chunk2);
      await db.putChunk(chunk3);

      const incident: StoredIncident = {
        id: 'inc_1',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        reason: 'error',
        triggers: [],
        startedAt: 2000,
        triggeredAt: 2500,
        finalizeAt: 5000,
        state: 'finalized',
        chunkIds: ['chunk_protected_1']
      };
      await db.putIncident(incident);

      const result = await retention.emergencyPrune();
      expect(result.deletedChunkIds).toContain('chunk_unprotected_1');
      expect(result.deletedChunkIds).toContain('chunk_unprotected_2');
      expect(result.deletedChunkIds).not.toContain('chunk_protected_1');

      const remaining = await db.getAllChunks();
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('chunk_protected_1');
    });
  });

  describe('Cálculo de tamanho em bytes UTF-8', () => {
    it('calcula sizeBytes usando UTF-8 byte length com caracteres multi-byte', async () => {
      const writer = new BatchWriter(db, 'sess_1', 'tab_1', {
        flushIntervalMs: 50,
        maxBatchEvents: 100,
        chunkDurationMs: 60000
      });

      const multiByteString = 'Ação de teste com caracteres acentuados e símbolos unicode: © ® € µ å ö ñ ç';
      const event: TimelineEvent = {
        id: 'evt_1',
        sequence: 1,
        timestamp: Date.now(),
        type: 'marker',
        label: multiByteString
      };

      writer.addTimelineEvent(event);
      await writer.flush();

      const chunks = await db.getAllChunks();
      expect(chunks.length).toBe(1);

      const expectedByteLength = new TextEncoder().encode(JSON.stringify(chunks[0].timeline)).byteLength;
      expect(chunks[0].sizeBytes).toBe(expectedByteLength);
      // UTF-8 byte length deve ser estritamente maior que o número de caracteres devido a acentos e emojis
      expect(chunks[0].sizeBytes).toBeGreaterThan(JSON.stringify(chunks[0].timeline).length);

      writer.destroy();
    });
  });

  describe('Retenção pós-escrita e QuotaExceededError no FlightRecorder', () => {
    it('executa retenção após escrita que excede maxStorageMb', async () => {
      const recorder = new FlightRecorderImpl(
        {
          bufferMinutes: 60,
          maxStorageMb: 0.001 // ~1048 bytes
        },
        db
      );

      await recorder.start();
      const writer = (recorder as unknown as { writer: BatchWriter }).writer;

      // Escreve primeiro chunk grande
      const now = Date.now();
      const largeMessage = 'X'.repeat(800);
      writer.addTimelineEvent({
        id: 'e1',
        sequence: 1,
        timestamp: now - 2000,
        type: 'marker',
        label: largeMessage
      });
      await recorder.flush();

      let chunks = await db.getAllChunks();
      expect(chunks.length).toBe(1);

      // Escreve segundo chunk grande que excede a quota configurada (~1 KB)
      writer.addTimelineEvent({
        id: 'e2',
        sequence: 2,
        timestamp: now - 1000,
        type: 'marker',
        label: largeMessage
      });
      await recorder.flush();

      await (recorder as unknown as { scheduleRetention: () => Promise<void> }).scheduleRetention();

      chunks = await db.getAllChunks();
      expect(chunks.length).toBe(1);
      expect(chunks[0].timeline.some(t => t.id === 'e2')).toBe(true);

      await recorder.stop();
    });

    it('NUNCA poda chunks protegidos mesmo que excedam maxStorageMb', async () => {
      const recorder = new FlightRecorderImpl(
        {
          bufferMinutes: 60,
          maxStorageMb: 0.0005 // ~524 bytes, muito baixo
        },
        db
      );

      await recorder.start();
      const writer = (recorder as unknown as { writer: BatchWriter }).writer;

      const now = Date.now();
      writer.addTimelineEvent({
        id: 'e1',
        sequence: 1,
        timestamp: now - 2000,
        type: 'marker',
        label: 'Dados do incidente'
      });
      await recorder.flush();

      const incidentId = await recorder.capture('teste_quota');
      expect(incidentId).toBeDefined();

      // Agora adiciona novos chunks desprotegidos
      writer.addTimelineEvent({
        id: 'e2',
        sequence: 2,
        timestamp: now - 1000,
        type: 'marker',
        label: 'Dados normais adicionais que estouram a quota'
      });
      await recorder.flush();

      await (recorder as unknown as { scheduleRetention: () => Promise<void> }).scheduleRetention();

      const inc = await db.getIncident(incidentId);
      expect(inc).toBeDefined();
      const protectedIds = inc!.chunkIds;

      const remainingChunks = await db.getAllChunks();
      for (const pId of protectedIds) {
        expect(remainingChunks.some((c) => c.id === pId)).toBe(true);
      }

      await recorder.stop();
    });

    it('não executa múltiplos prunes simultâneos (idempotência de concorrência)', async () => {
      const recorder = new FlightRecorderImpl(
        {
          bufferMinutes: 60,
          maxStorageMb: 50
        },
        db
      );
      await recorder.start();

      const retention = (recorder as unknown as { retention: RetentionEngine }).retention;
      const pruneSpy = vi.spyOn(retention, 'prune');

      // Dispara chamadas simultâneas de scheduleRetention
      const p1 = (recorder as unknown as { scheduleRetention: () => Promise<void> }).scheduleRetention();
      const p2 = (recorder as unknown as { scheduleRetention: () => Promise<void> }).scheduleRetention();
      const p3 = (recorder as unknown as { scheduleRetention: () => Promise<void> }).scheduleRetention();

      await Promise.all([p1, p2, p3]);

      // Deve ter chamado prune apenas uma vez durante a concorrência
      expect(pruneSpy).toHaveBeenCalledTimes(1);

      await recorder.stop();
    });

    it('ao receber QuotaExceededError, degrada o recorder, executa emergencyPrune e não entra em loop', async () => {
      const recorder = new FlightRecorderImpl(
        {
          bufferMinutes: 60,
          maxStorageMb: 50
        },
        db
      );
      await recorder.start();

      // Insere um chunk protegido e um desprotegido
      const chunkProt: StoredChunk = {
        id: 'chunk_prot',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 1,
        startedAt: 1000,
        endedAt: 2000,
        sizeBytes: 1000,
        replay: [],
        timeline: []
      };
      const chunkUnprot: StoredChunk = {
        id: 'chunk_unprot',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 2,
        startedAt: 2000,
        endedAt: 3000,
        sizeBytes: 1000,
        replay: [],
        timeline: []
      };
      await db.putChunk(chunkProt);
      await db.putChunk(chunkUnprot);

      const incident: StoredIncident = {
        id: 'inc_1',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        reason: 'error',
        triggers: [],
        startedAt: 1000,
        triggeredAt: 1500,
        finalizeAt: 3000,
        state: 'finalized',
        chunkIds: ['chunk_prot']
      };
      await db.putIncident(incident);

      // Simula QuotaExceededError
      const quotaErr = new DOMException('QuotaExceededError: The quota has been exceeded.', 'QuotaExceededError');
      await (recorder as unknown as { handleQuotaExceeded: (err: unknown) => Promise<void> }).handleQuotaExceeded(quotaErr);

      const health = recorder.getHealth();
      expect(health.state).toBe('degraded');
      expect(health.reasons.some((r) => r.toLowerCase().includes('quota'))).toBe(true);

      // O chunk desprotegido foi removido pelo emergencyPrune, mas o protegido permanece
      const remainingChunks = await db.getAllChunks();
      expect(remainingChunks.some((c) => c.id === 'chunk_prot')).toBe(true);
      expect(remainingChunks.some((c) => c.id === 'chunk_unprot')).toBe(false);

      await recorder.stop();
    });

    it('exclusão de incidente libera chunks protegidos e permite recuperação do estado', async () => {
      const recorder = new FlightRecorderImpl(
        {
          bufferMinutes: 60,
          maxStorageMb: 0.0001 // Limite muito baixo (~100 bytes)
        },
        db
      );
      await recorder.start();

      const chunk: StoredChunk = {
        id: 'chunk_to_free',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        sequence: 1,
        startedAt: 1000,
        endedAt: 2000,
        sizeBytes: 1000,
        replay: [],
        timeline: []
      };
      await db.putChunk(chunk);

      const incident: StoredIncident = {
        id: 'inc_to_delete',
        sessionId: 'sess_1',
        tabId: 'tab_1',
        reason: 'error',
        triggers: [],
        startedAt: 1000,
        triggeredAt: 1500,
        finalizeAt: 3000,
        state: 'finalized',
        chunkIds: ['chunk_to_free']
      };
      await db.putIncident(incident);

      // Simula QuotaExceededError com excesso de incidentes protegidos
      const quotaErr = new DOMException('QuotaExceededError', 'QuotaExceededError');
      await (recorder as unknown as { handleQuotaExceeded: (err: unknown) => Promise<void> }).handleQuotaExceeded(quotaErr);

      expect(recorder.getHealth().state).toBe('degraded');

      // Ao excluir o incidente, o chunk se torna desprotegido e o prune automático o remove
      await recorder.deleteIncident('inc_to_delete');

      const remainingChunks = await db.getAllChunks();
      expect(remainingChunks.length).toBe(0);

      // O recorder agora recupera o estado já que storage <= limit
      expect(recorder.getHealth().state).toBe('recording');

      await recorder.stop();
    });
  });
});
