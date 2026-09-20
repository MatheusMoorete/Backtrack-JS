import React, { useState, useRef } from 'react';
import { validateFlightRecorderArtifact } from '../../src/validation/validate';
import type { FlightRecorderArtifactV1 } from '../../src/types/artifact';

interface FileImporterProps {
  onArtifactLoaded: (artifact: FlightRecorderArtifactV1) => void;
  maxSizeBytes?: number; // default 50 MB
}

export const FileImporter: React.FC<FileImporterProps> = ({
  onArtifactLoaded,
  maxSizeBytes = 50 * 1024 * 1024
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    setErrorMessages(null);

    // 1. Limite de tamanho antes de ler
    if (file.size > maxSizeBytes) {
      const mb = Math.round(maxSizeBytes / (1024 * 1024));
      setErrorMessages([`O arquivo selecionado (${(file.size / (1024 * 1024)).toFixed(1)} MB) excede o limite máximo permitido de ${mb} MB.`]);
      return;
    }

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setErrorMessages(['O arquivo importado não é um JSON válido. Verifique se o arquivo está corrompido.']);
        return;
      }

      const validation = validateFlightRecorderArtifact(parsed);
      if (!validation.success) {
        setErrorMessages(validation.errors);
        return;
      }

      try {
        sessionStorage.setItem('ffr_active_artifact', JSON.stringify(validation.data));
      } catch {
        // Ignora
      }

      onArtifactLoaded(validation.data);
    } catch (err) {
      setErrorMessages([`Falha ao ler arquivo: ${err instanceof Error ? err.message : String(err)}`]);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="importer-wrapper">
      <div
        className={`dropzone ${isDragOver ? 'dragover' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Área de importação de arquivo de incidente do Backtrack"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="dropzone-icon" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <h2>Abrir Gravação</h2>
        <p className="dropzone-description">
          Arraste o arquivo <strong>.ffr.json</strong> para esta área ou use o botão abaixo.
        </p>
        <button
          type="button"
          className="btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
        >
          Abrir gravação
        </button>

        <p className="importer-hint">
          Processamento local seguro no navegador. Formato suportado: .ffr.json (máximo {Math.round(maxSizeBytes / (1024 * 1024))} MB).
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.ffr.json"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
      </div>

      {errorMessages && errorMessages.length > 0 && (
        <div className="import-error" role="alert">
          <strong>Não foi possível carregar o arquivo:</strong>
          <ul>
            {errorMessages.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
