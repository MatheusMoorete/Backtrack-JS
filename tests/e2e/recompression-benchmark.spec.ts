import { test, expect } from '@playwright/test';
import type { BenchmarkReport } from '../fidelity/benchmark';

test.describe('Prioridade 3 — Medição de Recompressão com Fixture de Fidelidade', () => {
  const durationSeconds = Number(process.env.BENCHMARK_DURATION_SECONDS || 300);

  test(`Medição contínua (${durationSeconds}s): compara baseline vs recorder, mede flushes, chunk size e long tasks`, async ({ page }) => {
    // Aumenta o timeout do Playwright para acomodar as duas execuções
    test.setTimeout((durationSeconds * 2 + 60) * 1000);

    // 1. Abre a página de benchmark de fidelidade
    await page.goto('/tests/fidelity/benchmark.html');
    await page.waitForLoadState('domcontentloaded');

    console.log(`\n===============================================================`);
    console.log(`INICIANDO BENCHMARK DE RECOMPRESSÃO (Duração: ${durationSeconds} segundos)`);
    console.log(`===============================================================\n`);

    // 2. Executa BASELINE (sem recorder)
    console.log(`[1/2] Executando Baseline (SEM Backtrack recorder)...`);
    const baselineReport: BenchmarkReport = await page.evaluate(async (sec) => {
      return await window.__benchmark!.start('without-recorder', sec);
    }, durationSeconds);

    console.log(`Baseline finalizado:`);
    console.log(`  - Long tasks (>50ms): ${baselineReport.longTaskCount}`);
    console.log(`  - Tempo total em long tasks: ${baselineReport.totalLongTaskTimeMs.toFixed(1)} ms`);
    console.log(`  - Long task máxima: ${baselineReport.maxLongTaskDurationMs.toFixed(1)} ms`);
    if (baselineReport.heapMemoryPeakMb) {
      console.log(`  - Memória Heap pico: ${baselineReport.heapMemoryPeakMb} MB`);
    }

    // Pequena pausa entre as execuções
    await page.waitForTimeout(2000);

    // Recarrega para limpar memória e DOM antes da segunda execução
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // 3. Executa COM RECORDER
    console.log(`\n[2/2] Executando com Backtrack recorder ativo (recompressão cumulativa atual)...`);
    const recorderReport: BenchmarkReport = await page.evaluate(async (sec) => {
      return await window.__benchmark!.start('with-recorder', sec);
    }, durationSeconds);

    console.log(`Gravação finalizada:`);
    console.log(`  - Total de flushes: ${recorderReport.flushCount}`);
    console.log(`  - Duração média de flush: ${recorderReport.avgFlushDurationMs} ms`);
    console.log(`  - Duração máxima de flush: ${recorderReport.maxFlushDurationMs} ms`);
    console.log(`  - Duração mínima de flush: ${recorderReport.minFlushDurationMs} ms`);
    console.log(`  - Serialização média: ${recorderReport.avgSerializationMs} ms (máx: ${recorderReport.maxSerializationMs} ms)`);
    console.log(`  - Compressão média: ${recorderReport.avgCompressionMs} ms (máx: ${recorderReport.maxCompressionMs} ms)`);
    console.log(`  - Escrita IndexedDB média: ${recorderReport.avgWriteMs} ms (máx: ${recorderReport.maxWriteMs} ms)`);
    console.log(`  - Tamanho médio do chunk: ${(recorderReport.avgChunkSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`  - Tamanho máximo do chunk: ${(recorderReport.maxChunkSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`  - Eventos médios por chunk: ${recorderReport.avgEventsInChunk}`);
    console.log(`  - Eventos máximos por chunk: ${recorderReport.maxEventsInChunk}`);
    console.log(`  - Total de eventos únicos gerados: ${recorderReport.totalEventsFlushed}`);
    console.log(`  - Long tasks (>50ms): ${recorderReport.longTaskCount}`);
    console.log(`  - Tempo total em long tasks: ${recorderReport.totalLongTaskTimeMs.toFixed(1)} ms`);
    console.log(`  - Long task máxima: ${recorderReport.maxLongTaskDurationMs.toFixed(1)} ms`);
    if (recorderReport.heapMemoryPeakMb) {
      console.log(`  - Memória Heap pico: ${recorderReport.heapMemoryPeakMb} MB`);
    }

    console.log(`\n===============================================================`);
    console.log(`RELATÓRIO COMPARATIVO: SEM RECORDER vs COM RECORDER`);
    console.log(`===============================================================`);
    console.log(`Métrica                          | Sem Recorder | Com Recorder`);
    console.log(`---------------------------------+--------------+-------------`);
    console.log(`Duração do teste                 | ${baselineReport.durationSeconds}s           | ${recorderReport.durationSeconds}s`);
    console.log(`Flushes executados               | N/A          | ${recorderReport.flushCount}`);
    console.log(`Duração média do flush           | N/A          | ${recorderReport.avgFlushDurationMs} ms`);
    console.log(`Duração máxima do flush          | N/A          | ${recorderReport.maxFlushDurationMs} ms`);
    console.log(`Tamanho máx do chunk             | N/A          | ${(recorderReport.maxChunkSizeBytes / 1024).toFixed(1)} KB`);
    console.log(`Eventos máx acumulados no chunk  | N/A          | ${recorderReport.maxEventsInChunk}`);
    console.log(`Quantidade de Long Tasks (>50ms) | ${baselineReport.longTaskCount}            | ${recorderReport.longTaskCount}`);
    console.log(`Tempo total em Long Tasks        | ${baselineReport.totalLongTaskTimeMs.toFixed(1)} ms     | ${recorderReport.totalLongTaskTimeMs.toFixed(1)} ms`);
    console.log(`Pico de Memória Heap             | ${baselineReport.heapMemoryPeakMb ?? 'N/A'} MB        | ${recorderReport.heapMemoryPeakMb ?? 'N/A'} MB`);
    console.log(`===============================================================\n`);

    // Validações básicas de sanidade do relatório
    expect(recorderReport.flushCount).toBeGreaterThan(0);
    expect(recorderReport.totalEventsFlushed).toBeGreaterThan(0);
  });
});
