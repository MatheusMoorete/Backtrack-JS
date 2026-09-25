import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateFlightRecorderArtifact, sortTimelineEvents } from '../../src/validation/validate';
import type { FlightRecorderArtifactV1, TimelineEvent } from '../../src/types';

describe('Lote 0 — Validação do Artefato v1', () => {
  const fixturePath = resolve(__dirname, '../../fixtures/v1-synthetic-fixture.ffr.json');
  const fixtureContent = JSON.parse(readFileSync(fixturePath, 'utf-8')) as FlightRecorderArtifactV1;

  it('aceita a fixture sintética canônica v1 válida', () => {
    const result = validateFlightRecorderArtifact(fixtureContent);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formatVersion).toBe(1);
      expect(result.data.incident.id).toBe('inc_synth_019482');
      expect(result.data.timeline.length).toBeGreaterThan(0);
      expect(result.data.replay.length).toBeGreaterThan(0);
    }
  });

  it('rejeita artefato não-objeto ou nulo', () => {
    expect(validateFlightRecorderArtifact(null).success).toBe(false);
    expect(validateFlightRecorderArtifact('string').success).toBe(false);
    expect(validateFlightRecorderArtifact(123).success).toBe(false);
  });

  it('rejeita formatVersion desconhecido (ex: v2 ou undefined)', () => {
    const invalidVersion = { ...fixtureContent, formatVersion: 2 };
    const result = validateFlightRecorderArtifact(invalidVersion);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some(e => e.includes('Versão do formato desconhecida'))).toBe(true);
    }
  });

  it('rejeita quando faltam campos obrigatórios (incident, environment, timeline, replay, diagnostics)', () => {
    const missingIncident = { ...fixtureContent };
    delete (missingIncident as Record<string, unknown>).incident;
    const res1 = validateFlightRecorderArtifact(missingIncident);
    expect(res1.success).toBe(false);

    const missingTimeline = { ...fixtureContent };
    delete (missingTimeline as Record<string, unknown>).timeline;
    const res2 = validateFlightRecorderArtifact(missingTimeline);
    expect(res2.success).toBe(false);

    const missingDiagnostics = { ...fixtureContent };
    delete (missingDiagnostics as Record<string, unknown>).diagnostics;
    const res3 = validateFlightRecorderArtifact(missingDiagnostics);
    expect(res3.success).toBe(false);
  });

  it('rejeita razão de incidente desconhecida', () => {
    const badReason = {
      ...fixtureContent,
      incident: { ...fixtureContent.incident, reason: 'unknown_magic' as unknown }
    };
    const res = validateFlightRecorderArtifact(badReason);
    expect(res.success).toBe(false);
  });

  it('rejeita timeline desordenada', () => {
    const disordered = {
      ...fixtureContent,
      timeline: [
        fixtureContent.timeline[1], // t=1710000005000
        fixtureContent.timeline[0]  // t=1710000000000 (menor depois do maior)
      ]
    };
    const res = validateFlightRecorderArtifact(disordered);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some(e => e.includes('Timeline fora de ordem cronológica'))).toBe(true);
    }
  });

  it('ordena eventos corretamente com sortTimelineEvents', () => {
    const unorderedEvents: TimelineEvent[] = [
      { id: '2', timestamp: 200, sequence: 1, type: 'marker', label: 'B' },
      { id: '3', timestamp: 200, sequence: 2, type: 'marker', label: 'C' },
      { id: '1', timestamp: 100, sequence: 1, type: 'marker', label: 'A' },
      { id: '2b', timestamp: 200, sequence: 0, type: 'marker', label: 'B0' }
    ];

    const sorted = sortTimelineEvents(unorderedEvents);
    expect(sorted.map(e => e.id)).toEqual(['1', '2b', '2', '3']);
  });

  it('rejeita replay contendo evento nulo ou inválido (ex: replay: [null])', () => {
    const withNullReplay = {
      ...fixtureContent,
      replay: [null as unknown]
    };
    const res = validateFlightRecorderArtifact(withNullReplay);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('Evento de replay inválido'))).toBe(true);
    }
  });

  it('rejeita incidente com término anterior ao início (duração negativa)', () => {
    const negativeDuration = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        startedAt: 2000,
        finalizedAt: 1000 // menor que startedAt
      }
    };
    const res = validateFlightRecorderArtifact(negativeDuration);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('término do incidente não pode anteceder o início'))).toBe(true);
    }
  });

  it('rejeita dimensões de viewport inválidas ou não-positivas', () => {
    const zeroWidth = {
      ...fixtureContent,
      environment: {
        ...fixtureContent.environment,
        viewport: { width: 0, height: 768 }
      }
    };
    const res = validateFlightRecorderArtifact(zeroWidth);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('Dimensões da viewport inválidas'))).toBe(true);
    }
  });

  it('preserva e aceita eventos Meta legítimos ocorrendo antes de startedAt', () => {
    const startedAt = 10000;
    const metaEvent = {
      type: 4,
      data: { href: 'http://localhost/', width: 1920, height: 1080 },
      timestamp: startedAt - 1 // Meta antes do início
    };
    const snapshotEvent = {
      type: 2,
      data: { node: { id: 1, type: 0 } },
      timestamp: startedAt
    };

    const validWithEarlyMeta = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        startedAt,
        finalizedAt: startedAt + 5000
      },
      replay: [metaEvent, snapshotEvent]
    };

    const res = validateFlightRecorderArtifact(validWithEarlyMeta);
    expect(res.success).toBe(true);
  });

  it('aceita eventos legítimos de replay comuns em dispositivos móveis (Selection, Touch, AdoptedStyleSheet)', () => {
    const startedAt = 10000;
    const mobileEvents = [
      {
        type: 4,
        data: { href: 'https://app.uticket.com.br/', width: 390, height: 844 },
        timestamp: startedAt
      },
      {
        type: 2,
        data: { node: { id: 1, type: 0, childNodes: [] } },
        timestamp: startedAt + 10
      },
      // TouchMove (source: 6)
      {
        type: 3,
        data: {
          source: 6,
          positions: [{ x: 120, y: 350, id: 10, timeOffset: 5 }]
        },
        timestamp: startedAt + 20
      },
      // Selection change no celular (source: 14) sem campo id no root de data
      {
        type: 3,
        data: {
          source: 14,
          ranges: [{ start: 5, startOffset: 0, end: 5, endOffset: 10 }]
        },
        timestamp: startedAt + 30
      },
      // MouseInteraction tipo TouchStart (source: 2)
      {
        type: 3,
        data: {
          source: 2,
          type: 7, // TouchStart
          id: 15,
          x: 120,
          y: 350,
          pointerType: 2 // Touch
        },
        timestamp: startedAt + 40
      },
      // AdoptedStyleSheet (source: 15)
      {
        type: 3,
        data: {
          source: 15,
          id: 1,
          styleIds: [1]
        },
        timestamp: startedAt + 50
      },
      // StyleSheetRule com styleId sem id (source: 8)
      {
        type: 3,
        data: {
          source: 8,
          styleId: 3,
          adds: [{ rule: '.mobile { display: block; }', index: 0 }]
        },
        timestamp: startedAt + 60
      }
    ];

    const mobileArtifact = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        startedAt,
        finalizedAt: startedAt + 1000
      },
      replay: mobileEvents
    };

    const res = validateFlightRecorderArtifact(mobileArtifact);
    expect(res.success).toBe(true);
  });

  it('rejeita artefato quando triggers contém null ou item inválido', () => {
    const invalidTriggers = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        triggers: [null]
      }
    };
    const res = validateFlightRecorderArtifact(invalidTriggers);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('Gatilho no índice 0 deve ser um objeto válido'))).toBe(true);
    }
  });

  it('rejeita timeline console quando args não é array', () => {
    const invalidConsole = {
      ...fixtureContent,
      timeline: [
        {
          id: 'con_1',
          timestamp: fixtureContent.incident.startedAt,
          sequence: 1,
          type: 'console',
          level: 'log',
          args: 'not-an-array' // inválido
        }
      ]
    };
    const res = validateFlightRecorderArtifact(invalidConsole);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('deve possuir "args" como array'))).toBe(true);
    }
  });

  it('rejeita annotationImage externa (http, https, javascript) e aceita apenas data:base64 segura', () => {
    const externalImage = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        annotationImage: 'https://malicious.site/exfiltrate?token=123'
      }
    };
    const resExternal = validateFlightRecorderArtifact(externalImage);
    expect(resExternal.success).toBe(false);
    if (!resExternal.success) {
      expect(resExternal.errors.some((e) => e.includes('annotationImage'))).toBe(true);
    }

    const validDataImage = {
      ...fixtureContent,
      incident: {
        ...fixtureContent.incident,
        annotationImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      }
    };
    const resValid = validateFlightRecorderArtifact(validDataImage);
    expect(resValid.success).toBe(true);
  });

  it('rejeita replayWindow quando requestedEndedAt antecede requestedStartedAt ou preparationEventCount não é inteiro', () => {
    const invertedReplayWindow = {
      ...fixtureContent,
      replayWindow: {
        requestedStartedAt: 20000,
        requestedEndedAt: 10000, // invertido
        preparationEventCount: 0
      }
    };
    const res = validateFlightRecorderArtifact(invertedReplayWindow);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.errors.some((e) => e.includes('requestedEndedAt'))).toBe(true);
    }

    const floatPrepCount = {
      ...fixtureContent,
      replayWindow: {
        requestedStartedAt: 10000,
        requestedEndedAt: 20000,
        preparationEventCount: 3.5 // float inválido
      }
    };
    const resFloat = validateFlightRecorderArtifact(floatPrepCount);
    expect(resFloat.success).toBe(false);
    if (!resFloat.success) {
      expect(resFloat.errors.some((e) => e.includes('preparationEventCount'))).toBe(true);
    }
  });
});

