import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { BacktrackWidget } from '../../src/widget/widget';
import { ScreenAnnotator } from '../../src/widget/annotator';
import { PerformanceCapturer } from '../../src/capturers/performance';
import { sanitizePayloadString, sanitizeHeaders } from '../../src/capturers/sanitizer';
import { formatIncidentMarkdown } from '../../src/utils/markdown';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

describe('Backtrack v0.2.0 — Novas Features', () => {
  let idb: IDBFactory;
  let db: FlightRecorderDB;

  beforeEach(() => {
    FlightRecorderImpl.resetInstance();
    idb = new IDBFactory();
    db = new FlightRecorderDB(idb);
    document.body.innerHTML = '';
  });

  afterEach(() => {
    FlightRecorderImpl.resetInstance();
    db.close();
    document.body.innerHTML = '';
  });

  describe('Sanitização de Payloads e Headers de Rede', () => {
    it('redige senhas, tokens e CPFs dentro de payloads JSON', () => {
      const payload = JSON.stringify({
        email: 'dev@uticket.com.br',
        password: 'SuperSecretPassword123',
        token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThis',
        cpf: '123.456.789-00',
        cartao: '4111 2222 3333 4444'
      });

      const sanitized = sanitizePayloadString(payload);
      expect(sanitized).not.toContain('SuperSecretPassword123');
      expect(sanitized).not.toContain('doNotLeakThis');
      expect(sanitized).toContain('[REDACTED');
    });

    it('trunca payloads que excedem o tamanho máximo permitido', () => {
      const largePayload = 'A'.repeat(1000);
      const truncated = sanitizePayloadString(largePayload, 100);
      expect(truncated.length).toBeLessThan(200);
      expect(truncated).toContain('[TRUNCATED');
    });

    it('redige headers sensíveis (Authorization, Cookie, Secret)', () => {
      const headers = {
        'Content-Type': 'application/json',
        Authorization: 'Bearer my-secret-token',
        Cookie: 'session_id=123456; secure',
        'X-API-Key': 'key_live_99999'
      };

      const sanitized = sanitizeHeaders(headers);
      expect(sanitized).toBeDefined();
      expect(sanitized?.['Authorization']).toBe('[REDACTED]');
      expect(sanitized?.['Cookie']).toBe('[REDACTED]');
      expect(sanitized?.['X-API-Key']).toBe('[REDACTED]');
      expect(sanitized?.['Content-Type']).toBe('application/json');
    });
  });

  describe('Gerador de Markdown para Jira/GitHub', () => {
    it('formata o incidente com URL, erros e falhas de rede em template limpo', () => {
      const mockArtifact: FlightRecorderArtifactV1 = {
        formatVersion: 1,
        recorderVersion: '0.2.0',
        incident: {
          id: 'inc_test_999',
          reason: 'manual',
          triggers: [],
          startedAt: 1000,
          triggeredAt: 2000,
          finalizedAt: 2000
        },
        environment: {
          url: 'https://uticket.com.br/checkout/payment',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          viewport: { width: 1920, height: 1080 },
          appVersion: '1.2.0',
          gitCommit: 'a1b2c3d'
        },
        timeline: [
          {
            id: 'err_1',
            timestamp: 1500,
            sequence: 1,
            type: 'error',
            name: 'TypeError',
            message: 'Cannot read properties of undefined',
            source: 'window'
          },
          {
            id: 'net_1',
            timestamp: 1600,
            sequence: 2,
            type: 'network',
            method: 'POST',
            url: 'https://uticket.com.br/api/payment',
            status: 500,
            durationMs: 350,
            result: 'error'
          }
        ],
        replay: [],
        diagnostics: { droppedEvents: 0, storageBytes: 2048, degraded: false, degradedReasons: [] }
      };

      const md = formatIncidentMarkdown(mockArtifact);
      expect(md).toContain('### 🚨 Relatório de Incidente — Backtrack');
      expect(md).toContain('inc_test_999');
      expect(md).toContain('https://uticket.com.br/checkout/payment');
      expect(md).toContain('TypeError: Cannot read properties of undefined');
      expect(md).toContain('POST https://uticket.com.br/api/payment');
      expect(md).toContain('Status: 500');
    });
  });

  describe('ScreenAnnotator (Anotação de Tela)', () => {
    it('cria overlay de anotação na tela com canvas e toolbar, e remove ao fechar', () => {
      const annotator = new ScreenAnnotator();
      const onDone = vi.fn();

      annotator.open(onDone);
      const overlay = document.getElementById('__backtrack_annotator_overlay__');
      expect(overlay).not.toBeNull();

      annotator.close();
      expect(document.getElementById('__backtrack_annotator_overlay__')).toBeNull();
    });
  });

  describe('PerformanceCapturer (Long Tasks)', () => {
    it('inicia e pára com segurança sem falhar em ambiente de teste', () => {
      const writerMock = { addTimelineEvent: vi.fn() } as any;
      const perfCapturer = new PerformanceCapturer(writerMock, () => 1);

      expect(() => perfCapturer.start()).not.toThrow();
      expect(() => perfCapturer.stop()).not.toThrow();
    });
  });

  describe('Widget Nativo v0.2.0', () => {
    it('renderiza os botões de Anotar, Download e Copiar Markdown', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();

      const widget = new BacktrackWidget(recorder, { position: 'bottom-right' });
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      const shadow = host?.shadowRoot;

      // Abre o drawer
      const launcher = shadow?.getElementById('btn-launcher');
      launcher?.click();

      // Botão de Anotar
      const btnAnnotate = shadow?.getElementById('btn-annotate');
      expect(btnAnnotate).not.toBeNull();
      expect(btnAnnotate?.textContent).toContain('Anotar');

      recorder.stop();
      widget.unmount();
    });
  });
});
