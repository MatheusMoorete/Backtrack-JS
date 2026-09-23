import type { FlightRecorder } from '../types';
import type { FlightRecorderArtifactV1 } from '../types/artifact';
import type { RecorderHealth } from '../types/health';
import type { IncidentSummary } from '../types/incident';
import type { WidgetOptions } from '../types/options';
import { uploadArtifactToGist } from '../utils/gist-uploader';
import { formatIncidentMarkdown } from '../utils/markdown';
import { ScreenAnnotator } from './annotator';
import { WIDGET_CSS } from './styles';

const DEFAULT_VIEWER_URL = 'https://backtrack-viewer.pages.dev';

export class BacktrackWidget {
  private recorder: FlightRecorder;
  private options: WidgetOptions;
  private container: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  private isOpen = false;
  private selectedDurationSeconds = 300; // 5m default (ou 0 para Tudo)
  private isCapturing = false;
  private incidents: IncidentSummary[] = [];
  private health: RecorderHealth | null = null;
  private isCustomDuration = false;
  private toast: { message: string; type: 'success' | 'danger' } | null = null;
  private banner: { message: string; type: 'success' | 'danger' } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private isHeaderMenuOpen = false;
  private selectedIncidentId: string | null = null;

  private exportModalIncidentId: string | null = null;
  private exportModalIncludeLink = true;
  private isExportingMarkdown = false;
  private exportModalError: string | null = null;

  private downloadModalIncidentId: string | null = null;
  private downloadModalFormat: 'gzip' | 'uncompressed' | 'ai' | null = null;
  private isDownloading = false;
  private downloadModalError: string | null = null;
  private showHideConfirmModal = false;

  private wasDragged = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handleGlobalKey?: (e: KeyboardEvent) => void;

  constructor(recorder: FlightRecorder, options?: WidgetOptions) {
    this.recorder = recorder;
    this.options = {
      position: options?.position ?? 'bottom-left',
      zIndex: options?.zIndex ?? 999999,
      defaultViewerUrl: options?.defaultViewerUrl ?? DEFAULT_VIEWER_URL
    };
  }

  public mount(): void {
    if (this.container || typeof document === 'undefined') return;

    const host = document.createElement('div');
    host.id = '__backtrack_widget_host__';
    host.className = 'backtrack-ignore rr-ignore';
    host.setAttribute('data-rr-ignore', 'true');
    this.applyHostPosition(host);

    // Respeita preferência do usuário de ocultar
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('backtrack_widget_hidden') === 'true') {
        host.style.display = 'none';
      }
    } catch {
      // Ignora erro de acesso ao localStorage
    }

    this.shadow = host.attachShadow({ mode: 'open' });
    this.container = host;
    document.body.appendChild(host);

    // Atalho global para alternar visibilidade (Ctrl+Shift+B ou Cmd+Shift+B) e fechar com Escape
    this.handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (this.showHideConfirmModal) {
          e.preventDefault();
          this.showHideConfirmModal = false;
          this.render();
          return;
        }
        if (this.exportModalIncidentId) {
          e.preventDefault();
          this.closeExportModal();
          return;
        }
        if (this.downloadModalIncidentId) {
          e.preventDefault();
          this.closeDownloadModal();
          return;
        }
        if (this.isHeaderMenuOpen) {
          e.preventDefault();
          this.isHeaderMenuOpen = false;
          this.render();
          return;
        }
        if (this.banner) {
          e.preventDefault();
          this.dismissBanner();
          return;
        }
        if (this.selectedIncidentId) {
          e.preventDefault();
          this.selectedIncidentId = null;
          this.render();
          return;
        }
        if (this.isOpen) {
          e.preventDefault();
          this.toggleOpen();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener('keydown', this.handleGlobalKey);

    this.render();
    this.updateData();
  }

  public unmount(): void {
    if (this.handleGlobalKey && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleGlobalKey);
      this.handleGlobalKey = undefined;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.shadow = null;
  }

  public hide(): void {
    this.showHideConfirmModal = false;
    this.isHeaderMenuOpen = false;
    if (this.container) {
      this.container.style.display = 'none';
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('backtrack_widget_hidden', 'true');
      }
    } catch {
      // Ignora
    }
    console.log(
      '%c[Backtrack]%c Widget ocultado. Para reexibir, use %cBacktrack.show()%c no console ou tecle %cCtrl+Shift+B%c.',
      'color: #38bdf8; font-weight: bold;',
      'color: inherit;',
      'color: #22c55e; font-weight: bold;',
      'color: inherit;',
      'color: #f59e0b; font-weight: bold;',
      'color: inherit;'
    );
  }

  public show(): void {
    if (this.container) {
      this.container.style.display = '';
    }
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('backtrack_widget_hidden');
      }
    } catch {
      // Ignora
    }
    console.log('%c[Backtrack]%c Widget exibido!', 'color: #38bdf8; font-weight: bold;', 'color: inherit;');
  }

  public toggle(): boolean {
    const isCurrentlyHidden =
      this.container?.style.display === 'none' ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('backtrack_widget_hidden') === 'true');
    if (isCurrentlyHidden) {
      this.show();
      return true;
    } else {
      this.hide();
      return false;
    }
  }

  public isVisible(): boolean {
    if (!this.container) return false;
    return this.container.style.display !== 'none';
  }

  private applyHostPosition(host: HTMLElement): void {
    const pos = this.options.position || 'bottom-left';
    host.style.position = 'fixed';
    host.style.zIndex = String(this.options.zIndex || 999999);

    if (pos === 'bottom-left') {
      host.style.bottom = '16px';
      host.style.left = '16px';
    } else if (pos === 'bottom-right') {
      host.style.bottom = '16px';
      host.style.right = '16px';
    } else if (pos === 'top-left') {
      host.style.top = '16px';
      host.style.left = '16px';
    } else if (pos === 'top-right') {
      host.style.top = '16px';
      host.style.right = '16px';
    }
  }

  private getViewerUrl(): string {
    try {
      if (typeof localStorage !== 'undefined') {
        const custom = localStorage.getItem('backtrack_viewer_url');
        if (custom && custom.trim()) {
          return custom.trim().replace(/\/+$/, '');
        }
      }
    } catch {
      // Ignora erro de acesso ao localStorage
    }
    return (this.options.defaultViewerUrl || DEFAULT_VIEWER_URL).replace(/\/+$/, '');
  }

  private async updateData(): Promise<void> {
    try {
      this.health = this.recorder.getHealth();
      this.incidents = await this.recorder.listIncidents();
      this.updateDomValues();
    } catch {
      // Ignora erro
    }
  }

  private showToast(message: string, type: 'success' | 'danger' = 'success', durationMs = 2800): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.toast = { message, type };
    this.render();
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
      this.render();
    }, durationMs);
  }

  private showBanner(message: string, type: 'success' | 'danger' = 'danger'): void {
    this.banner = { message, type };
    this.render();
  }

  private dismissBanner(): void {
    this.banner = null;
    this.render();
  }

  private async handleCapture(): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.render();

    try {
      const duration = this.selectedDurationSeconds > 0 ? this.selectedDurationSeconds : undefined;
      await this.recorder.capture('manual', duration);
      await this.updateData();
      this.showToast('Gravação salva.', 'success');
    } catch (err) {
      this.showBanner('Não foi possível salvar a gravação. Tente novamente.', 'danger');
    } finally {
      this.isCapturing = false;
      this.render();
    }
  }

  private async handleClear(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Deseja realmente limpar todas as gravações e o buffer da sessão?')) {
          return;
        }
      }
      await this.recorder.clear();
      this.selectedIncidentId = null;
      await this.updateData();
      this.showToast('Gravações limpas.', 'success');
    } catch (err) {
      this.showBanner('Não foi possível limpar as gravações.', 'danger');
    }
  }

  private async handleViewIncident(incidentId: string): Promise<void> {
    try {
      const artifact = await this.recorder.getArtifact(incidentId);
      this.openInViewer(artifact);
    } catch {
      this.showBanner('Não foi possível carregar o replay. Tente novamente.', 'danger');
    }
  }

  private handleDownloadIncident(incidentId: string): void {
    this.openDownloadModal(incidentId);
  }

  private openDownloadModal(incidentId: string): void {
    this.downloadModalIncidentId = incidentId;
    this.downloadModalFormat = null;
    this.downloadModalError = null;
    this.isDownloading = false;
    this.render();
  }

  private closeDownloadModal(): void {
    if (this.isDownloading) return;
    this.downloadModalIncidentId = null;
    this.downloadModalFormat = null;
    this.downloadModalError = null;
    this.render();
  }

  private async confirmDownload(): Promise<void> {
    const id = this.downloadModalIncidentId;
    if (!id) return;

    if (!this.downloadModalFormat) {
      this.downloadModalError = 'Escolha uma opção antes de baixar';
      this.render();
      return;
    }

    this.isDownloading = true;
    this.downloadModalError = null;
    this.render();

    try {
      const isAi = this.downloadModalFormat === 'ai';
      const compress = this.downloadModalFormat === 'gzip';
      await this.recorder.exportIncident(id, { compress, aiOptimized: isAi });
      this.showToast('Download iniciado.', 'success');
    } catch {
      this.downloadModalError = 'Falha ao exportar incidente.';
      this.isDownloading = false;
      this.render();
      return;
    } finally {
      this.isDownloading = false;
    }

    this.downloadModalIncidentId = null;
    this.downloadModalFormat = null;
    this.downloadModalError = null;
    this.render();
  }

  private handleCopyMarkdown(incidentId: string): void {
    this.openExportModal(incidentId);
  }

  private openExportModal(incidentId: string): void {
    this.exportModalIncidentId = incidentId;
    this.exportModalIncludeLink = true;
    this.exportModalError = null;
    this.isExportingMarkdown = false;
    this.render();
  }

  private closeExportModal(): void {
    if (this.isExportingMarkdown) return;
    this.exportModalIncidentId = null;
    this.exportModalError = null;
    this.render();
  }

  private async confirmCopyMarkdown(): Promise<void> {
    const id = this.exportModalIncidentId;
    if (!id) return;

    this.isExportingMarkdown = true;
    this.exportModalError = null;
    this.render();

    try {
      const artifact = await this.recorder.getArtifact(id);
      let replayUrl: string | undefined;

      if (this.exportModalIncludeLink) {
        let token = typeof localStorage !== 'undefined' ? localStorage.getItem('backtrack_github_token') : null;

        if (!token || !token.trim()) {
          const prompted = prompt(
            'Insira seu GitHub Personal Access Token (com permissão "gist") para gerar o link compartilhado:'
          );
          if (!prompted || !prompted.trim()) {
            this.isExportingMarkdown = false;
            this.render();
            return;
          }
          token = prompted.trim();
          try {
            localStorage.setItem('backtrack_github_token', token);
          } catch {
            // Ignora
          }
        }

        const result = await uploadArtifactToGist(artifact, token);
        const viewerUrl = this.getViewerUrl();
        replayUrl = `${viewerUrl}/?gist=${result.gistId}`;

        const offsetSec = Math.floor(
          Math.max(0, (artifact.incident.triggeredAt || artifact.incident.finalizedAt) - artifact.incident.startedAt) / 1000
        );
        if (replayUrl && offsetSec > 0 && !replayUrl.includes('&t=') && !replayUrl.includes('?t=')) {
          replayUrl += (replayUrl.includes('?') ? '&' : '?') + `t=${offsetSec}`;
        }
      }

      const md = formatIncidentMarkdown(artifact, { replayUrl });
      let copied = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(md);
          copied = true;
        } catch {
          // Fallback via textarea
        }
      }
      if (!copied && typeof document !== 'undefined') {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = md;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          copied = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch {
          copied = false;
        }
      }

      if (copied) {
        this.showToast(this.exportModalIncludeLink ? 'Link copiado.' : 'Markdown copiado.', 'success');
      } else {
        this.showToast('Área de transferência indisponível.', 'danger');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401')) {
        try {
          localStorage.removeItem('backtrack_github_token');
        } catch {
          // Ignora
        }
      }
      this.exportModalError = `Falha: ${msg}`;
      this.isExportingMarkdown = false;
      this.render();
      return;
    } finally {
      this.isExportingMarkdown = false;
    }

    this.exportModalIncidentId = null;
    this.exportModalError = null;
    this.render();
  }

  private async handleShareGist(incidentId: string): Promise<void> {
    let token = typeof localStorage !== 'undefined' ? localStorage.getItem('backtrack_github_token') : null;

    if (!token || !token.trim()) {
      const prompted = prompt(
        'Insira seu GitHub Personal Access Token (com permissão "gist") para gerar o link compartilhado:'
      );
      if (!prompted || !prompted.trim()) {
        return;
      }
      token = prompted.trim();
      try {
        localStorage.setItem('backtrack_github_token', token);
      } catch {
        // Ignora
      }
    }

    try {
      const artifact = await this.recorder.getArtifact(incidentId);
      const result = await uploadArtifactToGist(artifact, token);
      const viewerUrl = this.getViewerUrl();
      const shareableUrl = `${viewerUrl}/?gist=${result.gistId}`;

      let copied = false;
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(shareableUrl);
          copied = true;
        } catch {
          // Fallback via textarea
        }
      }
      if (!copied && typeof document !== 'undefined') {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = shareableUrl;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          copied = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch {
          copied = false;
        }
      }

      if (copied) {
        this.showToast('Link copiado.', 'success');
      } else {
        prompt('Link compartilhado gerado com sucesso:', shareableUrl);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('401')) {
        try {
          localStorage.removeItem('backtrack_github_token');
        } catch {
          // Ignora
        }
      }
      this.showBanner('Não foi possível gerar o link. Tente novamente.', 'danger');
    }
  }

  private handleAnnotate(): void {
    this.isOpen = false;
    this.render();

    const annotator = new ScreenAnnotator();
    annotator.open(async (result) => {
      if (!result) {
        this.isOpen = true;
        this.render();
        return;
      }

      try {
        this.isCapturing = true;
        this.isOpen = true;
        this.render();

        const reason = result.notes?.trim()
          ? `Anotação do QA: ${result.notes.trim()}`
          : 'Anotação visual de bug na tela';
        const duration = this.selectedDurationSeconds > 0 ? this.selectedDurationSeconds : undefined;
        await this.recorder.capture(reason, duration, {
          annotationImage: result.dataUrl,
          notes: result.notes
        });
        await this.updateData();
        this.showToast('Gravação salva.', 'success');
      } catch (err) {
        this.showBanner('Não foi possível salvar a gravação com anotação.', 'danger');
      } finally {
        this.isCapturing = false;
        this.render();
      }
    });
  }

  private async handleDeleteIncident(incidentId: string): Promise<void> {
    try {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        if (!window.confirm('Deseja realmente excluir esta gravação?')) {
          return;
        }
      }
      await this.recorder.deleteIncident(incidentId);
      if (this.selectedIncidentId === incidentId) {
        this.selectedIncidentId = null;
      }
      await this.updateData();
      this.showToast('Gravação excluída.', 'success');
    } catch {
      this.showBanner('Não foi possível excluir a gravação.', 'danger');
    }
  }

  private openInViewer(artifact: FlightRecorderArtifactV1): void {
    const viewerUrl = this.getViewerUrl();
    const win = window.open(viewerUrl, 'backtrack_viewer');
    if (!win) {
      this.showBanner('Pop-up bloqueado. Permita pop-ups no navegador.', 'danger');
      return;
    }

    try {
      win.focus();
    } catch {
      // Noop
    }

    let received = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      window.removeEventListener('message', onMessage);
    };

    const sendPayload = () => {
      if (received || win.closed) {
        cleanup();
        return;
      }
      try {
        win.postMessage({ type: 'LOAD_BACKTRACK_ARTIFACT', artifact }, '*');
      } catch {
        // Ignora
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'BACKTRACK_VIEWER_READY' || event.data?.type === 'FFR_VIEWER_READY') {
        sendPayload();
      } else if (event.data?.type === 'BACKTRACK_ARTIFACT_RECEIVED' || event.data?.type === 'FFR_ARTIFACT_RECEIVED') {
        received = true;
        cleanup();
      }
    };

    window.addEventListener('message', onMessage);
    sendPayload();

    const start = Date.now();
    timer = setInterval(() => {
      if (received || win.closed || Date.now() - start > 4000) {
        cleanup();
      } else {
        sendPayload();
      }
    }, 250);
  }

  private toggleOpen(): void {
    this.isOpen = !this.isOpen;
    this.isHeaderMenuOpen = false;
    this.selectedIncidentId = null;
    if (this.isOpen) {
      this.updateData();
      if (!this.pollTimer) {
        this.pollTimer = setInterval(() => this.updateData(), 5000);
      }
    } else {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    }
    this.render();
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  }

  private formatIncidentTitle(reason?: string): string {
    if (!reason || reason === 'manual') {
      return 'Sessão manual iniciada';
    }
    if (reason === 'unhandled-error') {
      return 'Erro não tratado na aplicação';
    }
    if (reason === 'http-error') {
      return 'Falha na requisição de rede';
    }
    return reason;
  }

  private renderBannerHtml(): string {
    if (!this.banner) return '';
    const isSuccess = this.banner.type === 'success';
    return `
      <div class="backtrack-banner backtrack-banner-${this.banner.type}" role="alert">
        <span class="backtrack-banner-icon">
          ${
            isSuccess
              ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>`
              : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>`
          }
        </span>
        <span class="backtrack-banner-text">${this.banner.message}</span>
        <button
          type="button"
          class="backtrack-banner-close"
          id="btn-dismiss-banner"
          aria-label="Fechar aviso"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    `;
  }

  private renderToastHtml(): string {
    if (!this.toast) return '';
    const isSuccess = this.toast.type === 'success';
    return `
      <div class="backtrack-toast-wrap">
        <div class="backtrack-toast backtrack-toast-${this.toast.type}" role="status" aria-live="polite">
          <span class="backtrack-toast-icon">
            ${
              isSuccess
                ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>`
                : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>`
            }
          </span>
          <span class="backtrack-toast-text">${this.toast.message}</span>
        </div>
      </div>
    `;
  }

  private render(): void {
    if (!this.shadow) return;

    const statusClass =
      this.health?.state === 'recording'
        ? 'backtrack-status-recording'
        : this.health?.state === 'degraded'
        ? 'backtrack-status-degraded'
        : 'backtrack-status-idle';

    const incidentCount = this.incidents.length;

    this.shadow.innerHTML = `
      <style>${WIDGET_CSS}</style>
      <div class="backtrack-root">
        <!-- Launcher Button -->
        <button
          type="button"
          class="backtrack-launcher-btn"
          id="btn-launcher"
          title="Backtrack — Gravação e Depuração de Sessão"
          aria-label="Abrir painel do Backtrack"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <polyline points="3 3 3 8 8 8" />
            <polygon points="10 9 15 12 10 15 10 9" fill="currentColor" stroke="none" />
          </svg>
          <span class="backtrack-launcher-status-dot ${statusClass}"></span>
          ${incidentCount > 0 ? `<span class="backtrack-incident-badge-count">${incidentCount}</span>` : ''}
        </button>

        <!-- Slide-over Drawer Panel -->
        ${
          this.isOpen
            ? `
          <div class="backtrack-panel" role="dialog" aria-labelledby="backtrack-title">
            <!-- 1. Header -->
            <div class="backtrack-panel-header">
              <div class="backtrack-header-left">
                <div class="backtrack-header-title" id="backtrack-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <polyline points="3 3 3 8 8 8" />
                    <polyline points="12 7 12 12 15 15" />
                  </svg>
                  <span>Backtrack</span>
                  <span class="backtrack-header-dot"></span>
                </div>
              </div>
              <div class="backtrack-header-right">
                <span
                  class="backtrack-storage-tooltip-trigger"
                  title="${this.health?.protectedStorageBytes ? `${this.formatBytes(this.health.protectedStorageBytes)} protegidos. ` : ''}Dados protegidos contra a rotação automática de memória no IndexedDB (limite total de 50 MB)."
                  aria-label="Informações sobre dados protegidos no IndexedDB"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <div class="backtrack-header-menu-wrap">
                  <button
                    type="button"
                    class="backtrack-header-icon-btn"
                    id="btn-header-menu"
                    title="Mais opções"
                    aria-label="Mais opções"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <circle cx="12" cy="12" r="2" />
                      <circle cx="19" cy="12" r="2" />
                      <circle cx="5" cy="12" r="2" />
                    </svg>
                  </button>
                  ${
                    this.isHeaderMenuOpen
                      ? `
                    <div class="backtrack-header-menu">
                      <div class="backtrack-header-menu-info">
                        Armazenamento: ${this.formatBytes(this.health?.storageBytes ?? 0)}
                      </div>
                      <button type="button" class="backtrack-header-menu-item" id="btn-hide-widget">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </svg>
                        <span>Ocultar Backtrack da tela</span>
                      </button>
                    </div>
                  `
                      : ''
                  }
                </div>
                <button
                  type="button"
                  class="backtrack-header-icon-btn"
                  id="btn-close"
                  title="Fechar painel"
                  aria-label="Fechar painel"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Body -->
            <div class="backtrack-panel-body">
              ${this.renderBannerHtml()}

              ${
                this.selectedIncidentId
                  ? this.renderDetailViewHtml()
                  : `
                <div class="backtrack-controls-section">
                  <div class="backtrack-section-label-row">
                    <div class="backtrack-section-label">Janela de gravação</div>
                    <span
                      class="backtrack-help-tooltip-trigger"
                      title="Quanto tempo de histórico retroativo será gravado antes do clique (de 5 segundos até 15 minutos)."
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="12" y1="16" x2="12" y2="12" />
                        <line x1="12" y1="8" x2="12.01" y2="8" />
                      </svg>
                      <span>O que é?</span>
                    </span>
                  </div>
                  <div class="backtrack-duration-grid">
                    <button
                      type="button"
                      class="backtrack-duration-btn ${!this.isCustomDuration && this.selectedDurationSeconds === 60 ? 'is-selected' : ''}"
                      id="btn-duration-60"
                    >
                      1 min
                    </button>
                    <button
                      type="button"
                      class="backtrack-duration-btn ${!this.isCustomDuration && this.selectedDurationSeconds === 300 ? 'is-selected' : ''}"
                      id="btn-duration-300"
                    >
                      5 min
                    </button>
                    <button
                      type="button"
                      class="backtrack-duration-btn ${!this.isCustomDuration && this.selectedDurationSeconds === 0 ? 'is-selected' : ''}"
                      id="btn-duration-all"
                      title="Grava todo o histórico da sessão disponível no buffer"
                    >
                      Tudo
                    </button>
                    <button
                      type="button"
                      class="backtrack-duration-btn ${this.isCustomDuration ? 'is-selected' : ''}"
                      id="btn-duration-custom"
                    >
                      <span>Custom</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>
                  </div>

                  ${
                    this.isCustomDuration
                      ? `
                    <div class="backtrack-custom-duration-row">
                      <div class="backtrack-custom-input-wrap">
                        <input
                          type="number"
                          class="backtrack-custom-duration-input"
                          id="input-custom-duration"
                          min="5"
                          max="900"
                          value="${this.selectedDurationSeconds > 0 ? this.selectedDurationSeconds : 300}"
                          aria-label="Duração personalizada em segundos"
                        />
                        <span class="backtrack-custom-unit">segundos</span>
                      </div>
                      <span class="backtrack-custom-hint">5s a 900s (15 min)</span>
                    </div>
                  `
                      : ''
                  }

                  <div class="backtrack-actions-row">
                    <button
                      type="button"
                      class="backtrack-btn-save"
                      id="btn-save"
                      ${this.isCapturing ? 'disabled' : ''}
                    >
                      ${this.isCapturing ? 'Salvando...' : 'Salvar'}
                    </button>
                    <button
                      type="button"
                      class="backtrack-btn-icon-square"
                      id="btn-annotate"
                      title="Anotar na tela"
                      aria-label="Anotar na tela"
                      ${this.isCapturing ? 'disabled' : ''}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 19l7-7 3 3-7 7-3-3z" />
                        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
                        <path d="M2 2l7.586 7.586" />
                        <circle cx="11" cy="11" r="2" />
                      </svg>
                      <span class="backtrack-sr-only">Anotar</span>
                    </button>
                    <button
                      type="button"
                      class="backtrack-btn-icon-square"
                      id="btn-clear"
                      title="Limpar gravações e buffer local"
                      aria-label="Limpar gravações e buffer local"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L18 15" />
                        <path d="M11 4L20 13" />
                      </svg>
                      <span class="backtrack-sr-only">Limpar</span>
                    </button>
                  </div>
                </div>

                <!-- 3. Lista de Gravações Salvas -->
                <div class="backtrack-list-header">
                  <span class="backtrack-list-title">Gravações salvas</span>
                  <span class="backtrack-list-count" id="backtrack-saved-count-title">${incidentCount}</span>
                </div>
                <div id="backtrack-incident-list-container">
                  ${this.renderIncidentsHtml()}
                </div>
              `
              }
            </div>

            <!-- Modais -->
            ${this.exportModalIncidentId ? this.renderExportModal() : ''}
            ${this.downloadModalIncidentId ? this.renderDownloadModal() : ''}
            ${this.showHideConfirmModal ? this.renderHideConfirmModal() : ''}

            <!-- Toast Flutuante -->
            ${this.renderToastHtml()}
          </div>
        `
            : ''
        }
      </div>
    `;

    this.attachEventListeners();
  }

  private renderIncidentsHtml(): string {
    const incidentCount = this.incidents.length;
    if (incidentCount === 0) {
      return `
        <div class="backtrack-empty-container">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <div class="backtrack-empty-title">Nenhuma gravação ainda</div>
          <div class="backtrack-empty-desc">Clique em Salvar para capturar os últimos 5 minutos</div>
        </div>
      `;
    }

    return this.incidents
      .slice(0, 8)
      .map((inc) => {
        const dateStr = new Date(inc.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const durationSec = inc.finalizedAt
          ? Math.max(1, Math.round((inc.finalizedAt - inc.startedAt) / 1000))
          : 0;
        const title = this.formatIncidentTitle(inc.reason);

        return `
          <div class="backtrack-list-item" data-open-detail-id="${inc.id}" role="button" tabindex="0" aria-label="${title}">
            <div class="backtrack-item-content">
              <span class="backtrack-item-title">${title}</span>
              <span class="backtrack-item-meta">${dateStr} · ${durationSec}s</span>
            </div>
            <div class="backtrack-item-chevron">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
        `;
      })
      .join('');
  }

  private renderDetailViewHtml(): string {
    const inc = this.incidents.find((i) => i.id === this.selectedIncidentId);
    if (!inc) {
      this.selectedIncidentId = null;
      return this.renderIncidentsHtml();
    }

    const dateStr = new Date(inc.startedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const durationSec = inc.finalizedAt
      ? Math.max(1, Math.round((inc.finalizedAt - inc.startedAt) / 1000))
      : 0;
    const title = this.formatIncidentTitle(inc.reason);

    return `
      <div class="backtrack-detail-view">
        <!-- 1. Botão Voltar -->
        <div class="backtrack-detail-back-row">
          <button type="button" class="backtrack-btn-back" id="btn-back-to-list" aria-label="Voltar para a lista">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>Voltar</span>
          </button>
        </div>

        <!-- 2. Card de resumo da sessão -->
        <div class="backtrack-detail-card">
          <div class="backtrack-detail-title">${title}</div>
          <div class="backtrack-detail-meta">${dateStr} · ${durationSec}s · ${inc.id.length > 20 ? inc.id.substring(0, 18) + '...' : inc.id}</div>
        </div>

        <!-- 3. CTA principal — Visualizar replay -->
        <button type="button" class="backtrack-btn-cta-replay backtrack-detail-btn-primary" data-view-id="${inc.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span>Visualizar replay</span>
        </button>

        <!-- 4. Grupo "Exportar" (ações agrupadas) -->
        <div class="backtrack-export-section">
          <div class="backtrack-export-label">EXPORTAR</div>
          <div class="backtrack-export-group">
            <button type="button" class="backtrack-export-item" data-copy-id="${inc.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Markdown para debug</span>
            </button>

            <button type="button" class="backtrack-export-item" data-download-id="${inc.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Baixar arquivo de gravação</span>
            </button>

            <button type="button" class="backtrack-export-item" data-share-gist-id="${inc.id}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
              <span>Gerar link para compartilhar</span>
            </button>
          </div>
        </div>

        <!-- 5. Ação destrutiva — Excluir gravação -->
        <div class="backtrack-destructive-section">
          <button type="button" class="backtrack-btn-delete-ghost" data-delete-id="${inc.id}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            <span>Excluir gravação</span>
          </button>
        </div>
      </div>
    `;
  }

  private renderExportModal(): string {
    return `
      <div class="backtrack-modal-overlay">
        <div class="backtrack-modal-card">
          <div class="backtrack-modal-header">
            <div class="backtrack-modal-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              <span>Markdown para debug</span>
            </div>
            <button type="button" class="backtrack-modal-close" id="btn-close-export-modal" aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="backtrack-modal-body">
            <label class="backtrack-modal-checkbox-label">
              <input type="checkbox" id="check-include-incident-link" ${this.exportModalIncludeLink ? 'checked' : ''} ${this.isExportingMarkdown ? 'disabled' : ''} />
              <div>
                <span class="backtrack-modal-checkbox-title">Adicionar link do replay interativo?</span>
                <p class="backtrack-modal-checkbox-desc">Gera e inclui o link publico do replay online (GitHub Gist) no relatorio para que a equipe ou IAs possam inspecionar a sessao.</p>
              </div>
            </label>
            ${this.exportModalError ? `<div class="backtrack-modal-error">${this.exportModalError}</div>` : ''}
          </div>
          <div class="backtrack-modal-footer">
            <button type="button" class="backtrack-btn-secondary" id="btn-cancel-export-modal" ${this.isExportingMarkdown ? 'disabled' : ''}>Cancelar</button>
            <button type="button" class="backtrack-btn-primary" id="btn-confirm-export-modal" ${this.isExportingMarkdown ? 'disabled' : ''}>
              ${this.isExportingMarkdown ? (this.exportModalIncludeLink ? 'Criando link do Gist...' : 'Copiando...') : 'Copiar Markdown para debug'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderDownloadModal(): string {
    return `
      <div class="backtrack-modal-overlay">
        <div class="backtrack-modal-card">
          <div class="backtrack-modal-header">
            <div class="backtrack-modal-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span>Baixar Arquivo de Gravação</span>
            </div>
            <button type="button" class="backtrack-modal-close" id="btn-close-download-modal" aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="backtrack-modal-body">
            <label class="backtrack-modal-radio-label ${this.downloadModalFormat === 'ai' ? 'is-selected' : ''}">
              <input type="radio" name="backtrack-download-format" value="ai" id="radio-format-ai" ${this.downloadModalFormat === 'ai' ? 'checked' : ''} ${this.isDownloading ? 'disabled' : ''} />
              <div>
                <span class="backtrack-modal-radio-title">JSON para IA (.ai.json)</span>
                <p class="backtrack-modal-radio-desc">Leve (&lt; 100 KB), sem replay visual. Ideal para Gemini e Claude.</p>
              </div>
            </label>
            <label class="backtrack-modal-radio-label ${this.downloadModalFormat === 'gzip' ? 'is-selected' : ''}">
              <input type="radio" name="backtrack-download-format" value="gzip" id="radio-format-gzip" ${this.downloadModalFormat === 'gzip' ? 'checked' : ''} ${this.isDownloading ? 'disabled' : ''} />
              <div>
                <span class="backtrack-modal-radio-title">Compactado Gzip (.ffr.json.gz)</span>
                <p class="backtrack-modal-radio-desc">Replay completo (~90% menor). Ideal para Slack, Jira e WhatsApp.</p>
              </div>
            </label>
            <label class="backtrack-modal-radio-label ${this.downloadModalFormat === 'uncompressed' ? 'is-selected' : ''}">
              <input type="radio" name="backtrack-download-format" value="uncompressed" id="radio-format-uncompressed" ${this.downloadModalFormat === 'uncompressed' ? 'checked' : ''} ${this.isDownloading ? 'disabled' : ''} />
              <div>
                <span class="backtrack-modal-radio-title">JSON Completo (.ffr.json)</span>
                <p class="backtrack-modal-radio-desc">Replay bruto descompactado (&gt; 1 MB). Para inspeção direta.</p>
              </div>
            </label>
            ${this.downloadModalError ? `<div class="backtrack-modal-error">${this.downloadModalError}</div>` : ''}
          </div>
          <div class="backtrack-modal-footer">
            <button type="button" class="backtrack-btn-secondary" id="btn-cancel-download-modal" ${this.isDownloading ? 'disabled' : ''}>Cancelar</button>
            <button type="button" class="backtrack-btn-primary" id="btn-confirm-download-modal" ${this.isDownloading ? 'disabled' : ''}>
              ${this.isDownloading ? 'Baixando...' : 'Baixar'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderHideConfirmModal(): string {
    return `
      <div class="backtrack-modal-overlay">
        <div class="backtrack-modal-card">
          <div class="backtrack-modal-header">
            <div class="backtrack-modal-title">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
              <span>Ocultar Backtrack</span>
            </div>
            <button type="button" class="backtrack-modal-close" id="btn-close-hide-modal" aria-label="Fechar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div class="backtrack-modal-body">
            <p style="margin: 0 0 12px 0; color: #cbd5e1; font-size: 13px; line-height: 1.5;">
              O ícone do Backtrack será ocultado da tela.
            </p>
            <div style="background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;">
              <span style="display: block; font-weight: 600; color: #38bdf8; font-size: 12px; margin-bottom: 6px;">Para voltar a exibi-lo a qualquer momento:</span>
              <ul style="margin: 0; padding-left: 18px; color: #94a3b8; font-size: 12px; line-height: 1.6;">
                <li>Pressione o atalho: <strong style="color: #f8fafc; font-family: ui-monospace, monospace;">Ctrl + Shift + B</strong></li>
                <li>Ou execute o comando no console: <strong style="color: #f8fafc; font-family: ui-monospace, monospace;">Backtrack.show()</strong></li>
              </ul>
            </div>
          </div>
          <div class="backtrack-modal-footer">
            <button type="button" class="backtrack-btn-secondary" id="btn-cancel-hide-modal">Cancelar</button>
            <button type="button" class="backtrack-btn-primary" id="btn-confirm-hide-modal" style="background: #e11d48; border-color: #f43f5e;">
              Ocultar agora
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private updateDomValues(): void {
    if (!this.shadow) return;

    const panel = this.shadow.querySelector('.backtrack-panel');
    if (this.isOpen && !panel) {
      this.render();
      return;
    }

    if (!this.isOpen && panel) {
      this.render();
      return;
    }

    // Atualiza status dot do launcher
    const statusClass =
      this.health?.state === 'recording'
        ? 'backtrack-status-recording'
        : this.health?.state === 'degraded'
        ? 'backtrack-status-degraded'
        : 'backtrack-status-idle';
    const launcherDot = this.shadow.querySelector('.backtrack-launcher-status-dot');
    if (launcherDot) {
      launcherDot.className = `backtrack-launcher-status-dot ${statusClass}`;
    }

    // Atualiza badge de contagem no launcher
    const launcherBtn = this.shadow.getElementById('btn-launcher');
    if (launcherBtn) {
      let badge = launcherBtn.querySelector('.backtrack-incident-badge-count');
      if (this.incidents.length > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'backtrack-incident-badge-count';
          launcherBtn.appendChild(badge);
        }
        badge.textContent = String(this.incidents.length);
      } else if (badge) {
        badge.remove();
      }
    }

    // Se o painel está aberto, atualiza contadores e lista se não estiver em detalhe
    if (this.isOpen && panel) {
      const titleCount = this.shadow.getElementById('backtrack-saved-count-title');
      if (titleCount) {
        titleCount.textContent = String(this.incidents.length);
      }

      if (!this.selectedIncidentId) {
        const listContainer = this.shadow.getElementById('backtrack-incident-list-container');
        if (listContainer) {
          const currentIds = Array.from(
            listContainer.querySelectorAll('[data-open-detail-id]')
          )
            .map((el) => el.getAttribute('data-open-detail-id'))
            .join(',');
          const newIds = this.incidents
            .slice(0, 8)
            .map((inc) => inc.id)
            .join(',');

          if (currentIds !== newIds) {
            listContainer.innerHTML = this.renderIncidentsHtml();
            this.attachIncidentListeners();
          }
        }
      }
    }
  }

  private attachIncidentListeners(): void {
    if (!this.shadow) return;

    // Abrir detalhe ao clicar no item da lista
    this.shadow.querySelectorAll('[data-open-detail-id]').forEach((item) => {
      item.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-open-detail-id');
        if (id) {
          this.selectedIncidentId = id;
          this.render();
        }
      });
    });

    // Voltar da tela de detalhe para a lista
    this.shadow.getElementById('btn-back-to-list')?.addEventListener('click', () => {
      this.selectedIncidentId = null;
      this.render();
    });

    // Ações dentro da tela de detalhe
    this.shadow.querySelectorAll('[data-view-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-view-id');
        if (id) this.handleViewIncident(id);
      });
    });

    this.shadow.querySelectorAll('[data-share-gist-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-share-gist-id');
        if (id) this.handleShareGist(id);
      });
    });

    this.shadow.querySelectorAll('[data-download-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-download-id');
        if (id) this.handleDownloadIncident(id);
      });
    });

    this.shadow.querySelectorAll('[data-copy-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-copy-id');
        if (id) this.handleCopyMarkdown(id);
      });
    });

    this.shadow.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-delete-id');
        if (id) this.handleDeleteIncident(id);
      });
    });
  }

  private attachEventListeners(): void {
    if (!this.shadow) return;

    const launcher = this.shadow.getElementById('btn-launcher');
    if (launcher) {
      let touchStartX = 0;
      let touchStartY = 0;
      let initialLeft = 0;
      let initialTop = 0;
      let hasMoved = false;

      launcher.addEventListener(
        'touchstart',
        (e) => {
          if (e.touches.length === 1 && this.container) {
            const t = e.touches[0];
            touchStartX = t.clientX;
            touchStartY = t.clientY;
            const rect = this.container.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            hasMoved = false;
          }
        },
        { passive: true }
      );

      launcher.addEventListener(
        'touchmove',
        (e) => {
          if (e.touches.length === 1 && this.container) {
            const t = e.touches[0];
            const dx = t.clientX - touchStartX;
            const dy = t.clientY - touchStartY;
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
              hasMoved = true;
              this.container.style.left = `${initialLeft + dx}px`;
              this.container.style.top = `${initialTop + dy}px`;
              this.container.style.bottom = 'auto';
              this.container.style.right = 'auto';
            }
          }
        },
        { passive: true }
      );

      launcher.addEventListener('touchend', () => {
        if (hasMoved) {
          this.wasDragged = true;
          setTimeout(() => {
            this.wasDragged = false;
          }, 150);
        }
      });

      launcher.addEventListener('click', (e) => {
        if (this.wasDragged) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        this.toggleOpen();
      });
    }

    if (this.isOpen) {
      this.shadow.getElementById('btn-close')?.addEventListener('click', () => {
        this.toggleOpen();
      });

      this.shadow.getElementById('btn-dismiss-banner')?.addEventListener('click', () => {
        this.dismissBanner();
      });

      this.shadow.getElementById('btn-header-menu')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isHeaderMenuOpen = !this.isHeaderMenuOpen;
        this.render();
      });

      this.shadow.getElementById('btn-hide-widget')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isHeaderMenuOpen = false;
        this.showHideConfirmModal = true;
        this.render();
      });

      this.shadow.getElementById('btn-duration-60')?.addEventListener('click', () => {
        this.selectedDurationSeconds = 60;
        this.isCustomDuration = false;
        this.render();
      });

      this.shadow.getElementById('btn-duration-300')?.addEventListener('click', () => {
        this.selectedDurationSeconds = 300;
        this.isCustomDuration = false;
        this.render();
      });

      this.shadow.getElementById('btn-duration-all')?.addEventListener('click', () => {
        this.selectedDurationSeconds = 0;
        this.isCustomDuration = false;
        this.render();
      });

      this.shadow.getElementById('btn-duration-custom')?.addEventListener('click', () => {
        this.isCustomDuration = true;
        this.render();
      });

      const customInput = this.shadow.getElementById('input-custom-duration') as HTMLInputElement | null;
      if (customInput) {
        customInput.addEventListener('input', (e) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10);
          if (!isNaN(val)) {
            this.selectedDurationSeconds = Math.max(5, Math.min(900, val));
          }
        });
        customInput.addEventListener('change', (e) => {
          const val = parseInt((e.target as HTMLInputElement).value, 10);
          const clamped = isNaN(val) ? 60 : Math.max(5, Math.min(900, val));
          this.selectedDurationSeconds = clamped;
          customInput.value = String(clamped);
        });
      }

      this.shadow.getElementById('btn-save')?.addEventListener('click', () => {
        this.handleCapture();
      });

      this.shadow.getElementById('btn-annotate')?.addEventListener('click', () => {
        this.handleAnnotate();
      });

      this.shadow.getElementById('btn-clear')?.addEventListener('click', () => {
        this.handleClear();
      });

      this.attachIncidentListeners();

      if (this.exportModalIncidentId) {
        this.shadow.getElementById('btn-close-export-modal')?.addEventListener('click', () => {
          this.closeExportModal();
        });
        this.shadow.getElementById('btn-cancel-export-modal')?.addEventListener('click', () => {
          this.closeExportModal();
        });
        this.shadow.getElementById('check-include-incident-link')?.addEventListener('change', (e) => {
          this.exportModalIncludeLink = (e.target as HTMLInputElement).checked;
        });
        this.shadow.getElementById('btn-confirm-export-modal')?.addEventListener('click', () => {
          this.confirmCopyMarkdown();
        });
      }

      if (this.downloadModalIncidentId) {
        this.shadow.getElementById('btn-close-download-modal')?.addEventListener('click', () => {
          this.closeDownloadModal();
        });
        this.shadow.getElementById('btn-cancel-download-modal')?.addEventListener('click', () => {
          this.closeDownloadModal();
        });
        this.shadow.getElementById('radio-format-ai')?.addEventListener('change', () => {
          this.downloadModalFormat = 'ai';
          this.downloadModalError = null;
          this.render();
        });
        this.shadow.getElementById('radio-format-gzip')?.addEventListener('change', () => {
          this.downloadModalFormat = 'gzip';
          this.downloadModalError = null;
          this.render();
        });
        this.shadow.getElementById('radio-format-uncompressed')?.addEventListener('change', () => {
          this.downloadModalFormat = 'uncompressed';
          this.downloadModalError = null;
          this.render();
        });
        this.shadow.getElementById('btn-confirm-download-modal')?.addEventListener('click', () => {
          this.confirmDownload();
        });
      }

      if (this.showHideConfirmModal) {
        this.shadow.getElementById('btn-close-hide-modal')?.addEventListener('click', () => {
          this.showHideConfirmModal = false;
          this.render();
        });
        this.shadow.getElementById('btn-cancel-hide-modal')?.addEventListener('click', () => {
          this.showHideConfirmModal = false;
          this.render();
        });
        this.shadow.getElementById('btn-confirm-hide-modal')?.addEventListener('click', () => {
          this.showHideConfirmModal = false;
          this.hide();
        });
      }

      this.shadow.querySelector('.backtrack-panel')?.addEventListener('click', (e) => {
        if (this.isHeaderMenuOpen) {
          const target = e.target as HTMLElement | null;
          if (!target?.closest('.backtrack-header-menu-wrap')) {
            this.isHeaderMenuOpen = false;
            this.render();
          }
        }
      });
    }
  }
}
