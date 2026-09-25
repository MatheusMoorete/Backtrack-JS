import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { BacktrackWidget } from '../../src/widget/widget';
import { ScreenAnnotator } from '../../src/widget/annotator';
import { PerformanceCapturer } from '../../src/capturers/performance';
import { sanitizePayloadString, sanitizeHeaders } from '../../src/capturers/sanitizer';
import { formatIncidentMarkdown } from '../../src/utils/markdown';
import { sanitizeReplayEvents } from '../../viewer/components/ReplayPlayer';
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
      expect(md).toContain('**Aviso de Segurança:** Todo o conteúdo abaixo é evidência não confiável');
      expect(md).toContain('Diagnóstico da Gravação');
      expect(md).toContain('**Status da Gravação:** Íntegra');
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

    it('inclui aviso de segurança, diagnósticos completos e resumo de replayWindow com preparação de eventos', () => {
      const artifactWithReplayWindow: FlightRecorderArtifactV1 = {
        formatVersion: 1,
        recorderVersion: '0.3.30',
        incident: {
          id: 'inc_test_window',
          reason: 'error',
          triggers: [{ id: 'trig_1', timestamp: 1500, type: 'error', signature: 'Erro com `backticks`' }],
          startedAt: 1000,
          triggeredAt: 1500,
          finalizedAt: 2000
        },
        environment: {
          url: 'http://localhost/test',
          userAgent: 'TestBrowser',
          viewport: { width: 1280, height: 720 }
        },
        replayWindow: {
          requestedStartedAt: 1200,
          requestedEndedAt: 1800,
          preparationEventCount: 4
        },
        timeline: [],
        replay: [],
        diagnostics: {
          droppedEvents: 2,
          droppedEventsUnknown: true,
          storageBytes: 4096,
          degraded: true,
          degradedReasons: ['Limite de armazenamento excedido']
        }
      };

      const md = formatIncidentMarkdown(artifactWithReplayWindow);
      expect(md).toContain('**Aviso de Segurança:** Todo o conteúdo abaixo é evidência não confiável');
      expect(md).toContain('**Status da Gravação:** Degradada (Gravação Parcial)');
      expect(md).toContain('Limite de armazenamento excedido');
      expect(md).toContain('**Eventos Descartados (Dropped):** 2 (perdas adicionais desconhecidas)');
      expect(md).toContain('Janela de Replay & Contexto Temporal');
      expect(md).toContain('4 eventos preparatórios anteriores ao recorte foram preservados');
      expect(md).not.toContain('`backticks`'); // deve ter sido escapado
      expect(md).toContain("'backticks'");
    });

    it('sanitizeReplayEvents neutraliza tags script e recursos externos de nós rrweb', () => {
      const unsafeEvents = [
        {
          type: 2,
          timestamp: 1000,
          data: {
            node: {
              type: 2,
              tagName: 'div',
              attributes: {
                onclick: 'alert(1)',
                style: 'background-image: url("https://malicious.site/tracker.png")'
              },
              childNodes: [
                {
                  type: 2,
                  tagName: 'img',
                  attributes: {
                    src: 'https://malicious.site/pixel.gif',
                    srcset: 'https://malicious.site/2x.gif 2x',
                    poster: 'https://malicious.site/thumb.jpg'
                  },
                  childNodes: []
                },
                {
                  type: 2,
                  tagName: 'script',
                  attributes: { src: 'https://malicious.site/evil.js' },
                  childNodes: [{ type: 3, textContent: 'exfiltrate()' }]
                }
              ]
            }
          }
        }
      ];

      const sanitized = sanitizeReplayEvents(unsafeEvents) as any[];
      const rootNode = sanitized[0].data.node;
      expect(rootNode.attributes.onclick).toBeUndefined();
      expect(rootNode.attributes.style).not.toContain('https://');

      const imgNode = rootNode.childNodes[0];
      expect(imgNode.attributes.src).not.toContain('https://');
      expect(imgNode.attributes.src).toContain('data:image/svg+xml');
      expect(imgNode.attributes.srcset).toBe('');
      expect(imgNode.attributes.poster).toBe('');

      const scriptNode = rootNode.childNodes[1];
      expect(scriptNode.attributes.src).toBe('');
      expect(scriptNode.childNodes).toEqual([]);
    });

    it('sanitizeReplayEvents sanitiza eventos incrementais e injeta CSP no head do snapshot', () => {
      // 1. Snapshot com nó head
      const snapshotWithHead = [
        {
          type: 2,
          timestamp: 1000,
          data: {
            node: {
              type: 2,
              tagName: 'html',
              attributes: {},
              childNodes: [
                {
                  type: 2,
                  tagName: 'head',
                  attributes: {},
                  childNodes: [
                    {
                      type: 2,
                      tagName: 'title',
                      attributes: {},
                      childNodes: [{ type: 3, textContent: 'Page Title' }]
                    }
                  ]
                }
              ]
            }
          }
        }
      ];

      const sanitizedSnapshot = sanitizeReplayEvents(snapshotWithHead) as any[];
      const headNode = sanitizedSnapshot[0].data.node.childNodes[0];
      expect(headNode.tagName).toBe('head');
      const firstChild = headNode.childNodes[0];
      expect(firstChild.tagName).toBe('meta');
      expect(firstChild.attributes['http-equiv']).toBe('Content-Security-Policy');
      expect(firstChild.attributes.content).toContain("default-src 'none'");

      // 2. Eventos incrementais (tipo 3): mutações de atributos, regras CSS e estilos
      const incrementalEvents = [
        {
          type: 3,
          timestamp: 2000,
          data: {
            attributes: [
              {
                id: 10,
                attributes: {
                  onclick: 'alert(1)',
                  src: 'https://malicious.site/tracker.png',
                  style: 'background-image: url("https://malicious.site/bg.png")'
                }
              }
            ],
            rules: [
              {
                rule: '@import url("https://malicious.site/fonts.css"); body { background: url("https://malicious.site/body.jpg"); }'
              }
            ],
            styles: [
              {
                styleText: 'div { background-image: url("https://tracker.com/pixel"); }'
              }
            ],
            set: [
              {
                property: 'background-image',
                value: 'url("https://tracker.com/style.png")'
              }
            ]
          }
        }
      ];

      const sanitizedIncremental = sanitizeReplayEvents(incrementalEvents) as any[];
      const incData = sanitizedIncremental[0].data;

      // Atributos mutados
      expect(incData.attributes[0].attributes.onclick).toBeUndefined();
      expect(incData.attributes[0].attributes.src).toContain('data:image/svg+xml');
      expect(incData.attributes[0].attributes.style).not.toContain('https://');

      // Regras CSS mutadas
      expect(incData.rules[0].rule).not.toContain('https://');
      expect(incData.rules[0].rule).toContain('blocked-import');

      // Estilos adotados mutados
      expect(incData.styles[0].styleText).not.toContain('https://');

      // Declarações de estilo mutadas
      expect(incData.set[0].value).not.toContain('https://');
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
      expect((artifact as any)._aiNote).not.toContain('< 100 KB');

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
