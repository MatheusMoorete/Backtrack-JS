import { Backtrack } from '../../src/index';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

// Extensão global do window para facilitar a automação Playwright
declare global {
  interface Window {
    __backtrack?: Backtrack;
    __testHelpers?: {
      start: () => Promise<void>;
      stop: () => Promise<void>;
      capture: (reason: string, duration?: number) => Promise<string>;
      exportLastArtifact: () => Promise<FlightRecorderArtifactV1>;
      addItem: (text: string, id?: string) => HTMLElement;
      removeItem: () => boolean;
      openModal: () => void;
      closeModal: () => void;
      scrollBox: (scrollTop: number) => void;
      drawCanvas: () => void;
    };
  }
}

// Inicializa o Backtrack com opções para testes de fidelidade
const recorder = new Backtrack({
  bufferMinutes: 5,
  showWidget: false, // Widget desligado para manter o DOM do teste limpo
  privacy: {
    maskAllInputs: false, // Inputs visíveis para validar a digitação no replay
    blockMedia: false
  }
});

window.__backtrack = recorder;

// Contadores e referências DOM
let itemCounter = 0;
const itemList = document.getElementById('item-list') as HTMLDivElement;
const btnAddItem = document.getElementById('btn-add-item') as HTMLButtonElement;
const btnRemoveItem = document.getElementById('btn-remove-item') as HTMLButtonElement;
const btnOpenModal = document.getElementById('btn-open-modal') as HTMLButtonElement;
const btnCloseModal = document.getElementById('btn-close-modal') as HTMLButtonElement;
const modal = document.getElementById('synthetic-modal') as HTMLDivElement;
const scrollContainer = document.getElementById('scroll-container') as HTMLDivElement;
const btnDrawCanvas = document.getElementById('btn-draw-canvas') as HTMLButtonElement;
const canvas = document.getElementById('synthetic-canvas') as HTMLCanvasElement;

function addItem(text?: string, customId?: string): HTMLElement {
  itemCounter++;
  const el = document.createElement('div');
  const id = customId || `item-${itemCounter}`;
  el.id = id;
  el.className = 'synthetic-item';
  el.textContent = text || `Item dinâmico #${itemCounter}`;
  itemList.appendChild(el);
  return el;
}

function removeItem(): boolean {
  if (itemList.firstElementChild) {
    itemList.removeChild(itemList.firstElementChild);
    return true;
  }
  return false;
}

function openModal(): void {
  modal.classList.add('is-open');
}

function closeModal(): void {
  modal.classList.remove('is-open');
}

function scrollBox(scrollTop: number): void {
  scrollContainer.scrollTop = scrollTop;
}

function drawCanvas(): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // Desenha retângulos coloridos e texto
  ctx.fillStyle = '#3b82f6';
  ctx.fillRect(10, 10, 80, 50);

  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.arc(150, 45, 30, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.font = '14px sans-serif';
  ctx.fillText('Backtrack Test', 10, 95);
}

// Binds de eventos da interface
btnAddItem?.addEventListener('click', () => addItem());
btnRemoveItem?.addEventListener('click', () => removeItem());
btnOpenModal?.addEventListener('click', () => openModal());
btnCloseModal?.addEventListener('click', () => closeModal());
btnDrawCanvas?.addEventListener('click', () => drawCanvas());

// Helpers expostos para o teste de fidelidade
window.__testHelpers = {
  start: async () => {
    await recorder.start();
  },
  stop: async () => {
    await recorder.stop();
  },
  capture: async (reason: string, duration?: number) => {
    return await recorder.capture(reason, duration);
  },
  exportLastArtifact: async () => {
    const list = await recorder.listIncidents();
    if (list.length === 0) {
      throw new Error('Nenhum incidente gravado para exportar');
    }
    const last = list[list.length - 1];
    return await recorder.exportIncident(last.id);
  },
  addItem,
  removeItem,
  openModal,
  closeModal,
  scrollBox,
  drawCanvas
};
