export interface ScreenAnnotatorResult {
  dataUrl: string;
  notes?: string;
}

export class ScreenAnnotator {
  private overlay: HTMLDivElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tool: 'pen' | 'rect' = 'pen';
  private isDrawing = false;
  private startX = 0;
  private startY = 0;
  private history: ImageData[] = [];
  private onComplete: ((result: ScreenAnnotatorResult | null) => void) | null = null;

  public open(onComplete: (result: ScreenAnnotatorResult | null) => void): void {
    if (this.overlay) return;
    this.onComplete = onComplete;

    const overlay = document.createElement('div');
    overlay.id = '__backtrack_annotator_overlay__';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      background: rgba(15, 23, 42, 0.25);
      cursor: crosshair;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const canvas = document.createElement('canvas');
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
    toolbar.style.cssText = `
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 10px;
      background: #0f172a;
      padding: 8px 16px;
      border-radius: 9999px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      z-index: 10;
    `;

    toolbar.innerHTML = `
      <span style="font-size: 12px; color: #94a3b8; margin-right: 4px;">Anotar Erro:</span>
      <button type="button" id="btn-tool-pen" style="background: #3b82f6; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">✏️ Caneta</button>
      <button type="button" id="btn-tool-rect" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">⬜ Retângulo</button>
      <button type="button" id="btn-undo" style="background: #1e293b; color: #cbd5e1; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">↩️ Desfazer</button>
      <div style="width: 1px; height: 18px; background: rgba(255,255,255,0.15); margin: 0 4px;"></div>
      <button type="button" id="btn-done" style="background: #10b981; color: white; border: none; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600;">✓ Salvar e Gravar</button>
      <button type="button" id="btn-cancel" style="background: transparent; color: #94a3b8; border: none; padding: 6px 8px; cursor: pointer; font-size: 12px;">✕ Cancelar</button>
    `;
    overlay.appendChild(toolbar);

    document.body.appendChild(overlay);
    this.saveState();

    // Eventos da toolbar
    const btnPen = toolbar.querySelector('#btn-tool-pen') as HTMLButtonElement;
    const btnRect = toolbar.querySelector('#btn-tool-rect') as HTMLButtonElement;
    const btnUndo = toolbar.querySelector('#btn-undo') as HTMLButtonElement;
    const btnDone = toolbar.querySelector('#btn-done') as HTMLButtonElement;
    const btnCancel = toolbar.querySelector('#btn-cancel') as HTMLButtonElement;

    btnPen.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tool = 'pen';
      btnPen.style.background = '#3b82f6';
      btnPen.style.color = '#fff';
      btnRect.style.background = '#1e293b';
      btnRect.style.color = '#cbd5e1';
    });

    btnRect.addEventListener('click', (e) => {
      e.stopPropagation();
      this.tool = 'rect';
      btnRect.style.background = '#3b82f6';
      btnRect.style.color = '#fff';
      btnPen.style.background = '#1e293b';
      btnPen.style.color = '#cbd5e1';
    });

    btnUndo.addEventListener('click', (e) => {
      e.stopPropagation();
      this.undo();
    });

    btnDone.addEventListener('click', (e) => {
      e.stopPropagation();
      let dataUrl = '';
      try {
        dataUrl = canvas.toDataURL ? canvas.toDataURL('image/png') : '';
      } catch {
        // Noop
      }
      this.close();
      if (this.onComplete) this.onComplete({ dataUrl });
    });

    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
      if (this.onComplete) this.onComplete(null);
    });

    // Eventos de desenho no canvas
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener('mousedown', (e) => {
      this.isDrawing = true;
      this.startX = e.clientX;
      this.startY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDrawing || !this.ctx) return;

      if (this.tool === 'pen') {
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.beginPath();
        this.ctx.moveTo(lastX, lastY);
        this.ctx.lineTo(e.clientX, e.clientY);
        this.ctx.stroke();
        lastX = e.clientX;
        lastY = e.clientY;
      } else if (this.tool === 'rect') {
        // Restaura estado anterior para prévia de retângulo
        if (this.history.length > 0) {
          this.ctx.putImageData(this.history[this.history.length - 1], 0, 0);
        } else {
          this.ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        const w = e.clientX - this.startX;
        const h = e.clientY - this.startY;
        this.ctx.strokeStyle = '#ef4444';
        this.ctx.lineWidth = 3;
        this.ctx.strokeRect(this.startX, this.startY, w, h);
      }
    });

    canvas.addEventListener('mouseup', () => {
      if (this.isDrawing) {
        this.isDrawing = false;
        this.saveState();
      }
    });
  }

  private saveState(): void {
    if (!this.ctx || !this.canvas) return;
    try {
      this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
      if (this.history.length > 20) this.history.shift();
    } catch {
      // Noop
    }
  }

  private undo(): void {
    if (this.history.length <= 1 || !this.ctx || !this.canvas) {
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.history = [];
        this.saveState();
      }
      return;
    }
    this.history.pop();
    const prev = this.history[this.history.length - 1];
    this.ctx.putImageData(prev, 0, 0);
  }

  public close(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    this.overlay = null;
    this.canvas = null;
    this.ctx = null;
    this.history = [];
  }
}
