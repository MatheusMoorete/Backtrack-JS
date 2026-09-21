import type { FlightRecorderArtifactV1 } from '../types/artifact';
import { validateFlightRecorderArtifact } from '../validation/validate';

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
export async function decompressGzip(data: Uint8Array): Promise<string> {
  if (!isGzip(data)) {
    return new TextDecoder().decode(data);
  }

  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([data as unknown as BlobPart]).stream();
    const decompressedStream = stream.pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressedStream);
    return await response.text();
  }

  // Fallback simples
  return new TextDecoder().decode(data);
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
  data: ArrayBuffer | Uint8Array | string | unknown
): Promise<FlightRecorderArtifactV1> {
  let parsed: unknown;

  if (typeof data === 'object' && data !== null && !(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
    parsed = data;
  } else if (typeof data === 'string') {
    try {
      parsed = JSON.parse(data);
    } catch (err) {
      throw new Error(
        `Falha ao converter dados em JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const text = await decompressGzip(bytes);
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
