import { test, expect } from '@playwright/test';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

async function seekViewerTo(viewerPage: any, offsetMs: number | string): Promise<void> {
  await viewerPage.evaluate((target: number | string) => {
    const slider = document.querySelector('input.seek-slider-overlay') as HTMLInputElement | null;
    if (!slider) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(slider, String(target));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, offsetMs);
  await viewerPage.waitForTimeout(400);
}

test.describe('Backtrack Browser Fidelity & Replay E2E', () => {

  test('Jornada sintética completa: mutações DOM, form, modal, canvas, seek e sincronização no Viewer', async ({ page }) => {
    // 1. Navega para a página de teste sintético
    await page.goto('/tests/fidelity/synthetic.html');
    await page.waitForLoadState('domcontentloaded');

    // 2. Inicia gravação do Backtrack
    await page.evaluate(async () => {
      await window.__testHelpers?.start();
    });

    // Aguarda snapshot inicial
    await page.waitForTimeout(300);

    // 3. Executa mutações no DOM: cria 2 itens
    await page.click('#btn-add-item'); // cria #item-1
    await page.waitForTimeout(100);
    await page.click('#btn-add-item'); // cria #item-2
    await page.waitForTimeout(100);

    // 4. Digita no formulário
    await page.fill('#input-name', 'Carlos Eduardo QA');
    await page.fill('#input-email', 'carlos.qa@empresa.com');
    await page.fill('#input-notes', 'Gravando teste de reprodução fiel.');
    await page.waitForTimeout(100);

    // 5. Abre e fecha modal
    await page.click('#btn-open-modal');
    await expect(page.locator('#synthetic-modal')).toHaveClass(/is-open/);
    await page.waitForTimeout(150);
    await page.click('#btn-close-modal');
    await expect(page.locator('#synthetic-modal')).not.toHaveClass(/is-open/);
    await page.waitForTimeout(100);

    // 6. Rola container interno
    await page.evaluate(() => {
      window.__testHelpers?.scrollBox(200);
    });
    await page.waitForTimeout(100);

    // 7. Desenha no canvas
    await page.click('#btn-draw-canvas');
    await page.waitForTimeout(150);

    // 8. Remove o primeiro item (#item-1)
    await page.click('#btn-remove-item');
    await page.waitForTimeout(200);

    // 9. Captura incidente e exporta o artefato
    const artifact: FlightRecorderArtifactV1 = await page.evaluate(async () => {
      await window.__testHelpers?.capture('Falha de fidelidade DOM', 10);
      return await window.__testHelpers!.exportLastArtifact();
    });

    expect(artifact).toBeDefined();
    expect(artifact.incident.id).toBeTruthy();
    expect(artifact.replay.length).toBeGreaterThan(0);

    // 10. Abre o Backtrack Viewer e carrega o artefato capturado via nova aba
    const viewerPage = await page.context().newPage();
    await viewerPage.addInitScript((art) => {
      sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(art));
    }, artifact);
    await viewerPage.goto('/viewer/index.html');
    await viewerPage.waitForLoadState('domcontentloaded');

    // 11. Aguarda o ReplayPlayer montar o iframe do rrweb
    const replayIframe = viewerPage.frameLocator('.replay-frame-wrapper iframe');
    await expect(replayIframe.locator('h1')).toHaveText(/Fidelidade Backtrack/i, { timeout: 15000 });

    // 12. Move o slider para o fim do replay para inspecionar o estado final
    const seekSlider = viewerPage.locator('input.seek-slider-overlay');
    await expect(seekSlider).toBeVisible();
    const maxVal = await seekSlider.getAttribute('max');
    if (maxVal) {
      await seekViewerTo(viewerPage, maxVal);
    }

    // No final da gravação, #item-1 foi removido, #item-2 existe, e o formulário está preenchido
    await expect(replayIframe.locator('#item-2')).toBeVisible({ timeout: 5000 });
    await expect(replayIframe.locator('#item-1')).toHaveCount(0);
    await expect(replayIframe.locator('#input-name')).toHaveValue('Carlos Eduardo QA');
    await expect(replayIframe.locator('#input-email')).toHaveValue('carlos.qa@empresa.com');

    // 13. Testa Seek para trás (quando #item-1 ainda existia)
    await seekViewerTo(viewerPage, 500);

    // No instante 500ms, #item-1 DEVE estar visível no DOM do player
    await expect(replayIframe.locator('#item-1')).toBeVisible({ timeout: 5000 });

    // 14. Testa Seek para frente (volta ao fim do replay)
    if (maxVal) {
      await seekViewerTo(viewerPage, maxVal);
    }

    // No final, #item-1 deve sumir novamente e #item-2 deve permanecer
    await expect(replayIframe.locator('#item-1')).toHaveCount(0, { timeout: 5000 });
    await expect(replayIframe.locator('#item-2')).toBeVisible();

    await viewerPage.close();
  });

  test('Recorte de viagem no tempo entre snapshots: preserva elementos criados antes do corte', async ({ page }) => {
    // 1. Navega para a página sintética
    await page.goto('/tests/fidelity/synthetic.html');
    await page.waitForLoadState('domcontentloaded');

    // 2. Inicia o gravador
    await page.evaluate(async () => {
      await window.__testHelpers?.start();
    });
    await page.waitForTimeout(300);

    // 3. Cria elemento pré-corte no DOM
    await page.evaluate(() => {
      window.__testHelpers?.addItem('Elemento Pré-Corte Crítico', 'early-critical-element');
    });

    // Espera tempo suficiente para o corte de janela (ex: 2 segundos)
    await page.waitForTimeout(2200);

    // 4. Cria elemento pós-corte
    await page.evaluate(() => {
      window.__testHelpers?.addItem('Elemento Pós-Corte', 'late-element');
    });
    await page.waitForTimeout(500);

    // 5. Captura incidente com janela de recorte curta de 1 segundo (duration = 1s)
    // Isso força startedAt a ficar ~1s antes de agora, ou seja, DEPOIS que early-critical-element foi criado!
    const trimmedArtifact: FlightRecorderArtifactV1 = await page.evaluate(async () => {
      await window.__testHelpers?.capture('Teste de recorte entre snapshots', 1);
      return await window.__testHelpers!.exportLastArtifact();
    });

    expect(trimmedArtifact).toBeDefined();

    // 6. Carrega no Viewer via nova aba
    const viewerPage = await page.context().newPage();
    await viewerPage.addInitScript((art) => {
      sessionStorage.setItem('backtrack_active_artifact', JSON.stringify(art));
    }, trimmedArtifact);
    await viewerPage.goto('/viewer/index.html');
    await viewerPage.waitForLoadState('domcontentloaded');

    // 7. No replayer, move para o final da janela recortada
    const replayIframe = viewerPage.frameLocator('.replay-frame-wrapper iframe');
    await expect(replayIframe.locator('h1')).toBeVisible({ timeout: 15000 });

    const seekSlider = viewerPage.locator('input.seek-slider-overlay');
    await expect(seekSlider).toBeVisible();
    const maxVal = await seekSlider.getAttribute('max');
    if (maxVal) {
      await seekViewerTo(viewerPage, maxVal);
    }

    // O early-critical-element (criado antes da janela de 1s) e o late-element (criado dentro da janela)
    // DEVEM estar ambos visíveis no DOM reproduzido!
    await expect(replayIframe.locator('#early-critical-element')).toBeVisible({ timeout: 10000 });
    await expect(replayIframe.locator('#late-element')).toBeVisible({ timeout: 10000 });

    await viewerPage.close();
  });

  test('Recuperação após reload do navegador sem inflar duração', async ({ page }) => {
    await page.goto('/tests/fidelity/synthetic.html');
    await page.waitForLoadState('domcontentloaded');

    // Inicia e gera um incidente ativo
    await page.evaluate(async () => {
      await window.__testHelpers?.start();
      window.__testHelpers?.addItem('Antes do Reload', 'item-before-reload');
    });
    await page.waitForTimeout(300);

    // Simula reload da página
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Reinicia e valida que o gravador recupera o estado e permite nova captura
    const ok = await page.evaluate(async () => {
      if (!window.__testHelpers) return false;
      await window.__testHelpers.start();
      window.__testHelpers.addItem('Depois do Reload', 'item-after-reload');
      await window.__testHelpers.capture('Pós reload', 5);
      const art = await window.__testHelpers.exportLastArtifact();
      const duration = art.incident.finalizedAt - art.incident.startedAt;
      return duration >= 0 && duration <= 10000;
    });

    expect(ok).toBe(true);
  });

});
