export const WIDGET_CSS = `
/* ==========================================================================
   Backtrack Trigger Widget — Dark Theme Design System (Shadow DOM)
   ========================================================================== */

:host, .backtrack-root {
  --bt-surface-bg: #0f1117;
  --bt-surface-card: #161a23;
  --bt-surface-elevated: #1e2430;
  --bt-surface-input: #131720;
  --bt-border: #262d3d;
  --bt-border-subtle: #1c212c;
  --bt-text-primary: #f8fafc;
  --bt-text-muted: #94a3b8;
  --bt-text-dim: #64748b;
  --bt-accent: #2563eb;
  --bt-accent-hover: #1d4ed8;
  --bt-accent-muted: rgba(37, 99, 235, 0.16);
  --bt-status-online: #22c55e;
  --bt-radius-lg: 12px;
  --bt-radius-md: 8px;
  --bt-radius-sm: 6px;
  --bt-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --bt-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;

  all: initial;
  position: fixed;
  bottom: max(16px, env(safe-area-inset-bottom, 16px));
  left: max(16px, env(safe-area-inset-left, 16px));
  z-index: 999999;
  font-family: var(--bt-font);
  color: var(--bt-text-primary);
  box-sizing: border-box;
}

*, *::before, *::after {
  box-sizing: border-box;
}

.backtrack-root {
  position: relative;
}

/* Launcher Flutuante */
.backtrack-launcher-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  background-color: var(--bt-surface-bg);
  color: var(--bt-text-primary);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-sm);
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  user-select: none;
  touch-action: manipulation;
  outline: none;
}

.backtrack-launcher-btn:hover {
  background-color: var(--bt-surface-elevated);
  border-color: var(--bt-accent);
  color: var(--bt-accent);
}

.backtrack-launcher-btn:focus-visible {
  outline: 2px solid var(--bt-accent);
  outline-offset: 1px;
}

.backtrack-launcher-btn:active {
  transform: translateY(1px);
}

.backtrack-launcher-status-dot {
  position: absolute;
  bottom: 3px;
  right: 3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  border: 1px solid var(--bt-surface-bg);
  display: inline-block;
  pointer-events: none;
}

.backtrack-status-recording {
  background-color: #22c55e;
  box-shadow: 0 0 5px #22c55e;
}

.backtrack-status-degraded {
  background-color: #f59e0b;
  box-shadow: 0 0 4px #f59e0b;
}

.backtrack-status-idle {
  background-color: #64748b;
}

.backtrack-incident-badge-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: #ef4444;
  color: #ffffff;
  border: 1px solid var(--bt-surface-bg);
  border-radius: 4px;
  padding: 0 4px;
  font-family: var(--bt-font-mono);
  font-size: 9px;
  font-weight: 700;
  line-height: 13px;
  pointer-events: none;
}

/* Painel Modal / Drawer */
.backtrack-panel {
  position: fixed;
  bottom: 60px;
  left: 16px;
  width: 340px;
  max-height: 540px;
  background-color: var(--bt-surface-bg);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-lg);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.65);
  z-index: 999999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--bt-font);
  animation: backtrackFadeIn 0.15s ease-out;
}

@keyframes backtrackFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 1. Cabeçalho do Painel */
.backtrack-panel-header {
  background-color: transparent;
  border-bottom: 1px solid var(--bt-border);
  padding: 12px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.backtrack-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.backtrack-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--bt-text-primary);
  letter-spacing: -0.01em;
}

.backtrack-header-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--bt-status-online);
  flex-shrink: 0;
}

.backtrack-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.backtrack-header-icon-btn {
  background: transparent;
  border: none;
  color: var(--bt-text-muted);
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: color 0.12s ease;
  outline: none;
}

.backtrack-header-icon-btn:hover {
  color: var(--bt-text-primary);
}

.backtrack-storage-tooltip-trigger {
  color: var(--bt-text-muted);
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.12s ease;
}

.backtrack-storage-tooltip-trigger:hover {
  color: var(--bt-text-primary);
}

/* Menu de 3 Pontos do Cabeçalho */
.backtrack-header-menu-wrap {
  position: relative;
  display: inline-flex;
}

.backtrack-header-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-md);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.6);
  min-width: 190px;
  z-index: 1000;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.backtrack-header-menu-info {
  padding: 8px 10px 6px 10px;
  font-size: 11px;
  color: var(--bt-text-muted);
  font-family: var(--bt-font-mono);
  border-bottom: 1px solid var(--bt-border);
  margin-bottom: 4px;
}

.backtrack-header-menu-item {
  background: transparent;
  border: none;
  border-radius: var(--bt-radius-sm);
  padding: 8px 10px;
  color: var(--bt-text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background-color 0.1s ease, color 0.1s ease;
  width: 100%;
}

.backtrack-header-menu-item:hover {
  background-color: var(--bt-surface-elevated);
  color: #ffffff;
}

/* Corpo do Painel */
.backtrack-panel-body {
  padding: 12px 14px;
  overflow-y: auto;
  flex: 1;
  scrollbar-width: thin;
  scrollbar-color: #334155 transparent;
}

.backtrack-panel-body::-webkit-scrollbar {
  width: 5px;
}

.backtrack-panel-body::-webkit-scrollbar-track {
  background: transparent;
}

.backtrack-panel-body::-webkit-scrollbar-thumb {
  background-color: #334155;
  border-radius: 4px;
}

.backtrack-panel-body::-webkit-scrollbar-thumb:hover {
  background-color: #475569;
}

/* Alertas de Feedback */
.backtrack-alert {
  background-color: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: var(--bt-radius-sm);
  padding: 6px 10px;
  margin-bottom: 10px;
  font-size: 11px;
  font-weight: 500;
  color: #34d399;
}

/* 2. Seção de Controles de Gravação */
.backtrack-controls-section {
  margin-bottom: 16px;
}

.backtrack-section-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.backtrack-section-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--bt-text-muted);
}

.backtrack-help-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--bt-text-muted);
  cursor: help;
  font-size: 11px;
  transition: color 0.15s ease;
}

.backtrack-help-tooltip-trigger:hover {
  color: var(--bt-text-secondary);
}

.backtrack-duration-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}

.backtrack-duration-btn {
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-md);
  height: 32px;
  font-size: 12px;
  font-weight: 500;
  color: var(--bt-text-primary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
  user-select: none;
  outline: none;
}

.backtrack-duration-btn:hover {
  background-color: var(--bt-surface-elevated);
  border-color: #3b4252;
  color: #ffffff;
}

.backtrack-duration-btn.is-selected {
  background-color: var(--bt-accent-muted);
  border-color: var(--bt-accent);
  color: #60a5fa;
  font-weight: 600;
}

.backtrack-custom-duration-row {
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-sm);
  padding: 6px 10px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.backtrack-custom-input-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.backtrack-custom-duration-input {
  background-color: var(--bt-surface-input);
  border: 1px solid var(--bt-accent);
  border-radius: var(--bt-radius-sm);
  color: var(--bt-text-primary);
  font-family: var(--bt-font-mono);
  font-size: 12px;
  font-weight: 600;
  width: 65px;
  padding: 3px 6px;
  outline: none;
  text-align: right;
}

.backtrack-custom-duration-input:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.backtrack-custom-unit {
  font-size: 11px;
  color: var(--bt-text-muted);
}

.backtrack-custom-hint {
  font-size: 10.5px;
  color: var(--bt-text-dim);
  white-space: nowrap;
}

/* Linha de Ações */
.backtrack-actions-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.backtrack-btn-save {
  flex: 1;
  height: 36px;
  background-color: var(--bt-accent);
  color: #ffffff;
  border: 1px solid #3b82f6;
  border-radius: var(--bt-radius-md);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background-color 0.12s ease;
  user-select: none;
  outline: none;
}

.backtrack-btn-save:hover:not(:disabled) {
  background-color: var(--bt-accent-hover);
}

.backtrack-btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.backtrack-btn-icon-square {
  width: 36px;
  height: 36px;
  border-radius: var(--bt-radius-md);
  border: 1px solid var(--bt-border);
  background-color: var(--bt-surface-card);
  color: var(--bt-text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background-color 0.1s ease, border-color 0.1s ease, color 0.1s ease;
  outline: none;
  padding: 0;
}

.backtrack-btn-icon-square:hover:not(:disabled) {
  background-color: var(--bt-surface-elevated);
  border-color: #3b4252;
  color: #ffffff;
}

.backtrack-btn-icon-square:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 3. Seção de Lista de Gravações Salvas */
.backtrack-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.backtrack-list-title {
  font-size: 12px;
  font-weight: 500;
  color: var(--bt-text-muted);
}

.backtrack-list-count {
  font-size: 12px;
  font-weight: 500;
  color: var(--bt-text-muted);
}

.backtrack-list-item {
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-md);
  padding: 9px 12px;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  text-align: left;
  width: 100%;
  box-sizing: border-box;
}

.backtrack-list-item:hover {
  background-color: var(--bt-surface-elevated);
  border-color: #3b4252;
}

.backtrack-item-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.backtrack-item-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--bt-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.backtrack-item-meta {
  font-size: 12px;
  color: var(--bt-text-muted);
}

.backtrack-item-chevron {
  color: var(--bt-text-muted);
  flex-shrink: 0;
  margin-left: 8px;
  display: flex;
  align-items: center;
}

/* Estado Vazio */
.backtrack-empty-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background-color: var(--bt-surface-card);
  border: 1px dashed var(--bt-border);
  border-radius: var(--bt-radius-md);
  text-align: center;
}

.backtrack-empty-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--bt-text-primary);
  margin-top: 8px;
  margin-bottom: 2px;
}

.backtrack-empty-desc {
  font-size: 12px;
  color: var(--bt-text-muted);
  line-height: 1.4;
}

/* 4. Tela de Detalhe do Incidente */
.backtrack-detail-view {
  display: flex;
  flex-direction: column;
}

.backtrack-detail-back-row {
  margin-bottom: 14px;
}

.backtrack-btn-back {
  background: transparent;
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-sm);
  padding: 5px 10px;
  font-size: 13px;
  font-weight: 400;
  color: var(--bt-text-primary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background-color 0.12s ease, border-color 0.12s ease;
  outline: none;
}

.backtrack-btn-back:hover {
  background-color: var(--bt-surface-elevated);
  border-color: #3b4252;
}

.backtrack-detail-card {
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-md);
  padding: 10px 12px;
  margin-bottom: 18px;
}

.backtrack-detail-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--bt-text-primary);
  margin-bottom: 4px;
  line-height: 1.3;
}

.backtrack-detail-meta {
  font-size: 12px;
  color: var(--bt-text-muted);
  font-family: var(--bt-font-mono);
  letter-spacing: -0.01em;
}

/* CTA principal — Visualizar replay */
.backtrack-btn-cta-replay {
  width: 100%;
  height: 40px;
  background-color: var(--bt-accent);
  color: #ffffff;
  border: 1px solid #3b82f6;
  border-radius: var(--bt-radius-md);
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  transition: background-color 0.12s ease;
  user-select: none;
  outline: none;
  margin-bottom: 18px;
}

.backtrack-btn-cta-replay:hover {
  background-color: var(--bt-accent-hover);
}

/* Grupo "Exportar" (ações agrupadas) */
.backtrack-export-section {
  margin-bottom: 18px;
}

.backtrack-export-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--bt-text-muted);
  margin-bottom: 8px;
}

.backtrack-export-group {
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-md);
  overflow: hidden;
  background-color: transparent;
}

.backtrack-export-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--bt-border);
  color: var(--bt-text-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s ease;
  outline: none;
}

.backtrack-export-item:last-child {
  border-bottom: none;
}

.backtrack-export-item svg {
  color: var(--bt-text-muted);
  flex-shrink: 0;
  transition: color 0.12s ease;
}

.backtrack-export-item:hover {
  background-color: var(--bt-surface-elevated);
}

.backtrack-export-item:hover svg {
  color: var(--bt-text-primary);
}

/* Ação destrutiva — Excluir gravação */
.backtrack-destructive-section {
  border-top: 1px solid var(--bt-border);
  padding-top: 12px;
}

.backtrack-btn-delete-ghost {
  width: 100%;
  background: transparent;
  border: none;
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #ef4444;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
  text-align: left;
  transition: opacity 0.12s ease;
  outline: none;
}

.backtrack-btn-delete-ghost:hover {
  opacity: 0.8;
}

.backtrack-btn-delete-ghost svg {
  color: #ef4444;
  flex-shrink: 0;
}


/* Modais de Confirmação (Export, Download, Hide) */
.backtrack-modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bt-surface-bg);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  border-radius: var(--bt-radius-lg);
  padding: 0;
  overflow: hidden;
}

.backtrack-modal-card {
  width: 100%;
  height: 100%;
  max-width: 100%;
  background-color: var(--bt-surface-bg);
  border: none;
  border-radius: var(--bt-radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.backtrack-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--bt-border);
  background-color: var(--bt-surface-bg);
}

.backtrack-modal-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--bt-text-primary);
}

.backtrack-modal-close {
  background: transparent;
  border: none;
  color: var(--bt-text-muted);
  font-size: 14px;
  cursor: pointer;
  padding: 2px 4px;
  line-height: 1;
}

.backtrack-modal-close:hover {
  color: #f1f5f9;
}

.backtrack-modal-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #334155 transparent;
}

.backtrack-modal-body::-webkit-scrollbar {
  width: 5px;
}

.backtrack-modal-body::-webkit-scrollbar-track {
  background: transparent;
}

.backtrack-modal-body::-webkit-scrollbar-thumb {
  background-color: #334155;
  border-radius: 4px;
}

.backtrack-modal-body::-webkit-scrollbar-thumb:hover {
  background-color: #475569;
}

.backtrack-modal-checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.backtrack-modal-checkbox-label input[type="checkbox"] {
  margin-top: 2px;
  width: 15px;
  height: 15px;
  accent-color: var(--bt-accent);
  cursor: pointer;
}

.backtrack-modal-checkbox-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.backtrack-modal-checkbox-desc {
  margin: 3px 0 0 0;
  font-size: 11px;
  color: var(--bt-text-muted);
  line-height: 1.35;
}

.backtrack-modal-radio-label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--bt-border);
  border-radius: var(--bt-radius-sm);
  background-color: var(--bt-surface-card);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.1s ease, background-color 0.1s ease;
}

.backtrack-modal-radio-label:hover {
  background-color: var(--bt-surface-elevated);
}

.backtrack-modal-radio-label.is-selected {
  border-color: var(--bt-accent);
  background-color: var(--bt-accent-muted);
}

.backtrack-modal-radio-label input[type="radio"] {
  margin-top: 2px;
  width: 15px;
  height: 15px;
  accent-color: var(--bt-accent);
  cursor: pointer;
}

.backtrack-modal-radio-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.backtrack-modal-radio-desc {
  margin: 3px 0 0 0;
  font-size: 11px;
  color: var(--bt-text-muted);
  line-height: 1.35;
}

.backtrack-modal-error {
  padding: 6px 8px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 4px;
  color: #fca5a5;
  font-size: 11px;
}

.backtrack-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding: 10px 14px;
  border-top: 1px solid var(--bt-border);
  background-color: var(--bt-surface-bg);
}

.backtrack-btn-secondary {
  background-color: var(--bt-surface-card);
  border: 1px solid var(--bt-border);
  color: #cbd5e1;
  border-radius: var(--bt-radius-sm);
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.backtrack-btn-secondary:hover:not(:disabled) {
  background-color: var(--bt-surface-elevated);
  color: #f8fafc;
}

.backtrack-btn-primary {
  background-color: var(--bt-accent);
  border: 1px solid #3b82f6;
  color: #ffffff;
  border-radius: var(--bt-radius-sm);
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.backtrack-btn-primary:hover:not(:disabled) {
  background-color: var(--bt-accent-hover);
}

.backtrack-btn-primary:disabled,
.backtrack-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Responsividade Mobile e Safe Area */
@media (max-width: 480px) {
  .backtrack-panel {
    width: calc(100vw - 32px);
    max-width: calc(100vw - 16px);
    left: 8px;
    right: 8px;
    bottom: max(60px, env(safe-area-inset-bottom, 60px));
  }
}

.backtrack-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
`;
