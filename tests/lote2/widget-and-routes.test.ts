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

      // Abre o painel
      launcher?.click();

      // Botão Salvar (sem ícone SVG, texto Salvar)
      const saveBtn = host?.shadowRoot?.getElementById('btn-save');
      expect(saveBtn).not.toBeNull();
      expect(saveBtn?.textContent?.trim()).toBe('Salvar');
      expect(saveBtn?.querySelector('svg')).toBeNull();

      // Botão Anotar (sem emoji de lápis, texto Anotar)
      const annotateBtn = host?.shadowRoot?.getElementById('btn-annotate');
      expect(annotateBtn).not.toBeNull();
      expect(annotateBtn?.textContent?.trim()).toBe('Anotar');

      widget.unmount();
      expect(document.getElementById('__backtrack_widget_host__')).toBeNull();
    });

    it('renderiza card de incidente com botão Visualizar e menu de 3 pontos para opções secundárias', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();
      await recorder.capture('Teste incidente');

      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      const launcher = host?.shadowRoot?.getElementById('btn-launcher');
      launcher?.click();

      // Aguarda atualização dos incidentes
      await new Promise((resolve) => setTimeout(resolve, 50));

      const viewBtn = host?.shadowRoot?.querySelector('.backtrack-btn-view');
      expect(viewBtn).not.toBeNull();
      expect(viewBtn?.textContent?.trim()).toBe('Visualizar');

      // Menu de 3 pontos
      const menuTrigger = host?.shadowRoot?.querySelector('.backtrack-menu-trigger') as HTMLButtonElement;
      expect(menuTrigger).not.toBeNull();

      const dropdown = host?.shadowRoot?.querySelector('.backtrack-dropdown-menu');
      expect(dropdown).not.toBeNull();
      expect(dropdown?.classList.contains('is-open')).toBe(false);

      // Clica no menu de 3 pontos para abrir
      menuTrigger?.click();
      const openDropdown = host?.shadowRoot?.querySelector('.backtrack-dropdown-menu');
      expect(openDropdown?.classList.contains('is-open')).toBe(true);

      // Itens do menu
      const downloadBtn = host?.shadowRoot?.querySelector('[data-download-id]');
      const copyBtn = host?.shadowRoot?.querySelector('[data-copy-id]');
      const deleteBtn = host?.shadowRoot?.querySelector('[data-delete-id]');

      expect(downloadBtn?.textContent).toContain('Baixar (.ffr.json)');
      expect(copyBtn?.textContent).toContain('Copiar Markdown');
      expect(deleteBtn?.textContent).toContain('Excluir');

      widget.unmount();
      recorder.stop();
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
