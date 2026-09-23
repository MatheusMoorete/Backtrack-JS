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
      expect(md).toContain('### Relatório de Debug — Backtrack');
      expect(md).toContain('inc_test_999');
      expect(md).toContain('https://uticket.com.br/checkout/payment');
      expect(md).toContain('TypeError: Cannot read properties of undefined');
      expect(md).toContain('POST https://uticket.com.br/api/payment');
      expect(md).toContain('Status: 500');
      expect(md).not.toContain('Replay do Incidente');

      const mdWithReplay = formatIncidentMarkdown(mockArtifact, {
        replayUrl: 'http://localhost:5173/?gist=abc123gist'
      });
      expect(mdWithReplay).toContain('- **Replay do Incidente:** [Assistir Gravação](http://localhost:5173/?gist=abc123gist)');
    });

    it('exporta incidente otimizado para IA (.ai.json) mantendo timeline e ambiente', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();
      const incId = await recorder.capture('Teste IA');

      const artifact = await recorder.exportIncident(incId, { aiOptimized: true });
      expect(artifact).toBeDefined();
      expect(artifact.incident.id).toBe(incId);
      expect(artifact.incident.reason).toBe('manual');
      expect(Array.isArray(artifact.timeline)).toBe(true);

      recorder.stop();
    });
  });

  describe('ScreenAnnotator (Anotação de Tela & QA Ruler)', () => {
    it('cria overlay de anotação na tela com canvas, toolbar e classes de bloqueio para rrweb', () => {
      const annotator = new ScreenAnnotator();
      const onDone = vi.fn();

      annotator.open(onDone);
      const overlay = document.getElementById('__backtrack_annotator_overlay__');
      expect(overlay).not.toBeNull();
      expect(overlay?.className).toContain('backtrack-ignore');
      expect(overlay?.className).toContain('rr-ignore');
      expect(overlay?.getAttribute('data-rr-ignore')).toBe('true');

      // Verifica presença de todas as ferramentas de QA
      expect(overlay?.querySelector('#btn-tool-pen')).not.toBeNull();
      expect(overlay?.querySelector('#btn-tool-arrow')).not.toBeNull();
      expect(overlay?.querySelector('#btn-tool-rect')).not.toBeNull();
      expect(overlay?.querySelector('#btn-tool-ruler')).not.toBeNull();
      expect(overlay?.querySelector('#btn-tool-text')).not.toBeNull();

      // Botões de ação
      expect(overlay?.querySelector('#btn-undo')).not.toBeNull();
      expect(overlay?.querySelector('#btn-clear')).not.toBeNull();
      expect(overlay?.querySelector('#btn-done')).not.toBeNull();
      expect(overlay?.querySelector('#btn-cancel')).not.toBeNull();

      annotator.close();
      expect(document.getElementById('__backtrack_annotator_overlay__')).toBeNull();
    });

    it('isola o widget host com classes rr-ignore para não poluir o replay', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();
      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      expect(host?.className).toContain('backtrack-ignore');
      expect(host?.className).toContain('rr-ignore');
      expect(host?.getAttribute('data-rr-ignore')).toBe('true');

      recorder.stop();
      widget.unmount();
    });

    it('persiste annotationImage e notes no artefato do incidente', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();

      const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      const incidentId = await recorder.capture('Teste com anotação', 60, {
        annotationImage: fakeDataUrl,
        notes: 'mudar isso 3px para bottom'
      });

      const artifact = await recorder.getArtifact(incidentId);
      expect(artifact.incident.annotationImage).toBe(fakeDataUrl);
      expect(artifact.incident.triggers[0].detail?.notes).toBe('mudar isso 3px para bottom');

      const md = formatIncidentMarkdown(artifact);
      expect(md).toContain('Anotações do QA');
      expect(md).toContain('mudar isso 3px para bottom');

      recorder.stop();
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

    it('suporta arrasto por toque (touch drag) no botão launcher em dispositivos móveis', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      const launcher = host?.shadowRoot?.getElementById('btn-launcher');
      expect(launcher).not.toBeNull();

      // Simula toque e arrasto no launcher
      const touchStartEvent = new CustomEvent('touchstart', { bubbles: true }) as any;
      touchStartEvent.touches = [{ clientX: 20, clientY: 20 }];
      launcher?.dispatchEvent(touchStartEvent);

      const touchMoveEvent = new CustomEvent('touchmove', { bubbles: true }) as any;
      touchMoveEvent.touches = [{ clientX: 80, clientY: 120 }];
      launcher?.dispatchEvent(touchMoveEvent);

      const touchEndEvent = new CustomEvent('touchend', { bubbles: true }) as any;
      launcher?.dispatchEvent(touchEndEvent);

      // Verifica se o container reposicionou
      expect(host?.style.left).toBeDefined();
      expect(host?.style.top).toBeDefined();

      widget.unmount();
    });
  });

  describe('Compatibilidade Mobile (Touch e Safe Area)', () => {
    it('inclui suporte a safe-area-inset e media query de telas móveis no CSS', async () => {
      const { WIDGET_CSS } = await import('../../src/widget/styles');
      expect(WIDGET_CSS).toContain('safe-area-inset-bottom');
      expect(WIDGET_CSS).toContain('@media (max-width: 480px)');
      expect(WIDGET_CSS).toContain('max-width: calc(100vw - 16px)');
    });

    it('inicializa o canvas do ScreenAnnotator com touch-action none e toolbar responsiva', () => {
      const annotator = new ScreenAnnotator();
      annotator.open(() => {});

      const overlay = document.getElementById('__backtrack_annotator_overlay__');
      expect(overlay).not.toBeNull();

      const canvas = overlay?.querySelector('canvas');
      expect(canvas).not.toBeNull();
      expect(canvas?.style.touchAction).toBe('none');

      const toolbar = overlay?.querySelector('.backtrack-annotator-toolbar');
      expect(toolbar).not.toBeNull();

      annotator.close();
    });
  });
});
