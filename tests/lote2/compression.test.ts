import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  isGzip,
  compressGzip,
  decompressGzip,
  compressArtifact,
  decompressArtifact
} from '../../src/utils/compression';
import type { FlightRecorderArtifactV1 } from '../../src/types';

describe('Compressão Gzip Nativa e Descompressão Transparente', () => {
  const fixturePath = resolve(__dirname, '../../fixtures/v1-synthetic-fixture.ffr.json');
  const fixtureContent = JSON.parse(readFileSync(fixturePath, 'utf-8')) as FlightRecorderArtifactV1;

  describe('isGzip', () => {
    it('identifica corretamente o cabeçalho mágico Gzip [0x1f, 0x8b]', () => {
      const validGzipHeader = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
      expect(isGzip(validGzipHeader)).toBe(true);

      const notGzip = new Uint8Array([0x7b, 0x22, 0x69, 0x64]); // '{"id'
      expect(isGzip(notGzip)).toBe(false);

      const tooShort = new Uint8Array([0x1f]);
      expect(isGzip(tooShort)).toBe(false);

      const empty = new Uint8Array([]);
      expect(isGzip(empty)).toBe(false);
    });
  });

  describe('compressGzip e decompressGzip', () => {
    it('comprime e descompacta string preservando 100% dos dados sem perda', async () => {
      const originalText = 'Hello Backtrack Flight Recorder! Repetição: ' + 'A'.repeat(500);
      const compressed = await compressGzip(originalText);

      expect(compressed instanceof Uint8Array).toBe(true);
      expect(isGzip(compressed)).toBe(true);
      expect(compressed.length).toBeLessThan(originalText.length);

      const decompressed = await decompressGzip(compressed);
      expect(decompressed).toBe(originalText);
    });

    it('decompressGzip decodifica texto puro UTF-8 caso receba bytes não comprimidos', async () => {
      const plainText = '{"status":"ok","type":"plain"}';
      const plainBytes = new TextEncoder().encode(plainText);

      expect(isGzip(plainBytes)).toBe(false);
      const result = await decompressGzip(plainBytes);
      expect(result).toBe(plainText);
    });

    it('suporta compressão a partir de Uint8Array diretamente', async () => {
      const payload = 'Dados binários simulados para teste de gravação de tela.';
      const rawBytes = new TextEncoder().encode(payload);
      const compressed = await compressGzip(rawBytes);

      expect(isGzip(compressed)).toBe(true);
      const decompressed = await decompressGzip(compressed);
      expect(decompressed).toBe(payload);
    });
  });

  describe('compressArtifact e decompressArtifact', () => {
    it('comprime artefato e restaura perfeitamente via decompressArtifact', async () => {
      const compressedBytes = await compressArtifact(fixtureContent);
      expect(isGzip(compressedBytes)).toBe(true);

      // Decompressing from Uint8Array
      const restored = await decompressArtifact(compressedBytes);
      expect(restored.formatVersion).toBe(1);
      expect(restored.incident.id).toBe(fixtureContent.incident.id);
      expect(restored.timeline.length).toBe(fixtureContent.timeline.length);
      expect(restored.replay.length).toBe(fixtureContent.replay.length);
      expect(restored).toEqual(fixtureContent);

      // Decompressing from ArrayBuffer
      const arrayBuffer = compressedBytes.buffer.slice(
        compressedBytes.byteOffset,
        compressedBytes.byteOffset + compressedBytes.byteLength
      );
      const restoredFromBuf = await decompressArtifact(arrayBuffer);
      expect(restoredFromBuf.incident.id).toBe(fixtureContent.incident.id);
    });

    it('decompressArtifact aceita string JSON não comprimida (retrocompatibilidade)', async () => {
      const rawJson = JSON.stringify(fixtureContent);
      const restored = await decompressArtifact(rawJson);
      expect(restored.incident.id).toBe(fixtureContent.incident.id);
      expect(restored.formatVersion).toBe(1);
    });

    it('decompressArtifact aceita objeto JSON já deserializado', async () => {
      const restored = await decompressArtifact(fixtureContent);
      expect(restored.incident.id).toBe(fixtureContent.incident.id);
    });

    it('rejeita JSON inválido com mensagem de erro clara', async () => {
      await expect(decompressArtifact('{ invalid: json')).rejects.toThrow(/Falha ao converter dados em JSON/);
    });

    it('rejeita artefatos com schema inválido', async () => {
      const invalidSchema = { formatVersion: 99, incident: {} };
      await expect(decompressArtifact(JSON.stringify(invalidSchema))).rejects.toThrow(/Artefato inválido/);
    });
  });
});
