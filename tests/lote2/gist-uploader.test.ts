import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadArtifactToGist } from '../../src/utils/gist-uploader';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

const mockArtifact: FlightRecorderArtifactV1 = {
  formatVersion: 1,
  recorderVersion: '0.2.1',
  incident: {
    id: 'inc_test_999',
    reason: 'manual',
    triggers: [],
    startedAt: 1000,
    triggeredAt: 2000,
    finalizedAt: 2000
  },
  environment: {
    url: 'http://localhost:3000',
    userAgent: 'test-agent',
    viewport: { width: 1920, height: 1080 }
  },
  timeline: [],
  replay: [],
  diagnostics: {
    droppedEvents: 0,
    storageBytes: 128,
    degraded: false,
    degradedReasons: []
  }
};

describe('GitHub Gist Uploader', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('faz o upload com sucesso e retorna gistId, gistUrl e rawUrl', async () => {
    const mockResponse = {
      id: 'gist_abc_123',
      html_url: 'https://gist.github.com/user/gist_abc_123',
      files: {
        'backtrack-inc_test_999.ffr.json': {
          raw_url: 'https://gist.githubusercontent.com/user/gist_abc_123/raw/backtrack-inc_test_999.ffr.json'
        }
      }
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => mockResponse
    } as Response);

    const result = await uploadArtifactToGist(mockArtifact, 'ghp_fake_token_123');

    expect(result.gistId).toBe('gist_abc_123');
    expect(result.gistUrl).toBe('https://gist.github.com/user/gist_abc_123');
    expect(result.rawUrl).toContain('gist_abc_123/raw');

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.github.com/gists',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghp_fake_token_123',
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        })
      })
    );
  });

  it('lança erro amigável quando o token não for fornecido', async () => {
    await expect(uploadArtifactToGist(mockArtifact, '')).rejects.toThrow(
      'GitHub Token não fornecido'
    );
    await expect(uploadArtifactToGist(mockArtifact, '   ')).rejects.toThrow(
      'GitHub Token não fornecido'
    );
  });

  it('trata erro 401 de autenticação do GitHub', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ message: 'Bad credentials' })
    } as Response);

    await expect(uploadArtifactToGist(mockArtifact, 'invalid_token')).rejects.toThrow(
      /Falha de autenticação no GitHub \(401\)/
    );
  });

  it('trata erro 422 de limite de tamanho do GitHub', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({ message: 'File too large' })
    } as Response);

    await expect(uploadArtifactToGist(mockArtifact, 'valid_token')).rejects.toThrow(
      /limite suportado pelo GitHub Gist/
    );
  });

  it('rejeita artefato local com tamanho superior a 10 MB antes de chamar a API', async () => {
    const hugeArtifact: FlightRecorderArtifactV1 = {
      ...mockArtifact,
      environment: {
        ...mockArtifact.environment,
        userAgent: 'x'.repeat(11 * 1024 * 1024)
      }
    };

    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await expect(uploadArtifactToGist(hugeArtifact, 'valid_token')).rejects.toThrow(
      'O artefato excede o limite máximo de 10 MB suportado para upload.'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
