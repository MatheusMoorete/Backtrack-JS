export interface ScreenAnnotatorResult {
  dataUrl: string;
  notes?: string;
}

export type AnnotatorTool = 'select' | 'pen' | 'rect' | 'arrow' | 'ruler' | 'text';

export interface AnnotationItem {
  id: string;
  type: AnnotatorTool;
  color: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  text?: string;
  note?: string;
  label?: string;
  points?: { x: number; y: number }[];
}

export class ScreenAnnotator {
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tool: AnnotatorTool = 'pen';
  private color = '#ef4444'; // Vermelho padrão para bugs

  // Itens vetoriais desenhados
  private items: AnnotationItem[] = [];
  private historyStack: AnnotationItem[][] = [];
  private selectedItemId: string | null = null;

  // Estado de desenho e arrasto
  private isMouseDown = false;
  private isDraggingItem = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private activeDrawStart = { x: 0, y: 0 };
  private activePoints: { x: number; y: number }[] = [];

  // Popover ativo
  private activePopover: HTMLDivElement | null = null;
  private onComplete: ((result: ScreenAnnotatorResult | null) => void) | null = null;

  public open(onComplete: (result: ScreenAnnotatorResult | null) => void): void {
    if (this.overlay) return;
    this.onComplete = onComplete;
    this.items = [];
    this.historyStack = [[]];
    this.selectedItemId = null;

    // Overlay de fundo com bloqueio estrito contra captura rrweb
    const overlay = document.createElement('div');
    overlay.id = '__backtrack_annotator_overlay__';
    overlay.className = 'backtrack-ignore backtrack-block rr-ignore rr-block';
    overlay.setAttribute('data-rr-ignore', 'true');
    overlay.setAttribute('data-backtrack-ignore', 'true');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.28);
      cursor: crosshair;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const canvas = document.createElement('canvas');
    canvas.className = 'backtrack-ignore backtrack-block rr-ignore rr-block';
    canvas.setAttribute('data-rr-ignore', 'true');
    canvas.setAttribute('data-backtrack-ignore', 'true');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    `;
    overlay.appendChild(canvas);

    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    this.ctx = ctx;
    this.canvas = canvas;
    this.overlay = overlay;

    // Barra de ferramentas flutuante
    const toolbar = document.createElement('div');
    toolbar.className = 'backtrack-ignore backtrack-block rr-ignore rr-block';
    toolbar.setAttribute('data-rr-ignore', 'true');
    toolbar.setAttribute('data-backtrack-ignore', 'true');
    toolbar.style.cssText = `
      position: fixed;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 5px;
      background: #0f172a;
      padding: 5px 8px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(0,0,0,0.4);
      color: #fff;
      font-size: 13px;
      z-index: 2147483648;
      backdrop-filter: blur(12px);
    `;

    // Ícones no padrão estrito dos prints do usuário + ferramenta de seleção para arrastar
    toolbar.innerHTML = `
      <!-- Mover / Selecionar (V) -->
      <button type="button" id="btn-tool-select" class="backtrack-tool-btn" title="Selecionar e mover elementos (V)" style="${this.getToolBtnStyle(false)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 3l7 18 3-7 7-3L3 3z"/>
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">V</span>
      </button>

      <!-- Caneta (P) -->
      <button type="button" id="btn-tool-pen" class="backtrack-tool-btn active" title="Caneta livre (P)" style="${this.getToolBtnStyle(true)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">P</span>
      </button>

      <!-- Seta (A) -->
      <button type="button" id="btn-tool-arrow" class="backtrack-tool-btn" title="Seta indicadora (A)" style="${this.getToolBtnStyle(false)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="5" y1="12" x2="19" y2="12"/>
          <polyline points="12 5 19 12 12 19"/>
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">A</span>
      </button>

      <!-- Retângulo (R) -->
      <button type="button" id="btn-tool-rect" class="backtrack-tool-btn" title="Retângulo (R)" style="${this.getToolBtnStyle(false)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" ry="3.5"/>
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">R</span>
      </button>

      <!-- Régua de QA (M) -->
      <button type="button" id="btn-tool-ruler" class="backtrack-tool-btn" title="Régua de medição em pixels (M)" style="${this.getToolBtnStyle(false)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2.5" y="7" width="19" height="10" rx="2" />
          <line x1="6.5" y1="7" x2="6.5" y2="11.5" />
          <line x1="10.5" y1="7" x2="10.5" y2="13.5" />
          <line x1="14.5" y1="7" x2="14.5" y2="11.5" />
          <line x1="18.5" y1="7" x2="18.5" y2="13.5" />
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">M</span>
      </button>

      <!-- Texto (T) -->
      <button type="button" id="btn-tool-text" class="backtrack-tool-btn" title="Anotação de texto (T)" style="${this.getToolBtnStyle(false)}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 7 4 4 20 4 20 7"/>
          <line x1="12" y1="4" x2="12" y2="20"/>
          <line x1="8" y1="20" x2="16" y2="20"/>
        </svg>
        <span style="${this.getShortcutBadgeStyle()}">T</span>
      </button>
      
      <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.12); margin: 0 3px;"></div>

      <!-- Cores de destaque -->
      <div style="display: flex; align-items: center; gap: 4px; padding: 0 2px;">
        <button type="button" class="backtrack-color-btn" data-color="#ef4444" title="Vermelho (Bug)" style="${this.getColorBtnStyle('#ef4444', true)}"></button>
        <button type="button" class="backtrack-color-btn" data-color="#f59e0b" title="Amarelo (Atenção)" style="${this.getColorBtnStyle('#f59e0b', false)}"></button>
        <button type="button" class="backtrack-color-btn" data-color="#3b82f6" title="Azul (Medição)" style="${this.getColorBtnStyle('#3b82f6', false)}"></button>
        <button type="button" class="backtrack-color-btn" data-color="#10b981" title="Verde (Ajuste)" style="${this.getColorBtnStyle('#10b981', false)}"></button>
      </div>

      <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.12); margin: 0 3px;"></div>

      <!-- Voltar / Desfazer (Undo) -->
      <button type="button" id="btn-undo" title="Desfazer (Ctrl+Z)" style="${this.getActionBtnStyle()}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 7v6h6"/>
          <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
        </svg>
      </button>

      <!-- Limpar tudo com ícone de Espanador -->
      <button type="button" id="btn-clear" title="Limpar tudo (Espanador)" style="${this.getActionBtnStyle()}">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="20" y1="20" x2="13" y2="13" stroke-width="2.5"/>
          <circle cx="13" cy="13" r="1.5" fill="currentColor"/>
          <path d="M13 13c-2-4-5-8-10-8 0 5 4 8 8 10"/>
          <path d="M12 11C9 8 7 5 3 4c2 5 5 8 9 9"/>
          <path d="M14 10c0-5-2-8-6-9 1 4 4 7 7 8"/>
          <path d="M10 14c-5 0-8-2-9-6 4 1 7 4 8 7"/>
        </svg>
      </button>
      
      <div style="width: 1px; height: 20px; background: rgba(255,255,255,0.12); margin: 0 3px;"></div>

      <!-- Salvar e Gravar -->
      <button type="button" id="btn-done" style="background: #10b981; color: white; border: none; padding: 6px 14px; border-radius: 7px; cursor: pointer; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 5px; box-shadow: 0 2px 8px rgba(16,185,129,0.35);">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <span>Salvar</span>
      </button>

      <!-- Cancelar (X menor no canto) -->
      <button type="button" id="btn-cancel" title="Fechar (Esc)" style="background: transparent; color: #64748b; border: none; padding: 5px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-left: 2px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;
    overlay.appendChild(toolbar);

    document.body.appendChild(overlay);

    // Eventos da toolbar
    this.setupToolbarEvents(toolbar);

    // Atalhos de teclado (V = Select/Move, P = Pen, A = Arrow, R = Rect, M = Ruler, T = Text, Del = Excluir selecionado)
    const keyHandler = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.closePopover();
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
        if (this.onComplete) this.onComplete(null);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedItemId) {
          e.preventDefault();
          this.items = this.items.filter((it) => it.id !== this.selectedItemId);
          this.selectedItemId = null;
          this.recordHistory();
          this.redraw();
        }
      } else {
        const key = e.key.toLowerCase();
        if (key === 'v') this.selectTool('select', toolbar);
        else if (key === 'p') this.selectTool('pen', toolbar);
        else if (key === 'a') this.selectTool('arrow', toolbar);
        else if (key === 'r') this.selectTool('rect', toolbar);
        else if (key === 'm') this.selectTool('ruler', toolbar);
        else if (key === 't') this.selectTool('text', toolbar);
      }
    };
    window.addEventListener('keydown', keyHandler);

    // Eventos do Mouse no Canvas
    canvas.addEventListener('mousedown', (e) => {
      this.closePopover();
      const x = e.clientX;
      const y = e.clientY;

      // Verifica se clicou em cima de um elemento existente
      const hitItem = this.findItemAt(x, y);

      // Se a ferramenta atual é 'select', ou se clicou em um item já desenhado
      if (this.tool === 'select' || (hitItem && this.tool !== 'pen')) {
        if (hitItem) {
          this.selectedItemId = hitItem.id;
          this.isDraggingItem = true;
          this.dragStartX = x;
          this.dragStartY = y;
          canvas.style.cursor = 'grabbing';
          this.redraw();
          return;
        }
        this.selectedItemId = null;
        this.redraw();
        if (this.tool === 'select') return;
      }

      if (this.tool === 'text') {
        this.openTextInput(x, y);
        return;
      }

      this.isMouseDown = true;
      this.activeDrawStart = { x, y };
      this.dragStartX = x;
      this.dragStartY = y;

      if (this.tool === 'pen') {
        this.activePoints = [{ x, y }];
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      const x = e.clientX;
      const y = e.clientY;

      // 1. Se estiver arrastando um elemento existente
      if (this.isDraggingItem && this.selectedItemId) {
        const item = this.items.find((it) => it.id === this.selectedItemId);
        if (item) {
          const dx = x - this.dragStartX;
          const dy = y - this.dragStartY;
          this.dragStartX = x;
          this.dragStartY = y;

          item.x1 += dx;
          item.y1 += dy;
          item.x2 += dx;
          item.y2 += dy;

          if (item.points) {
            item.points.forEach((p) => {
              p.x += dx;
              p.y += dy;
            });
          }

          this.redraw();
          return;
        }
      }

      // 2. Se estiver desenhando um novo elemento
      if (this.isMouseDown) {
        if (this.tool === 'pen') {
          this.activePoints.push({ x, y });
          this.redraw();
          // Linha ativa
          this.drawLivePen(this.activePoints, this.color);
        } else if (this.tool === 'rect') {
          this.redraw();
          this.drawLiveRect(this.activeDrawStart.x, this.activeDrawStart.y, x, y, this.color);
        } else if (this.tool === 'arrow') {
          this.redraw();
          this.drawLiveArrow(this.activeDrawStart.x, this.activeDrawStart.y, x, y, this.color);
        } else if (this.tool === 'ruler') {
          this.redraw();
          this.drawLiveRuler(this.activeDrawStart.x, this.activeDrawStart.y, x, y, this.color);
        }
        return;
      }

      // 3. Hover: atualiza cursor conforme proximidade de itens
      if (this.tool === 'select') {
        const hit = this.findItemAt(x, y);
        canvas.style.cursor = hit ? 'grab' : 'default';
      } else {
        const hit = this.findItemAt(x, y);
        canvas.style.cursor = hit ? 'grab' : 'crosshair';
      }
    });

    canvas.addEventListener('mouseup', (e) => {
      const x = e.clientX;
      const y = e.clientY;

      if (this.isDraggingItem) {
        this.isDraggingItem = false;
        canvas.style.cursor = 'grab';
        this.recordHistory();
        return;
      }

      if (!this.isMouseDown) return;
      this.isMouseDown = false;

      const sx = this.activeDrawStart.x;
      const sy = this.activeDrawStart.y;

      if (this.tool === 'pen') {
        if (this.activePoints.length > 1) {
          const newItem: AnnotationItem = {
            id: `item_${Date.now()}_${Math.random()}`,
            type: 'pen',
            color: this.color,
            x1: sx,
            y1: sy,
            x2: x,
            y2: y,
            points: [...this.activePoints]
          };
          this.items.push(newItem);
          this.selectedItemId = newItem.id;
          this.recordHistory();
        }
        this.activePoints = [];
        this.redraw();
      } else if (this.tool === 'rect') {
        if (Math.hypot(x - sx, y - sy) >= 4) {
          const newItem: AnnotationItem = {
            id: `item_${Date.now()}_${Math.random()}`,
            type: 'rect',
            color: this.color,
            x1: sx,
            y1: sy,
            x2: x,
            y2: y
          };
          this.items.push(newItem);
          this.selectedItemId = newItem.id;
          this.recordHistory();
        }
        this.redraw();
      } else if (this.tool === 'arrow') {
        if (Math.hypot(x - sx, y - sy) >= 6) {
          const newItem: AnnotationItem = {
            id: `item_${Date.now()}_${Math.random()}`,
            type: 'arrow',
            color: this.color,
            x1: sx,
            y1: sy,
            x2: x,
            y2: y
          };
          this.items.push(newItem);
          this.selectedItemId = newItem.id;
          this.recordHistory();
        }
        this.redraw();
      } else if (this.tool === 'ruler') {
        if (Math.hypot(x - sx, y - sy) < 4) {
          this.redraw();
          return;
        }

        const dx = x - sx;
        const dy = y - sy;
        const absDx = Math.round(Math.abs(dx));
        const absDy = Math.round(Math.abs(dy));

        let defaultNote = '';
        let label = '';
        if (absDy >= absDx) {
          const dir = dy >= 0 ? 'bottom' : 'top';
          defaultNote = `mudar isso ${absDy}px para ${dir}`;
          label = `${absDy}px ${dy >= 0 ? '↓' : '↑'} ${dir}`;
        } else {
          const dir = dx >= 0 ? 'right' : 'left';
          defaultNote = `mudar isso ${absDx}px para ${dir}`;
          label = `${absDx}px ${dx >= 0 ? '→' : '←'} ${dir}`;
        }

        const newItem: AnnotationItem = {
          id: `item_${Date.now()}_${Math.random()}`,
          type: 'ruler',
          color: this.color,
          x1: sx,
          y1: sy,
          x2: x,
          y2: y,
          note: defaultNote,
          label
        };
        this.items.push(newItem);
        this.selectedItemId = newItem.id;
        this.recordHistory();
        this.redraw();

        // Abre popover rápido para o QA personalizar a mensagem
        this.openRulerConfirmPopover(newItem);
      }
    });
  }

  private getToolBtnStyle(isActive: boolean): string {
    const bg = isActive ? '#3b82f6' : '#1e293b';
    const border = isActive ? '1px solid #60a5fa' : '1px solid #334155';
    const shadow = isActive ? 'box-shadow: 0 0 10px rgba(59, 130, 246, 0.4);' : '';
    return `width: 35px; height: 35px; border-radius: 7px; display: flex; align-items: center; justify-content: center; position: relative; border: ${border}; background: ${bg}; color: #ffffff; cursor: pointer; padding: 0; ${shadow} transition: all 0.15s ease;`;
  }

  private getShortcutBadgeStyle(): string {
    return 'position: absolute; bottom: 2px; right: 3px; font-size: 9px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: rgba(255,255,255,0.6); font-weight: 600; line-height: 1; pointer-events: none;';
  }

  private getColorBtnStyle(color: string, isSelected: boolean): string {
    const ring = isSelected ? 'box-shadow: 0 0 0 2px #fff;' : 'opacity: 0.75;';
    return `width: 19px; height: 19px; border-radius: 50%; background: ${color}; border: none; cursor: pointer; ${ring} transition: transform 0.15s ease;`;
  }

  private getActionBtnStyle(): string {
    return 'width: 33px; height: 33px; border-radius: 7px; display: flex; align-items: center; justify-content: center; border: 1px solid #334155; background: #1e293b; color: #cbd5e1; cursor: pointer; padding: 0; transition: background 0.15s ease;';
  }

  private selectTool(toolName: AnnotatorTool, toolbar: HTMLDivElement): void {
    this.tool = toolName;
    const tools: AnnotatorTool[] = ['select', 'pen', 'arrow', 'rect', 'ruler', 'text'];
    tools.forEach((t) => {
      const b = toolbar.querySelector(`#btn-tool-${t}`) as HTMLButtonElement;
      if (b) {
        const isCurrent = t === toolName;
        b.style.background = isCurrent ? '#3b82f6' : '#1e293b';
        b.style.borderColor = isCurrent ? '#60a5fa' : '#334155';
        b.style.boxShadow = isCurrent ? '0 0 10px rgba(59, 130, 246, 0.4)' : 'none';
      }
    });

    if (this.canvas) {
      this.canvas.style.cursor = toolName === 'select' ? 'default' : 'crosshair';
    }
  }

  private setupToolbarEvents(toolbar: HTMLDivElement): void {
    const tools: AnnotatorTool[] = ['select', 'pen', 'arrow', 'rect', 'ruler', 'text'];

    tools.forEach((toolName) => {
      const btn = toolbar.querySelector(`#btn-tool-${toolName}`) as HTMLButtonElement;
      btn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectTool(toolName, toolbar);
      });
    });

    // Cores
    const colorBtns = toolbar.querySelectorAll('.backtrack-color-btn') as NodeListOf<HTMLButtonElement>;
    colorBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedColor = btn.getAttribute('data-color') || '#ef4444';
        this.color = selectedColor;

        // Se houver item selecionado, atualiza sua cor
        if (this.selectedItemId) {
          const it = this.items.find((item) => item.id === this.selectedItemId);
          if (it) {
            it.color = selectedColor;
            this.redraw();
            this.recordHistory();
          }
        }

        colorBtns.forEach((b) => {
          b.style.boxShadow = 'none';
          b.style.opacity = '0.75';
        });
        btn.style.boxShadow = '0 0 0 2px #fff';
        btn.style.opacity = '1';
      });
    });

    // Desfazer
    toolbar.querySelector('#btn-undo')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.undo();
    });

    // Limpar tudo (Espanador)
    toolbar.querySelector('#btn-clear')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clear();
    });

    // Salvar e Gravar
    toolbar.querySelector('#btn-done')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleDone();
    });

    // Cancelar (X menor)
    toolbar.querySelector('#btn-cancel')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      if (this.onComplete) this.onComplete(null);
    });
  }

  private handleDone(): void {
    this.closePopover();
    this.selectedItemId = null;
    this.redraw();

    if (!this.canvas) {
      this.close();
      if (this.onComplete) this.onComplete(null);
      return;
    }

    let dataUrl = '';
    try {
      dataUrl = this.canvas.toDataURL ? this.canvas.toDataURL('image/png') : '';
    } catch {
      // Ignora erro
    }

    // Coleta as notas dos itens de régua e texto
    const notesArr: string[] = [];
    this.items.forEach((it) => {
      if (it.note && it.note.trim()) notesArr.push(it.note.trim());
      else if (it.text && it.text.trim()) notesArr.push(it.text.trim());
    });

    const notesSummary = notesArr.length > 0 ? notesArr.join(' | ') : 'Anotação visual de bug na tela';

    this.close();
    if (this.onComplete) {
      this.onComplete({
        dataUrl,
        notes: notesSummary
      });
    }
  }

  /**
   * Redesenha todos os objetos do canvas
   */
  private redraw(): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.items.forEach((item) => {
      const isSelected = item.id === this.selectedItemId;

      if (item.type === 'pen' && item.points) {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        item.points.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();
      } else if (item.type === 'rect') {
        const x = Math.min(item.x1, item.x2);
        const y = Math.min(item.y1, item.y2);
        const w = Math.abs(item.x2 - item.x1);
        const h = Math.abs(item.y2 - item.y1);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, h);
      } else if (item.type === 'arrow') {
        this.drawLiveArrow(item.x1, item.y1, item.x2, item.y2, item.color);
      } else if (item.type === 'ruler') {
        this.renderTechnicalRuler(item.x1, item.y1, item.x2, item.y2, item.color, item.label || '0px');
      } else if (item.type === 'text' && item.text) {
        this.renderTextItem(item.x1, item.y1, item.text, item.color);
      }

      // Desenha contorno sutil de seleção para o item ativo
      if (isSelected) {
        this.drawSelectionOutline(item);
      }
    });
  }

  private drawLivePen(points: { x: number; y: number }[], color: string): void {
    if (!this.ctx || points.length < 2) return;
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.beginPath();
    points.forEach((pt, idx) => {
      if (idx === 0) this.ctx!.moveTo(pt.x, pt.y);
      else this.ctx!.lineTo(pt.x, pt.y);
    });
    this.ctx.stroke();
  }

  private drawLiveRect(x1: number, y1: number, x2: number, y2: number, color: string): void {
    if (!this.ctx) return;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.strokeRect(x, y, w, h);
  }

  private drawLiveArrow(x1: number, y1: number, x2: number, y2: number, color: string): void {
    if (!this.ctx) return;
    const headLength = 14;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    this.ctx.strokeStyle = color;
    this.ctx.fillStyle = color;
    this.ctx.lineWidth = 3;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    // Linha principal
    this.ctx.beginPath();
    this.ctx.moveTo(x1, y1);
    this.ctx.lineTo(x2, y2);
    this.ctx.stroke();

    // Ponta da seta
    this.ctx.beginPath();
    this.ctx.moveTo(x2, y2);
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle - Math.PI / 6),
      y2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    this.ctx.lineTo(
      x2 - headLength * Math.cos(angle + Math.PI / 6),
      y2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    this.ctx.closePath();
    this.ctx.fill();
  }

  private drawLiveRuler(x1: number, y1: number, x2: number, y2: number, color: string): void {
    if (!this.ctx) return;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const absDx = Math.round(Math.abs(dx));
    const absDy = Math.round(Math.abs(dy));

    let label = '';
    if (absDy >= absDx) {
      const dir = dy >= 0 ? 'bottom' : 'top';
      label = `${absDy}px ${dy >= 0 ? '↓' : '↑'} ${dir}`;
    } else {
      const dir = dx >= 0 ? 'right' : 'left';
      label = `${absDx}px ${dx >= 0 ? '→' : '←'} ${dir}`;
    }

    this.renderTechnicalRuler(x1, y1, x2, y2, color, label);
  }

  /**
   * Renderiza cota técnica com o badge DESLOCADO por 18px perpendicularmente à linha,
   * para NUNCA encobrir ou obstruir a seta / linha de medição!
   */
  private renderTechnicalRuler(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    labelText: string
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const perpAngle = angle + Math.PI / 2;
    const tickLen = 9;

    ctx.save();

    // 1. Linha principal da régua
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // 2. Terminadores em T nas pontas (|--- ... ---|)
    const drawTick = (px: number, py: number) => {
      ctx.beginPath();
      ctx.moveTo(px - tickLen * Math.cos(perpAngle), py - tickLen * Math.sin(perpAngle));
      ctx.lineTo(px + tickLen * Math.cos(perpAngle), py + tickLen * Math.sin(perpAngle));
      ctx.stroke();
    };
    drawTick(x1, y1);
    drawTick(x2, y2);

    // 3. Posição do Badge DESLOCADA (offset perpendicular de 18px) para não encobrir a linha
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const dx = x2 - x1;
    const dy = y2 - y1;
    let badgeMidX = midX;
    let badgeMidY = midY;

    if (Math.abs(dx) >= Math.abs(dy)) {
      // Linha horizontal: desloca o badge 18px para CIMA da linha
      badgeMidY = midY - 18;
    } else {
      // Linha vertical: desloca o badge 24px para a DIREITA da linha
      badgeMidX = midX + 26;
    }

    ctx.font = 'bold 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textWidth = ctx.measureText(labelText).width;
    const paddingX = 7;
    const badgeW = textWidth + paddingX * 2;
    const badgeH = 20;

    // Fundo escuro com borda na cor da ferramenta
    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;

    const bx = badgeMidX - badgeW / 2;
    const by = badgeMidY - badgeH / 2;

    this.roundRect(ctx, bx, by, badgeW, badgeH, 4);
    ctx.fill();
    ctx.stroke();

    // Texto de medição
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, badgeMidX, badgeMidY);

    ctx.restore();
  }

  private renderTextItem(x: number, y: number, text: string, color: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    const textMetrics = ctx.measureText(text);
    const padX = 10;
    const boxW = textMetrics.width + padX * 2;
    const boxH = 26;

    ctx.fillStyle = '#0f172a';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, boxW, boxH, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + boxH / 2);
    ctx.restore();
  }

  /**
   * Desenha moldura sutil de seleção para indicar que o elemento pode ser arrastado
   */
  private drawSelectionOutline(item: AnnotationItem): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);

    const pad = 6;
    if (item.type === 'rect') {
      const x = Math.min(item.x1, item.x2) - pad;
      const y = Math.min(item.y1, item.y2) - pad;
      const w = Math.abs(item.x2 - item.x1) + pad * 2;
      const h = Math.abs(item.y2 - item.y1) + pad * 2;
      ctx.strokeRect(x, y, w, h);
    } else if (item.type === 'arrow' || item.type === 'ruler') {
      const minX = Math.min(item.x1, item.x2) - pad;
      const minY = Math.min(item.y1, item.y2) - pad - 20;
      const maxX = Math.max(item.x1, item.x2) + pad + 25;
      const maxY = Math.max(item.y1, item.y2) + pad;
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    } else if (item.type === 'text') {
      ctx.font = 'bold 13px sans-serif';
      const w = ctx.measureText(item.text || '').width + 20 + pad * 2;
      ctx.strokeRect(item.x1 - pad, item.y1 - pad, w, 26 + pad * 2);
    } else if (item.type === 'pen' && item.points) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      item.points.forEach((p) => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
      ctx.strokeRect(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2);
    }
    ctx.restore();
  }

  /**
   * Encontra qual elemento está na coordenada (x, y)
   */
  private findItemAt(x: number, y: number): AnnotationItem | null {
    // Itera do mais recente para o mais antigo
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (item.type === 'rect') {
        const minX = Math.min(item.x1, item.x2) - 8;
        const maxX = Math.max(item.x1, item.x2) + 8;
        const minY = Math.min(item.y1, item.y2) - 8;
        const maxY = Math.max(item.y1, item.y2) + 8;
        if (x >= minX && x <= maxX && y >= minY && y <= maxY) return item;
      } else if (item.type === 'arrow' || item.type === 'ruler') {
        const dist = this.distToSegment(x, y, item.x1, item.y1, item.x2, item.y2);
        if (dist <= 18) return item;
      } else if (item.type === 'text') {
        const w = (item.text?.length || 10) * 9 + 20;
        if (x >= item.x1 - 6 && x <= item.x1 + w && y >= item.y1 - 6 && y <= item.y1 + 30) {
          return item;
        }
      } else if (item.type === 'pen' && item.points) {
        for (const pt of item.points) {
          if (Math.hypot(pt.x - x, pt.y - y) <= 12) return item;
        }
      }
    }
    return null;
  }

  private distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1)));
  }

  /**
   * Popover de confirmação/edição da régua posicionado de forma limpa SEM encobrir a régua
   */
  private openRulerConfirmPopover(item: AnnotationItem): void {
    if (!this.overlay) return;
    this.closePopover();

    const midX = (item.x1 + item.x2) / 2;
    const midY = (item.y1 + item.y2) / 2;

    const popover = document.createElement('div');
    popover.className = 'backtrack-ignore backtrack-block rr-ignore rr-block';
    popover.setAttribute('data-rr-ignore', 'true');
    popover.setAttribute('data-backtrack-ignore', 'true');
    popover.style.cssText = `
      position: fixed;
      left: ${Math.min(window.innerWidth - 320, Math.max(20, midX - 140))}px;
      top: ${Math.min(window.innerHeight - 80, Math.max(70, midY + 28))}px;
      background: #0f172a;
      border: 1px solid #3b82f6;
      box-shadow: 0 10px 25px rgba(0,0,0,0.65);
      border-radius: 8px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 2147483648;
    `;

    popover.innerHTML = `
      <input type="text" id="ruler-note-input" value="${item.note || ''}" style="background: #1e293b; color: #fff; border: 1px solid #334155; border-radius: 4px; padding: 4px 8px; font-size: 12px; width: 210px; outline: none;" />
      <button type="button" id="btn-ruler-confirm" style="background: #10b981; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; font-weight: bold; cursor: pointer;">✓</button>
      <button type="button" id="btn-ruler-cancel" style="background: transparent; color: #94a3b8; border: none; padding: 4px; font-size: 12px; cursor: pointer;">✕</button>
    `;

    this.overlay.appendChild(popover);
    this.activePopover = popover;

    const input = popover.querySelector('#ruler-note-input') as HTMLInputElement;
    const btnConfirm = popover.querySelector('#btn-ruler-confirm') as HTMLButtonElement;
    const btnCancel = popover.querySelector('#btn-ruler-cancel') as HTMLButtonElement;

    setTimeout(() => {
      input?.focus();
      input?.select();
    }, 50);

    const applyNote = () => {
      const customText = input?.value.trim() || item.note;
      item.note = customText;
      item.label = customText;
      this.closePopover();
      this.recordHistory();
      this.redraw();
    };

    btnConfirm.addEventListener('click', (e) => {
      e.stopPropagation();
      applyNote();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyNote();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closePopover();
      }
    });

    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePopover();
    });
  }

  private openTextInput(x: number, y: number): void {
    if (!this.overlay) return;
    this.closePopover();

    const inputWrap = document.createElement('div');
    inputWrap.className = 'backtrack-ignore backtrack-block rr-ignore rr-block';
    inputWrap.setAttribute('data-rr-ignore', 'true');
    inputWrap.setAttribute('data-backtrack-ignore', 'true');
    inputWrap.style.cssText = `
      position: fixed;
      left: ${Math.min(window.innerWidth - 260, Math.max(20, x))}px;
      top: ${Math.min(window.innerHeight - 60, Math.max(60, y))}px;
      background: #0f172a;
      border: 1px solid ${this.color};
      box-shadow: 0 10px 25px rgba(0,0,0,0.6);
      border-radius: 6px;
      padding: 6px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 2147483648;
    `;

    inputWrap.innerHTML = `
      <input type="text" id="canvas-text-input" placeholder="Digite a anotação..." style="background: #1e293b; color: #fff; border: 1px solid #334155; border-radius: 4px; padding: 4px 8px; font-size: 12px; width: 180px; outline: none;" />
      <button type="button" id="btn-text-confirm" style="background: #10b981; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 12px; font-weight: bold; cursor: pointer;">✓</button>
      <button type="button" id="btn-text-cancel" style="background: transparent; color: #94a3b8; border: none; padding: 4px; font-size: 12px; cursor: pointer;">✕</button>
    `;

    this.overlay.appendChild(inputWrap);
    this.activePopover = inputWrap;

    const input = inputWrap.querySelector('#canvas-text-input') as HTMLInputElement;
    const btnConfirm = inputWrap.querySelector('#btn-text-confirm') as HTMLButtonElement;
    const btnCancel = inputWrap.querySelector('#btn-text-cancel') as HTMLButtonElement;

    setTimeout(() => input?.focus(), 50);

    const commitText = () => {
      const text = input.value.trim();
      this.closePopover();
      if (!text) return;

      const newItem: AnnotationItem = {
        id: `item_${Date.now()}_${Math.random()}`,
        type: 'text',
        color: this.color,
        x1: x,
        y1: y,
        x2: x + 100,
        y2: y + 26,
        text
      };
      this.items.push(newItem);
      this.selectedItemId = newItem.id;
      this.recordHistory();
      this.redraw();
    };

    btnConfirm.addEventListener('click', (e) => {
      e.stopPropagation();
      commitText();
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitText();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.closePopover();
      }
    });

    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePopover();
    });
  }

  private closePopover(): void {
    if (this.activePopover && this.activePopover.parentNode) {
      this.activePopover.parentNode.removeChild(this.activePopover);
    }
    this.activePopover = null;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  private recordHistory(): void {
    // Clona o array de itens para a pilha de undo
    const snapshot = this.items.map((it) => ({
      ...it,
      points: it.points ? [...it.points] : undefined
    }));
    this.historyStack.push(snapshot);
    if (this.historyStack.length > 30) this.historyStack.shift();
  }

  private undo(): void {
    this.closePopover();
    if (this.historyStack.length <= 1) {
      this.items = [];
      this.selectedItemId = null;
      this.redraw();
      return;
    }
    this.historyStack.pop();
    const prev = this.historyStack[this.historyStack.length - 1];
    this.items = prev.map((it) => ({
      ...it,
      points: it.points ? [...it.points] : undefined
    }));
    this.selectedItemId = null;
    this.redraw();
  }

  private clear(): void {
    this.closePopover();
    this.items = [];
    this.selectedItemId = null;
    this.recordHistory();
    this.redraw();
  }

  public close(): void {
    this.closePopover();
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.items = [];
    this.historyStack = [];
    this.selectedItemId = null;
  }
}
