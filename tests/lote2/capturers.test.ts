import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { BatchWriter } from '../../src/storage/batch-writer';
import { IncidentManager } from '../../src/storage/incident-manager';

import { ConsoleCapturer } from '../../src/capturers/console';
import { ErrorCapturer } from '../../src/capturers/errors';
import { NetworkCapturer } from '../../src/capturers/network';
import { NavigationCapturer } from '../../src/capturers/navigation';

describe('Lote 2 — Capturadores Individuais', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;
  let writer: BatchWriter;
  let incidentMgr: IncidentManager;
  let seq = 0;
  const nextSeq = () => ++seq;

  beforeEach(() => {
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
    writer = new BatchWriter(db, 'sess_cap', 'tab_cap', { maxBatchEvents: 1 });
    incidentMgr = new IncidentManager(db, 'sess_cap', 'tab_cap', {
      url: 'http://localhost:3000/app',
      userAgent: 'Test/1.0',
      viewport: { width: 1024, height: 768 }
    });
  });

  afterEach(() => {
    writer.destroy();
    incidentMgr.destroy();
    db.close();
  });

  it('ConsoleCapturer intercepta logs, chama original e redige dados sensíveis', async () => {
    const originalLog = console.log;
    const capturer = new ConsoleCapturer(writer, nextSeq);

    capturer.start();

    // Invoca console com dado sensível
    console.log('Mensagem de log', { senha: '123456SecretPassword' });

    await writer.flush();

    const chunks = await db.getChunksBySession('sess_cap');
    expect(chunks.length).toBeGreaterThan(0);
    const lastChunk = chunks[chunks.length - 1];
    const logEvt = lastChunk.timeline.find((e) => e.type === 'console');

    expect(logEvt).toBeDefined();
    if (logEvt && logEvt.type === 'console') {
      expect(logEvt.level).toBe('log');
      const arg1 = logEvt.args[1] as Record<string, unknown>;
      expect(arg1.senha).toBe('[REDACTED]');
    }

    capturer.stop();
    // Verifica restauração segura do método original
    expect(console.log).toBe(originalLog);
  });

  it('ErrorCapturer captura exceções explícitas (ex: React) com componentStack', async () => {
    const capturer = new ErrorCapturer(writer, incidentMgr, nextSeq);
    capturer.start();

    const error = new Error('Falha de renderização no componente EventTickets');
    capturer.captureException(error, {
      source: 'react',
      componentStack: '\n    at EventTickets\n    at SentryBoundary\n    at App'
    });

    await writer.flush();

    const chunks = await db.getChunksBySession('sess_cap');
    const errEvt = chunks[0]?.timeline.find((e) => e.type === 'error');

    expect(errEvt).toBeDefined();
    if (errEvt && errEvt.type === 'error') {
      expect(errEvt.source).toBe('react');
      expect(errEvt.name).toBe('Error');
      expect(errEvt.componentStack).toContain('EventTickets');
    }

    // Verifica se gerou incidente automático
    const incidents = await db.getAllIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].reason).toBe('react');

    capturer.stop();
  });

  it('NetworkCapturer intercepta fetch sem ler bodies e registra status e duração', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ secretPayload: 'do-not-read' }), {
        status: 200,
        statusText: 'OK'
      })
    );
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch;

    const capturer = new NetworkCapturer(writer, incidentMgr, nextSeq);
    capturer.start();

    const res = await window.fetch('https://api.uticket.com.br/events/123456?token=secretToken');
    expect(res.status).toBe(200);

    await writer.flush();

    const chunks = await db.getChunksBySession('sess_cap');
    const netEvt = chunks[0]?.timeline.find((e) => e.type === 'network');

    expect(netEvt).toBeDefined();
    if (netEvt && netEvt.type === 'network') {
      expect(netEvt.method).toBe('GET');
      expect(netEvt.url).toBe('https://api.uticket.com.br/events/:id?token');
      expect(netEvt.status).toBe(200);
      expect(netEvt.result).toBe('success');
      expect(netEvt.durationMs).toBeGreaterThanOrEqual(0);
    }

    capturer.stop();
  });

  it('NetworkCapturer dispara incidente automático em HTTP 500+', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' })
    );
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch;

    const capturer = new NetworkCapturer(writer, incidentMgr, nextSeq, {
      captureHttpStatus: [500]
    });
    capturer.start();

    await window.fetch('https://api.uticket.com.br/checkout/pay');
    await writer.flush();

    const incidents = await db.getAllIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].reason).toBe('http');

    capturer.stop();
  });

  it('NetworkCapturer captura erro de rede/CORS (status 0 e result error) e dispara incidente', async () => {
    const originalFetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    (window as unknown as { fetch: typeof fetch }).fetch = originalFetch;

    const capturer = new NetworkCapturer(writer, incidentMgr, nextSeq);
    capturer.start();

    await expect(window.fetch('https://api.external.com/cors-endpoint')).rejects.toThrow('Failed to fetch');
    await writer.flush();

    const chunks = await db.getChunksBySession('sess_cap');
    const netEvt = chunks[0]?.timeline.find((e) => e.type === 'network' && (e as { url: string }).url.includes('cors-endpoint'));

    expect(netEvt).toBeDefined();
    if (netEvt && netEvt.type === 'network') {
      expect(netEvt.status).toBe(0);
      expect(netEvt.result).toBe('error');
    }

    const incidents = await db.getAllIncidents();
    expect(incidents.length).toBe(1);
    expect(incidents[0].reason).toBe('http');

    capturer.stop();
  });

  it('NavigationCapturer intercepta pushState e replaceState com URLs higienizadas', async () => {
    const capturer = new NavigationCapturer(writer, nextSeq);
    capturer.start();

    window.history.pushState({}, '', '/checkout/step2?auth=secretValue');
    await writer.flush();

    const chunks = await db.getChunksBySession('sess_cap');
    const navEvt = chunks[0]?.timeline.find(
      (e) => e.type === 'navigation' && (e as { kind: string }).kind === 'pushState'
    );

    expect(navEvt).toBeDefined();
    if (navEvt && navEvt.type === 'navigation') {
      expect(navEvt.kind).toBe('pushState');
      expect(navEvt.toUrl).toContain('/checkout/step2?auth');
      expect(navEvt.toUrl).not.toContain('secretValue');
    }

    capturer.stop();
  });
});
