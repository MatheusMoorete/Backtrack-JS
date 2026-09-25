import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { App } from '../../viewer/App';
import { FileImporter } from '../../viewer/components/FileImporter';
import { TimelineView } from '../../viewer/components/TimelineView';
import { IncidentHeader } from '../../viewer/components/IncidentHeader';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

describe('Lote 3 — Viewer do Flight Recorder', () => {
  const fixturePath = resolve(__dirname, '../../fixtures/v1-synthetic-fixture.ffr.json');
  const rawFixture = readFileSync(fixturePath, 'utf-8');
  const validArtifact: FlightRecorderArtifactV1 = JSON.parse(rawFixture);

  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sessionStorage.clear();
    fetchSpy = vi.fn();
    window.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as any).opener;
    history.replaceState(null, '', '/');
  });

  it('FileImporter rejeita arquivo que excede o limite máximo antes de fazer parse', async () => {
    const onLoaded = vi.fn();
    render(<FileImporter onArtifactLoaded={onLoaded} maxSizeBytes={1024} />);

    // Cria arquivo simulado com 2048 bytes (> 1024 bytes)
    const largeContent = 'a'.repeat(2048);
    const largeFile = new File([largeContent], 'large-incident.ffr.json', {
      type: 'application/json'
    });

    const dropzone = screen.getByRole('button', { name: /área de importação/i });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [largeFile]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/excede o limite máximo permitido/i)).toBeDefined();
    });

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('FileImporter exibe erro controlado quando o JSON é inválido', async () => {
    const onLoaded = vi.fn();
    render(<FileImporter onArtifactLoaded={onLoaded} />);

    const corruptedFile = new File(['{ invalid json content !!!'], 'corrupted.ffr.json', {
      type: 'application/json'
    });

    const dropzone = screen.getByRole('button', { name: /área de importação/i });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [corruptedFile]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/converter dados em JSON|não é um json válido/i)).toBeDefined();
    });

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('FileImporter exibe erro de versão desconhecida do schema', async () => {
    const onLoaded = vi.fn();
    render(<FileImporter onArtifactLoaded={onLoaded} />);

    const wrongVersionFile = new File(
      [JSON.stringify({ ...validArtifact, formatVersion: 99 })],
      'v99.ffr.json',
      { type: 'application/json' }
    );

    const dropzone = screen.getByRole('button', { name: /área de importação/i });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [wrongVersionFile]
      }
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
      expect(screen.getByText(/versão do formato desconhecida/i)).toBeDefined();
    });

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('App renderiza fixture válida com cabeçalho, replay e timeline', async () => {
    render(<App />);

    // Simula importação da fixture canônica
    const validFile = new File([rawFixture], 'fixture.ffr.json', {
      type: 'application/json'
    });

    const dropzone = screen.getByRole('button', { name: /área de importação/i });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile]
      }
    });

    await waitFor(() => {
      // Metadados no cabeçalho
      expect(screen.getByText(/inc_synth_019482/i)).toBeDefined();
    });

    // Timeline contém itens
    expect(screen.getAllByText(/demo\/event\/:id\?tab/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Aplicação sintética inicializada/i)).toBeDefined();
  });

  it('TimelineView filtra eventos por categoria e busca textual', async () => {
    const onSelect = vi.fn();
    render(
      <TimelineView
        events={validArtifact.timeline}
        currentTimeMs={validArtifact.incident.triggeredAt}
        onSelectEvent={onSelect}
      />
    );

    // Inicialmente mostra todos os eventos
    expect(screen.getByText(/Aplicação sintética inicializada/i)).toBeDefined();

    // Filtra por Erros (Errors)
    const errorFilterBtn = screen.getByRole('button', { name: 'Errors' });
    fireEvent.click(errorFilterBtn);

    // Evento de console comum desaparece, erro permanece
    expect(screen.queryByText(/Aplicação sintética inicializada/i)).toBeNull();
    expect(screen.getAllByText(/Cannot read properties of undefined/i).length).toBeGreaterThan(0);

    // Volta para Todos (All) e busca por "500"
    const allFilterBtn = screen.getByRole('button', { name: 'All' });
    fireEvent.click(allFilterBtn);

    const searchInput = screen.getByRole('searchbox', { name: /buscar na timeline/i });
    fireEvent.change(searchInput, { target: { value: 'checkout/reserve' } });

    expect(screen.getByText(/checkout\/reserve/i)).toBeDefined();
    expect(screen.queryByText(/Aplicação sintética inicializada/i)).toBeNull();
  });

  it('clique em item da timeline invoca onSelectEvent para seek no replay', () => {
    const onSelect = vi.fn();
    render(
      <TimelineView
        events={validArtifact.timeline}
        currentTimeMs={0}
        onSelectEvent={onSelect}
      />
    );

    const firstItem = screen.getByText(/demo\/event\/:id\?tab/i);
    fireEvent.click(firstItem);

    expect(onSelect).toHaveBeenCalledWith(validArtifact.timeline[0].timestamp);
  });

  it('lista interações do replay sem expor o conteúdo digitado', () => {
    const onSelect = vi.fn();
    const timestamp = validArtifact.incident.startedAt + 1000;
    render(
      <TimelineView
        events={[]}
        replayEvents={[
          { type: 3, timestamp, data: { source: 2, type: 2, id: 11, x: 120, y: 180 } },
          { type: 3, timestamp: timestamp + 1000, data: { source: 5, id: 12, text: 'segredo' } },
          { type: 3, timestamp: timestamp + 2000, data: { source: 3, id: 13, x: 0, y: 300 } }
        ]}
        startedAt={validArtifact.incident.startedAt}
        currentTimeMs={0}
        onSelectEvent={onSelect}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: /Interações/ }));

    expect(screen.getByText(/Click em elemento #11/i)).toBeDefined();
    expect(screen.getByText(/Elemento #12 alterado — conteúdo oculto/i)).toBeDefined();
    expect(screen.queryByText('segredo')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Input' }));
    expect(screen.getByText(/Elemento #12 alterado — conteúdo oculto/i)).toBeDefined();
    expect(screen.queryByText(/Click em elemento #11/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    fireEvent.click(screen.getByText(/Click em elemento #11/i));
    expect(onSelect).toHaveBeenCalledWith(timestamp);
  });

  it('PROVA DE SEGURANÇA: nenhuma requisição de rede externa é realizada ao abrir e inspecionar a fixture', async () => {
    render(<App />);

    const validFile = new File([rawFixture], 'fixture.ffr.json', {
      type: 'application/json'
    });

    const dropzone = screen.getByRole('button', { name: /área de importação/i });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile]
      }
    });

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });

    // Confirma zero chamadas fetch
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ignora mensagens postMessage quando não existir opener ou origem confiável', async () => {
    (window as any).opener = null;
    history.replaceState(null, '', '/');
    render(<App />);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'LOAD_FFR_ARTIFACT',
          artifact: validArtifact
        },
        origin: 'http://malicious.site'
      })
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(validArtifact.incident.id)).toBeNull();
  });

  it('carrega artefato automaticamente ao receber mensagem postMessage LOAD_FFR_ARTIFACT de opener confiável', async () => {
    const opener = { postMessage: vi.fn() };
    (window as any).opener = opener;
    history.replaceState(null, '', '?openerOrigin=http://localhost:3000');

    render(<App />);

    // Simula evento postMessage vindo de uma janela do uTicket
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'LOAD_FFR_ARTIFACT',
          artifact: validArtifact
        },
        origin: 'http://localhost:3000',
        source: opener as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });
  });

  it('ReplayPlayer exibe botões de salto segundo a segundo e controle de zoom', async () => {
    const opener = { postMessage: vi.fn() };
    (window as any).opener = opener;
    history.replaceState(null, '', '?openerOrigin=http://localhost:3000');

    render(<App />);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'LOAD_FFR_ARTIFACT',
          artifact: validArtifact
        },
        origin: 'http://localhost:3000',
        source: opener as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });

    // Botões de salto de segundo
    expect(screen.getByRole('button', { name: 'Voltar 1 segundo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Avançar 1 segundo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Voltar 5 segundos' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Avançar 5 segundos' })).toBeDefined();

    // Botões de navegação frame a frame e pulo para erro
    expect(screen.getByRole('button', { name: 'Voltar 1 frame' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Avançar 1 frame' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Pular para o momento do erro' })).toBeDefined();

    // Botão de alternar anotação de tela foi removido dos controles
    expect(screen.queryByText(/Anotações ON/i)).toBeNull();
    expect(screen.queryByText(/Anotações OFF/i)).toBeNull();

    // Controle de Zoom
    const zoomSelect = screen.getByRole('combobox', { name: 'Controle de Zoom' });
    expect(zoomSelect).toBeDefined();

    // Altera o zoom para 50%
    fireEvent.change(zoomSelect, { target: { value: '0.5' } });
    expect((zoomSelect as HTMLSelectElement).value).toBe('0.5');

    // Clica em avançar 1 segundo
    const forward1sBtn = screen.getByRole('button', { name: 'Avançar 1 segundo' });
    fireEvent.click(forward1sBtn);

    // Clica em avançar 1 frame
    const forwardFrameBtn = screen.getByRole('button', { name: 'Avançar 1 frame' });
    fireEvent.click(forwardFrameBtn);

    // Clica em pular para o momento do erro
    const jumpErrorBtn = screen.getByRole('button', { name: 'Pular para o momento do erro' });
    fireEvent.click(jumpErrorBtn);
  });

  it('abas responsivas alternam o painel selecionado sem descarregar o incidente nem perder a timeline', async () => {
    const opener = { postMessage: vi.fn() };
    (window as any).opener = opener;
    history.replaceState(null, '', '?openerOrigin=http://localhost:3000');

    render(<App />);

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'LOAD_FFR_ARTIFACT',
          artifact: validArtifact
        },
        origin: 'http://localhost:3000',
        source: opener as unknown as MessageEventSource
      })
    );

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });

    const replayTab = screen.getByRole('tab', { name: 'Replay' });
    const timelineTab = screen.getByRole('tab', { name: 'Eventos' });

    // Inicialmente inicia em Replay
    expect(replayTab.getAttribute('aria-selected')).toBe('true');
    expect(timelineTab.getAttribute('aria-selected')).toBe('false');

    const replayPanel = screen.getByRole('tabpanel', { name: 'Replay' });
    const timelinePanel = screen.getByRole('tabpanel', { name: 'Eventos' });

    expect(replayPanel.classList.contains('mobile-hidden')).toBe(false);
    expect(timelinePanel.classList.contains('mobile-hidden')).toBe(true);

    // Alterna para aba Eventos
    fireEvent.click(timelineTab);

    expect(replayTab.getAttribute('aria-selected')).toBe('false');
    expect(timelineTab.getAttribute('aria-selected')).toBe('true');
    expect(replayPanel.classList.contains('mobile-hidden')).toBe(true);
    expect(timelinePanel.classList.contains('mobile-hidden')).toBe(false);

    // O incidente continua perfeitamente carregado
    expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    expect(screen.getByText(/Aplicação sintética inicializada/i)).toBeDefined();

    // Alterna de volta para Replay
    fireEvent.click(replayTab);

    expect(replayTab.getAttribute('aria-selected')).toBe('true');
    expect(timelineTab.getAttribute('aria-selected')).toBe('false');
    expect(replayPanel.classList.contains('mobile-hidden')).toBe(false);
    expect(timelinePanel.classList.contains('mobile-hidden')).toBe(true);
    expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
  });

  it('carrega artefato automaticamente a partir do parâmetro ?gist=<id>', async () => {
    history.pushState(null, '', '?gist=gist_test_456');

    const mockGistResponse = {
      files: {
        'incident.ffr.json': {
          content: JSON.stringify(validArtifact)
        }
      }
    };

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => mockGistResponse
    } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/gists/gist_test_456',
      expect.objectContaining({ headers: { Accept: 'application/vnd.github+json' } })
    );

    history.pushState(null, '', '/');
  });

  it('carrega artefato automaticamente a partir do parâmetro ?url=<url>', async () => {
    history.pushState(null, '', '?url=https%3A%2F%2Fstorage.example.com%2Fincident.ffr.json');

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => validArtifact
    } as Response);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(validArtifact.incident.id)).toBeDefined();
    });

    expect(fetchSpy).toHaveBeenCalledWith('https://storage.example.com/incident.ffr.json');

    history.pushState(null, '', '/');
  });

  it('exibe título Backtrack JS com versão, remove badge manual e abre modal Compartilhar', async () => {
    const onReset = vi.fn();
    render(<IncidentHeader artifact={validArtifact} onReset={onReset} />);

    expect(screen.getByText('Backtrack JS')).toBeDefined();

    // Badge com 'manual' deve ter sido removido
    expect(document.querySelector('.incident-status-badge')).toBeNull();

    // Botão Compartilhar deve estar visível
    const shareBtn = screen.getByRole('button', { name: /compartilhar/i });
    expect(shareBtn).toBeDefined();

    // Abre modal de compartilhamento
    fireEvent.click(shareBtn);

    expect(screen.getByText('Compartilhar Incidente')).toBeDefined();
    expect(screen.getByText('Compartilhar via Link')).toBeDefined();
    expect(screen.getByText('Baixar Arquivo da Gravação')).toBeDefined();

    // Pressiona tecla Escape para fechar modal
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByText('Compartilhar Incidente')).toBeNull();
  });

  it('exibe aviso de gravação incompleta no header com motivos e nota de eventos desconhecidos quando degraded for true', () => {
    const degradedArtifact: FlightRecorderArtifactV1 = {
      ...validArtifact,
      diagnostics: {
        degraded: true,
        degradedReasons: [
          'Um ou mais lotes da gravação não foram encontrados.',
          'Parte do replay não pôde ser descomprimida; a gravação pode estar incompleta.'
        ],
        droppedEvents: 0,
        droppedEventsUnknown: true,
        storageBytes: 1024
      }
    };

    render(<IncidentHeader artifact={degradedArtifact} onReset={vi.fn()} />);

    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Gravação incompleta')).toBeDefined();
    expect(screen.getByText('Um ou mais lotes da gravação não foram encontrados.')).toBeDefined();
    expect(
      screen.getByText('Parte do replay não pôde ser descomprimida; a gravação pode estar incompleta.')
    ).toBeDefined();
    expect(screen.getByText(/quantidade total de eventos perdidos é desconhecida/i)).toBeDefined();
    expect(screen.getByText('Perdas: quantidade desconhecida')).toBeDefined();
  });

  it('não exibe aviso de gravação incompleta para artefato íntegro (degraded: false)', () => {
    const cleanArtifact: FlightRecorderArtifactV1 = {
      ...validArtifact,
      diagnostics: {
        degraded: false,
        degradedReasons: [],
        droppedEvents: 0,
        storageBytes: 1024
      }
    };

    render(<IncidentHeader artifact={cleanArtifact} onReset={vi.fn()} />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Gravação incompleta')).toBeNull();
  });
});

