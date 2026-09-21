import type { FlightRecorderArtifactV1 } from '../types/artifact';

export interface GistUploadResult {
  gistId: string;
  gistUrl: string;
  rawUrl: string;
}

/**
 * Faz o upload de um artefato .ffr.json como um Gist Secreto no GitHub.
 * Requer um Personal Access Token com o escopo 'gist'.
 */
export async function uploadArtifactToGist(
  artifact: FlightRecorderArtifactV1,
  githubToken: string
): Promise<GistUploadResult> {
  if (!githubToken || !githubToken.trim()) {
    throw new Error('GitHub Token não fornecido. Gere um token com o escopo "gist".');
  }

  const cleanToken = githubToken.trim();
  const filename = `backtrack-${artifact.incident.id}.ffr.json`;
  const description = `Backtrack Incident Replay [${artifact.incident.id}]: ${artifact.incident.reason}`;

  const payload = {
    description,
    public: false,
    files: {
      [filename]: {
        content: JSON.stringify(artifact, null, 2)
      }
    }
  };

  const response = await fetch('https://api.github.com/gists', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson.message || JSON.stringify(errJson);
    } catch {
      errorDetail = response.statusText;
    }

    if (response.status === 401) {
      throw new Error(`Falha de autenticação no GitHub (401). Verifique se o seu token possui o escopo 'gist': ${errorDetail}`);
    }
    if (response.status === 422) {
      throw new Error(`O arquivo excede o limite suportado pelo GitHub Gist (10MB): ${errorDetail}`);
    }
    throw new Error(`Erro ao criar Gist no GitHub (${response.status}): ${errorDetail}`);
  }

  const data = await response.json();
  const fileData = data.files && (data.files[filename] || Object.values(data.files)[0]);

  return {
    gistId: data.id,
    gistUrl: data.html_url,
    rawUrl: (fileData as { raw_url?: string } | undefined)?.raw_url || data.html_url
  };
}
