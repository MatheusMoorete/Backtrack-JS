import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../../src/storage/db';
import { FlightRecorderImpl } from '../../src/core/flight-recorder';
import { matchesSensitiveRoute, globToRegex } from '../../src/capturers/route-matcher';
import { BacktrackWidget } from '../../src/widget/widget';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

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

      expect(downloadBtn?.textContent).toContain('Baixar arquivo de gravação');
      expect(copyBtn?.textContent).toContain('Markdown para debug');
      expect(deleteBtn?.textContent).toContain('Excluir');

      // Clica em Baixar arquivo de gravação para abrir modal com as 3 opções de download
      (downloadBtn as HTMLButtonElement)?.click();
      let downloadModal = host?.shadowRoot?.querySelector('.backtrack-modal-card');
      expect(downloadModal).not.toBeNull();
      expect(downloadModal?.textContent).toContain('Baixar Arquivo de Gravação');
      expect(downloadModal?.textContent).toContain('JSON para IA (.ai.json)');
      expect(downloadModal?.textContent).toContain('Compactado Gzip (.ffr.json.gz)');
      expect(downloadModal?.textContent).toContain('JSON Completo (.ffr.json)');

      // Tenta clicar em Baixar sem selecionar nenhuma opção -> validação
      const confirmDownloadBtn = host?.shadowRoot?.getElementById('btn-confirm-download-modal');
      (confirmDownloadBtn as HTMLButtonElement)?.click();
      const errorMsg = host?.shadowRoot?.querySelector('.backtrack-modal-error');
      expect(errorMsg?.textContent).toBe('Escolha uma opção antes de baixar');

      // Seleciona a opção ai
      const aiRadio = host?.shadowRoot?.getElementById('radio-format-ai') as HTMLInputElement;
      aiRadio?.click();
      aiRadio?.dispatchEvent(new Event('change'));

      // Erro é limpo ao selecionar
      expect(host?.shadowRoot?.querySelector('.backtrack-modal-error')).toBeNull();

      // Fecha o modal de download
      const cancelDownloadBtn = host?.shadowRoot?.getElementById('btn-cancel-download-modal');
      (cancelDownloadBtn as HTMLButtonElement)?.click();
      expect(host?.shadowRoot?.querySelector('.backtrack-modal-card')).toBeNull();

      // Reabre o menu de 3 pontos
      (host?.shadowRoot?.querySelector('.backtrack-menu-trigger') as HTMLButtonElement)?.click();

      // Clica em Markdown para debug para abrir modal de opções
      const copyBtnReopened = host?.shadowRoot?.querySelector('[data-copy-id]');
      (copyBtnReopened as HTMLButtonElement)?.click();
      const modal = host?.shadowRoot?.querySelector('.backtrack-modal-card');
      expect(modal).not.toBeNull();
      expect(modal?.textContent).toContain('Markdown para debug');
      expect(modal?.textContent).toContain('Adicionar link do replay interativo?');

      // Desmarca a opção de link interativo do replay
      const checkIncludeLink = host?.shadowRoot?.getElementById('check-include-incident-link') as HTMLInputElement;
      expect(checkIncludeLink.checked).toBe(true);
      checkIncludeLink.checked = false;
      checkIncludeLink.dispatchEvent(new Event('change'));

      // Confirma cópia do Markdown (sem Gist)
      const confirmExportBtn = host?.shadowRoot?.getElementById('btn-confirm-export-modal') as HTMLButtonElement;
      confirmExportBtn?.click();

      // Aguarda processamento assíncrono e verifica fechamento do modal
      await new Promise((r) => setTimeout(r, 50));
      expect(host?.shadowRoot?.querySelector('.backtrack-modal-card')).toBeNull();

      widget.unmount();
      recorder.stop();
    });

    it('exibe tooltip de explicação e permite duração personalizada (Custom) entre 5s e 900s', () => {
      const recorder = new FlightRecorderImpl({}, db);
      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      const launcher = host?.shadowRoot?.getElementById('btn-launcher');
      launcher?.click();

      // Tooltip explicativo
      const helpTrigger = host?.shadowRoot?.querySelector('.backtrack-help-tooltip-trigger');
      expect(helpTrigger).not.toBeNull();
      expect(helpTrigger?.textContent).toContain('O que é?');
      expect(helpTrigger?.getAttribute('title')).toContain('5 segundos até 15 minutos');

      // Botões de duração
      const btn60 = host?.shadowRoot?.getElementById('btn-duration-60');
      const btn300 = host?.shadowRoot?.getElementById('btn-duration-300');
      const btnAll = host?.shadowRoot?.getElementById('btn-duration-all');
      const btnCustom = host?.shadowRoot?.getElementById('btn-duration-custom');

      expect(btn60).not.toBeNull();
      expect(btn300).not.toBeNull();
      expect(btnAll).not.toBeNull();
      expect(btnCustom).not.toBeNull();

      // Inicialmente 5 min está selecionado por padrão
      expect(btn300?.classList.contains('is-selected')).toBe(true);
      expect(btn60?.classList.contains('is-selected')).toBe(false);
      expect(btnAll?.classList.contains('is-selected')).toBe(false);
      expect(host?.shadowRoot?.getElementById('input-custom-duration')).toBeNull();

      // Clica em Tudo
      btnAll?.click();
      const updatedBtnAll = host?.shadowRoot?.getElementById('btn-duration-all');
      expect(updatedBtnAll?.classList.contains('is-selected')).toBe(true);
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(0);

      // Clica em 1 min
      btn60?.click();
      const updatedBtn60 = host?.shadowRoot?.getElementById('btn-duration-60');
      expect(updatedBtn60?.classList.contains('is-selected')).toBe(true);
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(60);

      // Clica em Custom
      btnCustom?.click();
      const updatedBtnCustom = host?.shadowRoot?.getElementById('btn-duration-custom');
      expect(updatedBtnCustom?.classList.contains('is-selected')).toBe(true);

      const customInput = host?.shadowRoot?.getElementById('input-custom-duration') as HTMLInputElement;
      expect(customInput).not.toBeNull();
      expect(customInput.getAttribute('min')).toBe('5');
      expect(customInput.getAttribute('max')).toBe('900');

      // Altera para 45 segundos
      customInput.value = '45';
      customInput.dispatchEvent(new Event('input'));
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(45);

      // Testa clamp mínimo (menos de 5s vai para 5s)
      customInput.value = '2';
      customInput.dispatchEvent(new Event('change'));
      expect(customInput.value).toBe('5');
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(5);

      // Testa clamp máximo (mais de 900s / 15 min vai para 900s)
      customInput.value = '1200';
      customInput.dispatchEvent(new Event('change'));
      expect(customInput.value).toBe('900');
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(900);

      // Alterna de volta para 5 min
      const finalBtn300Trigger = host?.shadowRoot?.getElementById('btn-duration-300');
      finalBtn300Trigger?.click();
      const finalBtn300 = host?.shadowRoot?.getElementById('btn-duration-300');
      expect(finalBtn300?.classList.contains('is-selected')).toBe(true);
      expect((widget as unknown as { selectedDurationSeconds: number }).selectedDurationSeconds).toBe(300);
      expect(host?.shadowRoot?.getElementById('input-custom-duration')).toBeNull();

      widget.unmount();
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

    it('permite ocultar, exibir e alternar visibilidade do widget via métodos, atalho e persistência', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();
      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();
      expect(host?.style.display).not.toBe('none');
      expect(widget.isVisible()).toBe(true);

      // Oculta widget
      widget.hide();
      expect(host?.style.display).toBe('none');
      expect(widget.isVisible()).toBe(false);
      expect(localStorage.getItem('backtrack_widget_hidden')).toBe('true');

      // Reexibe widget
      widget.show();
      expect(host?.style.display).toBe('');
      expect(widget.isVisible()).toBe(true);
      expect(localStorage.getItem('backtrack_widget_hidden')).toBeNull();

      // Alterna visibilidade
      const isVisibleNow = widget.toggle();
      expect(isVisibleNow).toBe(false);
      expect(host?.style.display).toBe('none');

      const isVisibleAfterToggle = widget.toggle();
      expect(isVisibleAfterToggle).toBe(true);
      expect(host?.style.display).toBe('');

      // Testa botão de ocultar no header do painel
      const launcher = host?.shadowRoot?.getElementById('btn-launcher');
      launcher?.click();

      const btnHide = host?.shadowRoot?.getElementById('btn-hide-widget');
      expect(btnHide).not.toBeNull();
      btnHide?.click();

      // Modal de confirmação com aviso do atalho e do comando no console
      const hideModal = host?.shadowRoot?.querySelector('.backtrack-modal-card');
      expect(hideModal).not.toBeNull();
      expect(hideModal?.textContent).toContain('Ocultar Backtrack');
      expect(hideModal?.textContent).toContain('Ctrl + Shift + B');
      expect(hideModal?.textContent).toContain('Backtrack.show()');

      const btnConfirmHide = host?.shadowRoot?.getElementById('btn-confirm-hide-modal') as HTMLButtonElement;
      expect(btnConfirmHide).not.toBeNull();
      btnConfirmHide?.click();
      expect(host?.style.display).toBe('none');

      // Testa atalho de teclado global Ctrl+Shift+B
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'B', ctrlKey: true, shiftKey: true }));
      expect(host?.style.display).toBe('');

      widget.unmount();
      recorder.stop();
      localStorage.removeItem('backtrack_widget_hidden');
    });

    it('ao clicar em Visualizar, carrega o artefato com getArtifact sem acionar exportIncident (sem download)', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();

      const mockArtifact = {
        schemaVersion: '1.0.0' as const,
        incident: {
          id: 'test-inc-1',
          sessionId: 's1',
          startedAt: 1000,
          finalizedAt: 2000,
          triggeredAt: 1500,
          reason: 'Test bug',
          environment: { url: 'http://localhost', userAgent: 'test', viewport: { width: 1000, height: 800 } }
        },
        timeline: [],
        rrwebEvents: []
      } as unknown as FlightRecorderArtifactV1;

      const getArtifactSpy = vi.spyOn(recorder, 'getArtifact').mockResolvedValue(mockArtifact);
      const exportIncidentSpy = vi.spyOn(recorder, 'exportIncident');

      const widget = new BacktrackWidget(recorder);
      widget.mount();

      // Injeta incidente mock
      (widget as unknown as { incidents: Array<{ id: string; startedAt: number; finalizedAt: number; reason: string }> }).incidents = [
        { id: 'test-inc-1', startedAt: 1000, finalizedAt: 2000, reason: 'Test bug' }
      ];

      // Abre drawer
      const host = document.getElementById('__backtrack_widget_host__');
      host?.shadowRoot?.getElementById('btn-launcher')?.click();

      const viewBtn = host?.shadowRoot?.querySelector('[data-view-id="test-inc-1"]') as HTMLButtonElement;
      expect(viewBtn).not.toBeNull();

      // Clica em Visualizar
      viewBtn?.click();

      await new Promise((r) => setTimeout(r, 50));

      expect(getArtifactSpy).toHaveBeenCalledWith('test-inc-1');
      expect(exportIncidentSpy).not.toHaveBeenCalled();

      widget.unmount();
      recorder.stop();
    });

    it('fecha o modal aberto ao pressionar a tecla Escape e exibe tooltip explicativo de 50mb no storage', async () => {
      const recorder = new FlightRecorderImpl({}, db);
      await recorder.start();
      const widget = new BacktrackWidget(recorder);
      widget.mount();

      const host = document.getElementById('__backtrack_widget_host__');
      expect(host).not.toBeNull();

      // Abre o modal
      host?.shadowRoot?.getElementById('btn-launcher')?.click();
      expect(host?.shadowRoot?.querySelector('.backtrack-panel')).not.toBeNull();

      // Tooltip explicativo de 50mb ao lado do tamanho
      const storageTooltip = host?.shadowRoot?.querySelector('.backtrack-storage-tooltip-trigger');
      expect(storageTooltip).not.toBeNull();
      expect(storageTooltip?.getAttribute('title')).toContain('50 MB');
      expect(storageTooltip?.getAttribute('title')).toContain('IndexedDB');

      // Pressiona Escape
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      // Modal deve estar fechado
      expect(host?.shadowRoot?.querySelector('.backtrack-panel')).toBeNull();

      widget.unmount();
      recorder.stop();
    });
  });
});
