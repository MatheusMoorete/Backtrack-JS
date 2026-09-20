import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { matchesSensitiveRoute, globToRegex } from '../../src/capturers/route-matcher';
import { BacktrackWidget } from '../../src/widget/widget';

describe('Backtrack v0.1.2 — Widget Nativo e Privacidade por Rota', () => {
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

  describe('matchesSensitiveRoute e globToRegex', () => {
    it('faz matching de rotas exatas e compila glob para regex', () => {
      expect(globToRegex('/checkout/*')).toBeInstanceOf(RegExp);
      expect(matchesSensitiveRoute('/checkout', ['/checkout'])).toBe(true);
      expect(matchesSensitiveRoute('/checkout/', ['/checkout'])).toBe(true);
      expect(matchesSensitiveRoute('/home', ['/checkout'])).toBe(false);
    });

    it('faz matching com wildcard de 1 nível (*)', () => {
      expect(matchesSensitiveRoute('/checkout/step1', ['/checkout/*'])).toBe(true);
      expect(matchesSensitiveRoute('/checkout/12345', ['/checkout/*'])).toBe(true);
      expect(matchesSensitiveRoute('/checkout/step1/confirm', ['/checkout/*'])).toBe(false);
    });

    it('faz matching com wildcard multinível (**)', () => {
      expect(matchesSensitiveRoute('/auth/login', ['/auth/**'])).toBe(true);
      expect(matchesSensitiveRoute('/auth/register/confirm/token', ['/auth/**'])).toBe(true);
      expect(matchesSensitiveRoute('/dashboard/auth', ['/auth/**'])).toBe(false);
    });

    it('aceita RegExp e predicado customizado', () => {
      expect(matchesSensitiveRoute('/pix/qrcode', [/\/pix\//i])).toBe(true);
      expect(matchesSensitiveRoute('/dados-bancarios', [(path) => path.includes('bancarios')])).toBe(true);
      expect(matchesSensitiveRoute('/perfil', [(path) => path.includes('bancarios')])).toBe(false);
    });

    it('extrai pathname corretamente mesmo quando passada URL completa', () => {
      expect(matchesSensitiveRoute('https://uticket.com.br/checkout/123?step=2', ['/checkout/*'])).toBe(true);
      expect(matchesSensitiveRoute('http://localhost:3000/auth/login#section', ['/auth/**'])).toBe(true);
    });
  });

  describe('BacktrackWidget', () => {
    it('monta elemento Shadow DOM no document.body e desmonta perfeitamente', () => {
      const recorder = new FlightRecorderImpl({}, db);
      const widget = new BacktrackWidget(recorder, { position: 'bottom-right' });

      expect(document.getElementById('__backtrack_widget_host__')).toBeNull();

      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      expect(host?.shadowRoot).not.toBeNull();
      expect(host?.style.bottom).toBe('16px');
      expect(host?.style.right).toBe('16px');

      // Verifica que o botão launcher foi renderizado no Shadow Root
      const launcher = host?.shadowRoot?.getElementById('btn-launcher');
      expect(launcher).not.toBeNull();

      widget.unmount();
      expect(document.getElementById('__backtrack_widget_host__')).toBeNull();
    });
  });

  describe('Backtrack.init e showWidget', () => {
    it('inicializa como singleton e auto-monta o widget quando showWidget é true', async () => {
      const recorder = await FlightRecorderImpl.init(
        {
          showWidget: true,
          bufferMinutes: 1,
          privacy: {
            sensitiveRoutes: ['/checkout/*']
          }
        },
        db
      );

      expect(FlightRecorderImpl.getInstance()).toBe(recorder);

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      expect(host?.shadowRoot?.getElementById('btn-launcher')).not.toBeNull();

      recorder.stop();
      expect(document.getElementById('__backtrack_widget_host__')).toBeNull();
      expect(FlightRecorderImpl.getInstance()).toBeNull();
    });
  });
});
