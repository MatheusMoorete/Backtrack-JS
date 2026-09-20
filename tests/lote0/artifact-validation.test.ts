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
});
