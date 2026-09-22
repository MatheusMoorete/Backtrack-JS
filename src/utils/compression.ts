import type { FlightRecorderArtifactV1 } from '../types/artifact';
import { validateFlightRecorderArtifact } from '../validation/validate';

export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

function checkSize(size: number, limit: number): void {
  if (size > limit) throw new Error('O conteúdo excede o limite máximo permitido de ' + Math.round(limit / 1024 / 1024) + ' MiB.');
}

/** Cancels the producer as soon as the accumulated bytes exceed the limit. */
export async function readLimitedStream(stream: ReadableStream<Uint8Array>, limit = MAX_ARTIFACT_BYTES): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      checkSize(size, limit);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function readResponseBytes(response: Response, limit = MAX_ARTIFACT_BYTES): Promise<Uint8Array> {
  if (!response.ok) throw new Error('Falha ao baixar conteúdo (' + response.status + ').');
  const size = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(size) && size > limit) {
    await response.body?.cancel().catch(() => {});
    checkSize(size, limit);
  }
  if (response.body) {
    return readLimitedStream(response.body, limit);
  }
  if (typeof response.arrayBuffer === 'function') {
    const buf = await response.arrayBuffer();
    const bytes = new Uint8Array(buf);
    checkSize(bytes.byteLength, limit);
    return bytes;
  }
  if (typeof response.text === 'function') {
    const txt = await response.text();
    const bytes = new TextEncoder().encode(txt);
    checkSize(bytes.byteLength, limit);
    return bytes;
  }
  if (typeof response.json === 'function') {
    const obj = await response.json();
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    checkSize(bytes.byteLength, limit);
    return bytes;
  }
  throw new Error('Resposta sem conteúdo legível.');
}

/**
 * Verifica se os bytes contêm o número mágico do cabeçalho Gzip (0x1f, 0x8b).
 */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/**
 * Comprime uma string UTF-8 ou Uint8Array utilizando CompressionStream('gzip') nativo.
 */
export async function compressGzip(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;

  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([bytes as unknown as BlobPart]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const response = new Response(compressedStream);
    const blob = await response.blob();
    return new Uint8Array(await blob.arrayBuffer());
  }

  // Fallback se CompressionStream não estiver disponível
  return bytes;
}

/**
 * Descompacta bytes Gzip para string UTF-8 utilizando DecompressionStream('gzip') nativo.
 * Se os bytes não forem Gzip, decodifica diretamente como UTF-8.
 */
export async function decompressGzip(data: Uint8Array, limit = MAX_ARTIFACT_BYTES): Promise<string> {
  checkSize(data.byteLength, limit);
  if (!isGzip(data)) {
    return new TextDecoder().decode(data);
  }

  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([data as unknown as BlobPart]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await readLimitedStream(decompressedStream, limit));
  }

  throw new Error('Este navegador não suporta descompressão Gzip. Use um arquivo JSON ou um navegador compatível.');
}

/**
 * Serializa um artefato canônico v1 e comprime com Gzip nativo.
 */
export async function compressArtifact(artifact: FlightRecorderArtifactV1): Promise<Uint8Array> {
  const jsonStr = JSON.stringify(artifact);
  return compressGzip(jsonStr);
}

/**
 * Descompacta e valida um artefato a partir de ArrayBuffer, Uint8Array ou string.
 * Suporta transparentemente tanto arquivos compactados (.gz) quanto JSON comum.
 */
export async function decompressArtifact(
  data: ArrayBuffer | Uint8Array | string | unknown,
  limit = MAX_ARTIFACT_BYTES
): Promise<FlightRecorderArtifactV1> {
  let parsed: unknown;

  if (typeof data === 'object' && data !== null && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
    const serialized = JSON.stringify(data);
    checkSize(serialized.length, limit);
    checkSize(new TextEncoder().encode(serialized).byteLength, limit);
    parsed = data;
  } else if (typeof data === 'string') {
    checkSize(data.length, limit);
    checkSize(new TextEncoder().encode(data).byteLength, limit);
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new Error(
        `Falha ao converter dados em JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const text = await decompressGzip(bytes, limit);
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Falha ao converter dados em JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    throw new Error('Formato de dados inválido para o artefato.');
  }

  const validation = validateFlightRecorderArtifact(parsed);
  if (!validation.success) {
    throw new Error(`Artefato inválido: ${validation.errors.join(', ')}`);
  }

  return validation.data;
}
