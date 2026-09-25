import { Backtrack } from '../../src/index';
import type { FlushMetrics } from '../../src/storage/batch-writer';

export interface LongTaskRecord {
  startTime: number;
  duration: number;
}

export interface BenchmarkReport {
  mode: 'with-recorder' | 'without-recorder';
  durationSeconds: number;
  flushCount: number;
  avgFlushDurationMs: number;
  maxFlushDurationMs: number;
  minFlushDurationMs: number;
  avgSerializationMs: number;
  maxSerializationMs: number;
  avgCompressionMs: number;
  maxCompressionMs: number;
  avgWriteMs: number;
  maxWriteMs: number;
  maxChunkSizeBytes: number;
  avgChunkSizeBytes: number;
  maxEventsInChunk: number;
  avgEventsInChunk: number;
  totalEventsFlushed: number;
  longTaskCount: number;
  totalLongTaskTimeMs: number;
  maxLongTaskDurationMs: number;
  heapMemoryStartMb?: number;
  heapMemoryEndMb?: number;
  heapMemoryPeakMb?: number;
  flushes: FlushMetrics[];
}

declare global {
  interface Window {
    __benchmark?: {
      start: (mode: 'with-recorder' | 'without-recorder', durationSeconds: number) => Promise<BenchmarkReport>;
      stop: () => Promise<void>;
      getResults: () => BenchmarkReport | null;
      isDone: () => boolean;
    };
  }
}

// Elementos DOM
const tableBody = document.getElementById('table-body') as HTMLTableSectionElement;
const cardGrid = document.getElementById('card-grid') as HTMLDivElement;
const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
const valElapsed = document.getElementById('val-elapsed') as HTMLDivElement;
const valFlushes = document.getElementById('val-flushes') as HTMLDivElement;
const valAvgFlush = document.getElementById('val-avg-flush') as HTMLDivElement;
const valMaxFlush = document.getElementById('val-max-flush') as HTMLDivElement;
const valLongTasks = document.getElementById('val-long-tasks') as HTMLDivElement;
const valMaxSize = document.getElementById('val-max-size') as HTMLDivElement;

// Inicializa DOM Grande (200 linhas de tabela + 50 cards)
function initLargeDOM(): void {
  tableBody.innerHTML = '';
  for (let i = 1; i <= 200; i++) {
    const tr = document.createElement('tr');
    tr.id = `row-${i}`;
    tr.innerHTML = `
      <td>#TX-${10000 + i}</td>
      <td>Cliente Benchmark ${i}</td>
      <td><span class="status-pill">CONFIRMADO</span></td>
      <td>PAG_${Math.random().toString(36).substring(2, 9)}</td>
      <td>R$ ${(Math.random() * 500 + 50).toFixed(2)}</td>
      <td>Cartão de Crédito</td>
      <td>VIP-${(i % 5) + 1}</td>
      <td>${new Date().toLocaleTimeString()}</td>
    `;
    tableBody.appendChild(tr);
  }

  cardGrid.innerHTML = '';
  for (let c = 1; c <= 50; c++) {
    const card = document.createElement('div');
    card.className = 'data-card';
    card.id = `card-${c}`;
    card.innerHTML = `
      <div style="font-weight: 600; font-size: 13px;">Painel de Vendas #${c}</div>
      <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">Atualizações automáticas</div>
      <div style="font-size: 16px; font-weight: 700; color: #2563eb; margin-top: 6px;">
        ${Math.floor(Math.random() * 1000)} acessos
      </div>
    `;
    cardGrid.appendChild(card);
  }
}

// Estado da execução
let isRunning = false;
let recorder: Backtrack | null = null;
let currentMode: 'with-recorder' | 'without-recorder' = 'with-recorder';
let startTime = 0;
let flushMetricsList: FlushMetrics[] = [];
let longTasksList: LongTaskRecord[] = [];
let memorySamples: number[] = [];
let longTaskObserver: PerformanceObserver | null = null;
let mutationIntervalTimer: ReturnType<typeof setInterval> | null = null;
let consoleIntervalTimer: ReturnType<typeof setInterval> | null = null;
let networkIntervalTimer: ReturnType<typeof setInterval> | null = null;
let uiUpdateIntervalTimer: ReturnType<typeof setInterval> | null = null;
let benchmarkDone = false;
let latestReport: BenchmarkReport | null = null;

// Intercepta e simula respostas para fetch local do benchmark
const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (urlStr.includes('/api/benchmark-mock')) {
    return new Response(JSON.stringify({ ok: true, timestamp: Date.now() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  return originalFetch(input, init);
};

function getHeapSizeMb(): number | undefined {
  const perf = window.performance as unknown as { memory?: { usedJSHeapSize: number } };
  if (perf?.memory?.usedJSHeapSize) {
    return Math.round((perf.memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100;
  }
  return undefined;
}

function startLongTaskObserver(): void {
  longTasksList = [];
  try {
    longTaskObserver = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        longTasksList.push({
          startTime: entry.startTime,
          duration: entry.duration
        });
        valLongTasks.textContent = String(longTasksList.length);
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    // Caso o navegador não suporte observer de longtask
  }
}

function stopLongTaskObserver(): void {
  if (longTaskObserver) {
    longTaskObserver.disconnect();
    longTaskObserver = null;
  }
}

let tickCount = 0;
function performMutations(): void {
  tickCount++;
  // 1. Alterna destaque e conteúdo em células
  const rows = tableBody.rows;
  if (rows.length > 10) {
    const randomIndex = Math.floor(Math.random() * rows.length);
    const row = rows[randomIndex];
    const cell = row.cells[4];
    if (cell) {
      cell.textContent = `R$ ${(Math.random() * 500 + 50).toFixed(2)}`;
      cell.classList.toggle('highlight-cell');
    }
  }

  // 2. Insere e remove uma linha a cada 10 ticks para manter o DOM ativo
  if (tickCount % 10 === 0) {
    const newRow = document.createElement('tr');
    newRow.id = `row-dyn-${tickCount}`;
    newRow.innerHTML = `
      <td>#TX-${20000 + tickCount}</td>
      <td>Cliente Dinâmico #${tickCount}</td>
      <td><span class="status-pill">PROCESSADO</span></td>
      <td>PAG_DYN_${tickCount}</td>
      <td>R$ ${(Math.random() * 300).toFixed(2)}</td>
      <td>Pix</td>
      <td>NOVO</td>
      <td>${new Date().toLocaleTimeString()}</td>
    `;
    tableBody.insertBefore(newRow, tableBody.firstChild);

    if (tableBody.rows.length > 250) {
      tableBody.removeChild(tableBody.lastChild!);
    }
  }

  // 3. Atualiza alguns cards
  if (tickCount % 5 === 0) {
    const cardIdx = (tickCount % 50) + 1;
    const card = document.getElementById(`card-${cardIdx}`);
    if (card) {
      const metricEl = card.children[2] as HTMLDivElement;
      if (metricEl) {
        metricEl.textContent = `${Math.floor(Math.random() * 2000)} acessos`;
      }
    }
  }
}

async function startBenchmark(
  mode: 'with-recorder' | 'without-recorder',
  durationSeconds: number
): Promise<BenchmarkReport> {
  if (isRunning) {
    throw new Error('Benchmark já está em execução.');
  }

  isRunning = true;
  benchmarkDone = false;
  currentMode = mode;
  startTime = performance.now();
  flushMetricsList = [];
  memorySamples = [];
  initLargeDOM();
  startLongTaskObserver();

  const initialHeap = getHeapSizeMb();
  if (initialHeap) memorySamples.push(initialHeap);

  statusBadge.textContent = mode === 'with-recorder' ? 'Executando (Com Recorder)' : 'Executando (Sem Recorder)';
  statusBadge.style.background = mode === 'with-recorder' ? '#dbeafe' : '#fef3c7';
  statusBadge.style.color = mode === 'with-recorder' ? '#1e40af' : '#92400e';

  // Se modo for com recorder, instancia o Backtrack
  if (mode === 'with-recorder') {
    recorder = new Backtrack({
      bufferMinutes: 5,
      showWidget: false,
      batchWriterConfig: {
        flushIntervalMs: 1000,
        maxBatchEvents: 250,
        chunkDurationMs: 60000,
        onFlushMetrics: (metrics) => {
          flushMetricsList.push(metrics);
          updateFlushUI();
        }
      }
    });
    await recorder.start();
  }

  // Atividades contínuas
  mutationIntervalTimer = setInterval(performMutations, 60);

  consoleIntervalTimer = setInterval(() => {
    console.log('[BENCHMARK_LOG]', {
      tick: tickCount,
      timestamp: Date.now(),
      status: 'active',
      data: { alpha: Math.random(), beta: 'synthetic_payload_sample_text' }
    });
    if (tickCount % 4 === 0) {
      console.warn('[BENCHMARK_WARN]', 'Alerta sintético de carga controlada');
    }
  }, 150);

  networkIntervalTimer = setInterval(() => {
    window.fetch('/api/benchmark-mock', {
      method: 'POST',
      body: JSON.stringify({ tick: tickCount })
    }).catch(() => {});
  }, 400);

  // Amostragem de memória e UI a cada 1s
  uiUpdateIntervalTimer = setInterval(() => {
    const elapsedSec = Math.floor((performance.now() - startTime) / 1000);
    valElapsed.textContent = `${elapsedSec}s / ${durationSeconds}s`;

    const heap = getHeapSizeMb();
    if (heap) memorySamples.push(heap);

    if (elapsedSec >= durationSeconds) {
      stopBenchmark();
    }
  }, 1000);

  // Aguarda até o encerramento da duração
  return new Promise<BenchmarkReport>((resolve) => {
    const checkTimer = setInterval(() => {
      if (benchmarkDone && latestReport) {
        clearInterval(checkTimer);
        resolve(latestReport);
      }
    }, 500);
  });
}

function updateFlushUI(): void {
  if (flushMetricsList.length === 0) return;
  valFlushes.textContent = String(flushMetricsList.length);

  const totalDur = flushMetricsList.reduce((sum, m) => sum + m.durationMs, 0);
  const avgDur = totalDur / flushMetricsList.length;
  valAvgFlush.textContent = `${avgDur.toFixed(2)} ms`;

  const maxDur = Math.max(...flushMetricsList.map((m) => m.durationMs));
  valMaxFlush.textContent = `${maxDur.toFixed(2)} ms`;

  const maxSize = Math.max(...flushMetricsList.map((m) => m.chunkSizeBytes));
  valMaxSize.textContent = `${(maxSize / 1024).toFixed(1)} KB`;
}

async function stopBenchmark(): Promise<void> {
  if (!isRunning) return;
  isRunning = false;

  if (mutationIntervalTimer) clearInterval(mutationIntervalTimer);
  if (consoleIntervalTimer) clearInterval(consoleIntervalTimer);
  if (networkIntervalTimer) clearInterval(networkIntervalTimer);
  if (uiUpdateIntervalTimer) clearInterval(uiUpdateIntervalTimer);

  mutationIntervalTimer = null;
  consoleIntervalTimer = null;
  networkIntervalTimer = null;
  uiUpdateIntervalTimer = null;

  if (recorder) {
    await recorder.stop();
    recorder = null;
  }

  stopLongTaskObserver();

  const totalDurationSeconds = (performance.now() - startTime) / 1000;
  const finalHeap = getHeapSizeMb();
  if (finalHeap) memorySamples.push(finalHeap);

  const flushCount = flushMetricsList.length;
  const avgFlushDurationMs = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.durationMs, 0) / flushCount : 0;
  const maxFlushDurationMs = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.durationMs)) : 0;
  const minFlushDurationMs = flushCount > 0 ? Math.min(...flushMetricsList.map((m) => m.durationMs)) : 0;

  const avgSerializationMs = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.serializationMs, 0) / flushCount : 0;
  const maxSerializationMs = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.serializationMs)) : 0;

  const avgCompressionMs = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.compressionMs, 0) / flushCount : 0;
  const maxCompressionMs = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.compressionMs)) : 0;

  const avgWriteMs = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.writeMs, 0) / flushCount : 0;
  const maxWriteMs = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.writeMs)) : 0;

  const maxChunkSizeBytes = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.chunkSizeBytes)) : 0;
  const avgChunkSizeBytes = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.chunkSizeBytes, 0) / flushCount : 0;

  const maxEventsInChunk = flushCount > 0 ? Math.max(...flushMetricsList.map((m) => m.totalEventsInChunk)) : 0;
  const avgEventsInChunk = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + m.totalEventsInChunk, 0) / flushCount : 0;
  const totalEventsFlushed = flushCount > 0 ? flushMetricsList.reduce((s, m) => s + (m.replayEventsInBatch + m.timelineEventsInBatch), 0) : 0;

  const longTaskCount = longTasksList.length;
  const totalLongTaskTimeMs = longTasksList.reduce((s, t) => s + t.duration, 0);
  const maxLongTaskDurationMs = longTaskCount > 0 ? Math.max(...longTasksList.map((t) => t.duration)) : 0;

  const heapMemoryStartMb = memorySamples.length > 0 ? memorySamples[0] : undefined;
  const heapMemoryEndMb = memorySamples.length > 0 ? memorySamples[memorySamples.length - 1] : undefined;
  const heapMemoryPeakMb = memorySamples.length > 0 ? Math.max(...memorySamples) : undefined;

  latestReport = {
    mode: currentMode,
    durationSeconds: Math.round(totalDurationSeconds),
    flushCount,
    avgFlushDurationMs: Math.round(avgFlushDurationMs * 100) / 100,
    maxFlushDurationMs: Math.round(maxFlushDurationMs * 100) / 100,
    minFlushDurationMs: Math.round(minFlushDurationMs * 100) / 100,
    avgSerializationMs: Math.round(avgSerializationMs * 100) / 100,
    maxSerializationMs: Math.round(maxSerializationMs * 100) / 100,
    avgCompressionMs: Math.round(avgCompressionMs * 100) / 100,
    maxCompressionMs: Math.round(maxCompressionMs * 100) / 100,
    avgWriteMs: Math.round(avgWriteMs * 100) / 100,
    maxWriteMs: Math.round(maxWriteMs * 100) / 100,
    maxChunkSizeBytes,
    avgChunkSizeBytes: Math.round(avgChunkSizeBytes),
    maxEventsInChunk,
    avgEventsInChunk: Math.round(avgEventsInChunk),
    totalEventsFlushed,
    longTaskCount,
    totalLongTaskTimeMs: Math.round(totalLongTaskTimeMs * 100) / 100,
    maxLongTaskDurationMs: Math.round(maxLongTaskDurationMs * 100) / 100,
    heapMemoryStartMb,
    heapMemoryEndMb,
    heapMemoryPeakMb,
    flushes: flushMetricsList
  };

  statusBadge.textContent = 'Concluído';
  statusBadge.style.background = '#d1fae5';
  statusBadge.style.color = '#065f46';
  benchmarkDone = true;
}

initLargeDOM();

window.__benchmark = {
  start: startBenchmark,
  stop: stopBenchmark,
  getResults: () => latestReport,
  isDone: () => benchmarkDone
};
