export const WIDGET_CSS = `
/* ==========================================================================
   Backtrack Trigger Widget — Forensic Console Design System (Shadow DOM)
   ========================================================================== */

:host {
  all: initial;
  position: fixed;
  bottom: max(16px, env(safe-area-inset-bottom, 16px));
  left: max(16px, env(safe-area-inset-left, 16px));
  z-index: 999999;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #cbd5e1;
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
  background-color: #0f172a;
  color: #f8fafc;
  border: 1px solid #334155;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5);
  transition: background-color 0.1s ease, border-color 0.1s ease;
  user-select: none;
  touch-action: manipulation;
  outline: none;
}

.backtrack-launcher-btn:hover {
  background-color: #1e293b;
  border-color: #3b82f6;
  color: #3b82f6;
}

.backtrack-launcher-btn:focus-visible {
  outline: 2px solid #3b82f6;
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
  border: 1px solid #0f172a;
  display: inline-block;
  pointer-events: none;
}

.backtrack-status-recording { background-color: #10b981; }
.backtrack-status-pending { background-color: #f59e0b; }
.backtrack-status-degraded { background-color: #ef4444; }
.backtrack-status-idle { background-color: #64748b; }

.backtrack-status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.backtrack-status-online { background-color: #10b981; }
.backtrack-status-offline { background-color: #64748b; }

.backtrack-incident-badge-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: #ef4444;
  color: #ffffff;
  border: 1px solid #0f172a;
  border-radius: 4px;
  padding: 0 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
  width: 380px;
  max-height: 520px;
  background-color: #0f172a;
  border: 1px solid #334155;
  border-radius: 6px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.7);
  z-index: 999999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: backtrackFadeIn 0.15s ease-out;
}

@keyframes backtrackFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Cabeçalho do Painel */
.backtrack-panel-header {
  background-color: #162032;
  border-bottom: 1px solid #1e293b;
  padding: 10px 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.backtrack-panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #f8fafc;
  letter-spacing: -0.01em;
}

.backtrack-panel-subtitle {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  color: #94a3b8;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.backtrack-viewer-status-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
}

.backtrack-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.backtrack-hide-btn,
.backtrack-close-btn {
  background-color: transparent;
  border: 1px solid #334155;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  color: #94a3b8;
  transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
  outline: none;
}

.backtrack-hide-btn:hover,
.backtrack-close-btn:hover {
  background-color: #1e293b;
  border-color: #475569;
  color: #f8fafc;
}

.backtrack-close-btn:hover {
  background-color: #1e293b;
  color: #ffffff;
  border-color: #475569;
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

.backtrack-storage-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #64748b;
  cursor: help;
  user-select: none;
  border-radius: 50%;
  padding: 1px;
  margin-left: 2px;
  vertical-align: middle;
  transition: color 0.15s ease;
}

.backtrack-storage-tooltip-trigger:hover {
  color: #38bdf8;
}

.backtrack-config-viewer-btn {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 1px 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  border-radius: 3px;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.backtrack-config-viewer-btn:hover {
  color: #38bdf8;
  background-color: rgba(56, 189, 248, 0.12);
}

/* Alertas de Feedback */
.backtrack-alert {
  background-color: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #34d399;
}

/* Seletor de Duração */
.backtrack-duration-section {
  margin-bottom: 12px;
}

.backtrack-section-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.backtrack-section-title {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  margin-bottom: 0;
}

.backtrack-help-tooltip-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  color: #38bdf8;
  cursor: help;
  user-select: none;
  background-color: rgba(56, 189, 248, 0.08);
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 3px;
  padding: 1px 6px;
  transition: background-color 0.1s ease, color 0.1s ease;
}

.backtrack-help-tooltip-trigger:hover {
  background-color: rgba(56, 189, 248, 0.18);
  color: #7dd3fc;
  border-color: #38bdf8;
}

.backtrack-duration-group {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.backtrack-duration-btn {
  flex: 1;
  background-color: #0b0f17;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 5px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  color: #94a3b8;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
  user-select: none;
  outline: none;
}

.backtrack-duration-btn:hover {
  background-color: #1e293b;
  color: #ffffff;
}

.backtrack-duration-btn.is-selected {
  background-color: #1e293b;
  color: #f8fafc;
  border-color: #3b82f6;
  font-weight: 600;
}

.backtrack-custom-duration-row {
  background-color: #0b0f17;
  border: 1px solid #334155;
  border-radius: 4px;
  padding: 6px 10px;
  margin-bottom: 8px;
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
  background-color: #162032;
  border: 1px solid #3b82f6;
  border-radius: 4px;
  color: #f8fafc;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  color: #94a3b8;
}

.backtrack-custom-hint {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  color: #64748b;
  white-space: nowrap;
}

/* Ações Principais */
.backtrack-actions-row {
  display: flex;
  gap: 8px;
  margin-bottom: 14px;
}

.backtrack-btn-save {
  flex: 1;
  background-color: #2563eb;
  color: #ffffff;
  border: 1px solid #1d4ed8;
  border-radius: 6px;
  padding: 7px 12px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: background-color 0.1s ease;
  user-select: none;
  outline: none;
}

.backtrack-btn-save:hover:not(:disabled) {
  background-color: #1d4ed8;
}

.backtrack-btn-save:disabled {
  background-color: #1e293b;
  color: #64748b;
  border-color: #334155;
  cursor: not-allowed;
}

.backtrack-btn-clear {
  background-color: #1e293b;
  color: #cbd5e1;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease;
  outline: none;
}

.backtrack-btn-clear:hover {
  background-color: #334155;
  color: #ffffff;
}

/* Lista de Incidentes */
.backtrack-incident-card {
  background-color: #162032;
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 7px 9px;
  margin-bottom: 5px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: background-color 0.1s ease, border-color 0.1s ease;
}

.backtrack-incident-card:hover {
  background-color: #1a273e;
  border-color: #334155;
}

.backtrack-incident-header-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #f8fafc;
}

.backtrack-duration-pill {
  background-color: #0f172a;
  color: #38bdf8;
  border: 1px solid #1e293b;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 500;
  padding: 1px 5px;
}

.backtrack-incident-sub-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10px;
  color: #64748b;
  margin-top: 1px;
}

.backtrack-incident-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.backtrack-action-btn {
  border-radius: 4px;
  padding: 3px 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 10.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.1s ease;
  user-select: none;
  outline: none;
}

.backtrack-btn-view {
  background-color: #1e293b;
  color: #38bdf8;
  border: 1px solid #334155;
  padding: 4px 9px;
}

.backtrack-btn-view:hover {
  background-color: #27354f;
  color: #ffffff;
  border-color: #38bdf8;
}

/* Menu de 3 Pontos e Dropdown */
.backtrack-menu-wrapper {
  position: relative;
  display: inline-block;
}

.backtrack-menu-trigger {
  background-color: transparent;
  border: 1px solid transparent;
  color: #94a3b8;
  border-radius: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.1s ease, color 0.1s ease, border-color 0.1s ease;
  outline: none;
  padding: 0;
}

.backtrack-menu-trigger:hover,
.backtrack-menu-trigger.is-active {
  background-color: #1e293b;
  color: #f8fafc;
  border-color: #334155;
}

.backtrack-dropdown-menu {
  display: none;
  position: absolute;
  right: 0;
  top: calc(100% + 4px);
  background-color: #0b0f17;
  border: 1px solid #334155;
  border-radius: 6px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
  min-width: 165px;
  z-index: 100;
  padding: 4px;
}

.backtrack-dropdown-menu.is-open {
  display: flex;
  flex-direction: column;
}

.backtrack-dropdown-item {
  background: transparent;
  border: none;
  border-radius: 4px;
  padding: 7px 10px;
  color: #cbd5e1;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background-color 0.1s ease, color 0.1s ease;
  outline: none;
  white-space: nowrap;
  width: 100%;
}

.backtrack-dropdown-item:hover {
  background-color: #1e293b;
  color: #f8fafc;
}

.backtrack-dropdown-item.is-danger {
  color: #ef4444;
}

.backtrack-dropdown-item.is-danger:hover {
  background-color: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.backtrack-dropdown-divider {
  height: 1px;
  background-color: #1e293b;
  margin: 3px 0;
}

.backtrack-btn-annotate {
  background-color: #1e293b;
  border: 1px solid #334155;
  color: #f59e0b;
  border-radius: 4px;
  padding: 6px 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.1s ease, border-color 0.1s ease;
}

.backtrack-btn-annotate:hover {
  background-color: #27354f;
  border-color: #f59e0b;
  color: #fbbf24;
}

.backtrack-empty-state {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #64748b;
  text-align: center;
  padding: 16px 0;
  background-color: #0b0f17;
  border: 1px dashed #334155;
  border-radius: 4px;
}

/* Modal de Confirmação e Opções de Exportação */
.backtrack-modal-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #0b0f17;
  display: flex;
  flex-direction: column;
  z-index: 1000;
  border-radius: 8px;
  padding: 0;
  overflow: hidden;
}

.backtrack-modal-card {
  width: 100%;
  height: 100%;
  max-width: 100%;
  background-color: #0b0f17;
  border: none;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.backtrack-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #1e293b;
  background-color: #0b0f17;
}

.backtrack-modal-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #f8fafc;
}

.backtrack-modal-close {
  background: transparent;
  border: none;
  color: #94a3b8;
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
  accent-color: #2563eb;
  cursor: pointer;
}

.backtrack-modal-checkbox-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
}

.backtrack-modal-checkbox-desc {
  margin: 2px 0 0 0;
  font-size: 11px;
  color: #94a3b8;
  line-height: 1.35;
}

.backtrack-modal-radio-label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #1e293b;
  border-radius: 6px;
  background-color: #0b0f17;
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}

.backtrack-modal-radio-label:hover {
  border-color: #3b82f6;
  background-color: #111827;
}

.backtrack-modal-radio-label.is-selected {
  border-color: #2563eb;
  background-color: rgba(37, 99, 235, 0.1);
}

.backtrack-modal-radio-label input[type="radio"] {
  margin-top: 2px;
  width: 15px;
  height: 15px;
  accent-color: #2563eb;
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
  color: #94a3b8;
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
  padding: 8px 14px;
  border-top: 1px solid #1e293b;
  background-color: #0b0f17;
}

.backtrack-btn-secondary {
  background-color: #1e293b;
  border: 1px solid #334155;
  color: #cbd5e1;
  border-radius: 4px;
  padding: 5px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
}

.backtrack-btn-secondary:hover:not(:disabled) {
  background-color: #334155;
  color: #f8fafc;
}

.backtrack-btn-primary {
  background-color: #2563eb;
  border: 1px solid #3b82f6;
  color: #ffffff;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.backtrack-btn-primary:hover:not(:disabled) {
  background-color: #1d4ed8;
}

.backtrack-btn-primary:disabled,
.backtrack-btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ==========================================================================
   Mobile & Responsive Adaptations (<= 480px)
   ========================================================================== */
@media (max-width: 480px) {
  .backtrack-panel {
    left: 8px !important;
    right: 8px !important;
    width: auto !important;
    max-width: calc(100vw - 16px) !important;
    bottom: max(56px, calc(env(safe-area-inset-bottom, 0px) + 56px)) !important;
    max-height: calc(100vh - 76px) !important;
    border-radius: 8px;
  }

  .backtrack-modal-card {
    width: 100% !important;
    max-width: 100% !important;
    margin: 0 !important;
  }

  .backtrack-modal-body {
    padding: 12px !important;
  }

  .backtrack-duration-group {
    flex-wrap: wrap;
  }

  .backtrack-actions-row {
    gap: 6px;
  }

  .backtrack-btn-save,
  .backtrack-action-btn,
  .backtrack-btn-clear {
    min-height: 36px;
  }
}
`;
