import type { FlightRecorder, WidgetOptions } from '../types/options';
import type { IncidentSummary } from '../types/incident';
import type { RecorderHealth } from '../types/health';
import type { FlightRecorderArtifactV1 } from '../types/artifact';
import { WIDGET_CSS } from './styles';
import { ScreenAnnotator } from './annotator';
import { formatIncidentMarkdown } from '../utils/markdown';

export const DEFAULT_VIEWER_URL = 'http://localhost:5173';

export class BacktrackWidget {
  private recorder: FlightRecorder;
  private options: WidgetOptions;
  private container: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;

  private isOpen = false;
  private selectedDurationSeconds = 60; // 1m default
  private isCapturing = false;
  private isViewerOnline = false;
  private incidents: IncidentSummary[] = [];
  private health: RecorderHealth | null = null;
  private alertMessage: string | null = null;
  private openMenuId: string | null = null;
  private isCustomDuration = false;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(recorder: FlightRecorder, options?: WidgetOptions) {
    this.recorder = recorder;
    this.options = {
      position: options?.position ?? 'bottom-left',
      defaultViewerUrl: options?.defaultViewerUrl ?? DEFAULT_VIEWER_URL,
      zIndex: options?.zIndex ?? 999999
    };
  }

  public mount(): void {
    if (typeof document === 'undefined' || this.container) return;

    // Cria elemento hospedeiro com Shadow DOM para isolamento total de CSS
    const host = document.createElement('div');
    host.id = '__backtrack_widget_host__';
    this.applyHostPosition(host);

    this.shadow = host.attachShadow({ mode: 'open' });
    this.container = host;
    document.body.appendChild(host);

    this.render();
    this.updateData();
  }

  public unmount(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.shadow = null;
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

  private isCheckingViewer = false;
  private async checkViewerOnline(): Promise<boolean> {
    if (this.isCheckingViewer) return this.isViewerOnline;
    this.isCheckingViewer = true;
    const viewerUrl = this.options.defaultViewerUrl || DEFAULT_VIEWER_URL;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(viewerUrl, {
        method: 'GET',
        mode: 'no-cors',
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);
      return res.type === 'opaque' || res.ok || res.status === 200;
    } catch {
      return false;
    } finally {
      this.isCheckingViewer = false;
    }
  }

  private async updateData(): Promise<void> {
    try {
      this.health = this.recorder.getHealth();
      this.incidents = await this.recorder.listIncidents();
      if (this.isOpen) {
        this.isViewerOnline = await this.checkViewerOnline();
      }
      this.updateDomValues();
    } catch {
      // Ignora erro
    }
  }

  private async handleCapture(): Promise<void> {
    if (this.isCapturing) return;
    this.isCapturing = true;
    this.render();

    try {
      const id = await this.recorder.capture('Captura manual', this.selectedDurationSeconds);
      this.alertMessage = `Incidente ${id.substring(0, 14)}... gravado!`;
      await this.updateData();
    } catch (err) {
      this.alertMessage = 'Falha ao gravar incidente.';
    } finally {
      this.isCapturing = false;
      this.render();
      setTimeout(() => {
        this.alertMessage = null;
        this.render();
      }, 4000);
    }
  }

  private async handleClear(): Promise<void> {
    if (!confirm('Deseja limpar todos os dados de gravação e incidentes locais?')) return;
    try {
      await this.recorder.clear();
      this.alertMessage = 'Todos os dados locais foram limpos.';
      await this.updateData();
    } catch {
      this.alertMessage = 'Erro ao limpar dados.';
    } finally {
      setTimeout(() => {
        this.alertMessage = null;
        this.render();
      }, 3000);
    }
  }

  private async handleViewIncident(incidentId: string): Promise<void> {
    try {
      const artifact = await this.recorder.exportIncident(incidentId);
      this.openInViewer(artifact);
    } catch {
      alert('Não foi possível carregar o artefato do incidente.');
    }
  }

  private async handleDownloadIncident(incidentId: string): Promise<void> {
    try {
      await this.recorder.exportIncident(incidentId);
      this.alertMessage = 'Download do arquivo .ffr.json iniciado!';
      this.render();
      setTimeout(() => {
        this.alertMessage = null;
        this.render();
      }, 3000);
    } catch {
      alert('Falha ao exportar incidente.');
    }
  }

  private async handleCopyMarkdown(incidentId: string): Promise<void> {
    try {
      const artifact = await this.recorder.getArtifact(incidentId);
      const md = formatIncidentMarkdown(artifact);
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(md);
        this.alertMessage = 'Resumo Markdown copiado para o Jira/GitHub!';
      } else {
        this.alertMessage = 'Área de transferência indisponível.';
      }
      this.render();
      setTimeout(() => {
        this.alertMessage = null;
        this.render();
      }, 3500);
    } catch {
      alert('Falha ao gerar resumo Markdown.');
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
        this.alertMessage = 'Gravando incidente com anotação visual...';
        this.render();

        await this.recorder.capture('Anotação visual de bug na tela', this.selectedDurationSeconds);
        await this.updateData();
        this.alertMessage = 'Incidente com anotação visual gravado com sucesso!';
      } catch (err) {
        this.alertMessage = 'Falha ao salvar incidente com anotação.';
      } finally {
        this.isCapturing = false;
        this.render();
        setTimeout(() => {
          this.alertMessage = null;
          this.render();
        }, 3500);
      }
    });
  }

  private async handleDeleteIncident(incidentId: string): Promise<void> {
    try {
      await this.recorder.deleteIncident(incidentId);
      await this.updateData();
    } catch {
      alert('Falha ao excluir incidente.');
    }
  }

  private openInViewer(artifact: FlightRecorderArtifactV1): void {
    const viewerUrl = this.options.defaultViewerUrl || DEFAULT_VIEWER_URL;
    const win = window.open(viewerUrl, 'backtrack_viewer');
    if (!win) {
      alert('Pop-up bloqueado. Permita pop-ups para abrir o visualizador.');
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
    this.openMenuId = null;
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
            <div class="backtrack-panel-header">
              <div>
                <div class="backtrack-panel-title" id="backtrack-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <polyline points="3 3 3 8 8 8" />
                    <polygon points="10 9 15 12 10 15 10 9" fill="currentColor" stroke="none" />
                  </svg>
                  Backtrack
                </div>
                <div class="backtrack-panel-subtitle">
                  <span class="backtrack-viewer-status-wrap">
                    <span class="backtrack-status-dot ${this.isViewerOnline ? 'backtrack-status-online' : 'backtrack-status-offline'}"></span>
                    ${this.isViewerOnline ? 'Visualizador online' : 'Visualizador offline'} • ${this.formatBytes(this.health?.storageBytes ?? 0)}
                  </span>
                </div>
              </div>
              <button type="button" class="backtrack-close-btn" id="btn-close" aria-label="Fechar painel">×</button>
            </div>

            <div class="backtrack-panel-body">
              ${this.alertMessage ? `<div class="backtrack-alert">${this.alertMessage}</div>` : ''}

              <!-- Duração -->
              <div class="backtrack-duration-section">
                <div class="backtrack-section-title-row">
                  <div class="backtrack-section-title">Janela de Gravação</div>
                  <span
                    class="backtrack-help-tooltip-trigger"
                    title="Quanto tempo de histórico retroativo será gravado antes do clique (de 5 segundos até 15 minutos)."
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <span>O que é?</span>
                  </span>
                </div>
                <div class="backtrack-duration-group">
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
                    class="backtrack-duration-btn ${this.isCustomDuration ? 'is-selected' : ''}"
                    id="btn-duration-custom"
                  >
                    Custom
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
                        value="${this.selectedDurationSeconds}"
                        aria-label="Duração personalizada em segundos"
                      />
                      <span class="backtrack-custom-unit">segundos</span>
                    </div>
                    <span class="backtrack-custom-hint">5s a 900s (15 min)</span>
                  </div>
                `
                    : ''
                }
              </div>

              <!-- Ações -->
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
                  class="backtrack-btn-annotate"
                  id="btn-annotate"
                  title="Congelar e desenhar na tela antes de gravar"
                  ${this.isCapturing ? 'disabled' : ''}
                >
                  Anotar
                </button>
                <button type="button" class="backtrack-btn-clear" id="btn-clear" title="Limpar incidentes e buffer local">
                  Limpar
                </button>
              </div>

              <!-- Lista de Incidentes -->
              <div class="backtrack-section-title" id="backtrack-saved-count-title">Gravações Salvas (${incidentCount})</div>
              <div id="backtrack-incident-list-container">
                ${this.renderIncidentsHtml()}
              </div>
            </div>
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
      return `<div class="backtrack-empty-state">Nenhum incidente salvo nesta sessão.</div>`;
    }

    return this.incidents
      .slice(0, 8)
      .map((inc) => {
        const dateStr = new Date(inc.startedAt).toLocaleTimeString('pt-BR');
        const durationSec = inc.finalizedAt
          ? Math.max(1, Math.round((inc.finalizedAt - inc.startedAt) / 1000))
          : 0;
        return `
        <div class="backtrack-incident-card">
          <div>
            <div class="backtrack-incident-header-text">
              <span>${dateStr}</span>
              <span class="backtrack-duration-pill">${durationSec}s</span>
            </div>
            <div class="backtrack-incident-sub-id">${inc.id.substring(0, 16)}...</div>
          </div>
          <div class="backtrack-incident-actions">
            <button type="button" class="backtrack-action-btn backtrack-btn-view" data-view-id="${inc.id}" title="Abrir no visualizador offline">
              Visualizar
            </button>
            <div class="backtrack-menu-wrapper">
              <button
                type="button"
                class="backtrack-menu-trigger ${this.openMenuId === inc.id ? 'is-active' : ''}"
                data-menu-toggle-id="${inc.id}"
                title="Mais opções"
                aria-label="Mais opções"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2.2" />
                  <circle cx="12" cy="12" r="2.2" />
                  <circle cx="12" cy="19" r="2.2" />
                </svg>
              </button>
              <div class="backtrack-dropdown-menu ${this.openMenuId === inc.id ? 'is-open' : ''}" id="menu-${inc.id}">
                <button type="button" class="backtrack-dropdown-item" data-download-id="${inc.id}">
                  <span>⬇ Baixar (.ffr.json)</span>
                </button>
                <button type="button" class="backtrack-dropdown-item" data-copy-id="${inc.id}">
                  <span>📋 Copiar Markdown</span>
                </button>
                <div class="backtrack-dropdown-divider"></div>
                <button type="button" class="backtrack-dropdown-item is-danger" data-delete-id="${inc.id}">
                  <span>✕ Excluir</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
      })
      .join('');
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

    // Se o painel está aberto, atualiza texto e dot sem recriar o DOM
    if (this.isOpen && panel) {
      const statusWrap = this.shadow.querySelector('.backtrack-viewer-status-wrap');
      if (statusWrap) {
        statusWrap.innerHTML = `
          <span class="backtrack-status-dot ${this.isViewerOnline ? 'backtrack-status-online' : 'backtrack-status-offline'}"></span>
          ${this.isViewerOnline ? 'Visualizador online' : 'Visualizador offline'} • ${this.formatBytes(this.health?.storageBytes ?? 0)}
        `;
      }

      const titleCount = this.shadow.getElementById('backtrack-saved-count-title');
      if (titleCount) {
        titleCount.textContent = `Gravações Salvas (${this.incidents.length})`;
      }

      const listContainer = this.shadow.getElementById('backtrack-incident-list-container');
      if (listContainer) {
        const currentIds = Array.from(
          listContainer.querySelectorAll('[data-view-id]')
        )
          .map((el) => el.getAttribute('data-view-id'))
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

  private updateMenuVisibility(): void {
    if (!this.shadow) return;
    this.shadow.querySelectorAll('.backtrack-dropdown-menu').forEach((menu) => {
      const menuId = menu.id.replace('menu-', '');
      if (menuId === this.openMenuId) {
        menu.classList.add('is-open');
      } else {
        menu.classList.remove('is-open');
      }
    });
    this.shadow.querySelectorAll('.backtrack-menu-trigger').forEach((trigger) => {
      const triggerId = trigger.getAttribute('data-menu-toggle-id');
      if (triggerId === this.openMenuId) {
        trigger.classList.add('is-active');
      } else {
        trigger.classList.remove('is-active');
      }
    });
  }

  private attachIncidentListeners(): void {
    if (!this.shadow) return;

    this.shadow.querySelectorAll('[data-view-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLElement).getAttribute('data-view-id');
        if (id) this.handleViewIncident(id);
      });
    });

    this.shadow.querySelectorAll('[data-menu-toggle-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-menu-toggle-id');
        this.openMenuId = this.openMenuId === id ? null : id;
        this.updateMenuVisibility();
      });
    });

    this.shadow.querySelectorAll('[data-download-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-download-id');
        this.openMenuId = null;
        this.updateMenuVisibility();
        if (id) this.handleDownloadIncident(id);
      });
    });

    this.shadow.querySelectorAll('[data-copy-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-copy-id');
        this.openMenuId = null;
        this.updateMenuVisibility();
        if (id) this.handleCopyMarkdown(id);
      });
    });

    this.shadow.querySelectorAll('[data-delete-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-delete-id');
        this.openMenuId = null;
        this.updateMenuVisibility();
        if (id) this.handleDeleteIncident(id);
      });
    });
  }

  private attachEventListeners(): void {
    if (!this.shadow) return;

    this.shadow.getElementById('btn-launcher')?.addEventListener('click', () => {
      this.toggleOpen();
    });

    if (this.isOpen) {
      this.shadow.getElementById('btn-close')?.addEventListener('click', () => {
        this.toggleOpen();
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

      this.shadow.querySelector('.backtrack-panel')?.addEventListener('click', (e) => {
        if (this.openMenuId) {
          const target = e.target as HTMLElement | null;
          if (!target?.closest('.backtrack-menu-wrapper')) {
            this.openMenuId = null;
            this.updateMenuVisibility();
          }
        }
      });
    }
  }
}
