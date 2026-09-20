import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateFlightRecorderArtifact } from '../src/validation/validate';
import type { TimelineEvent } from '../src/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function formatTimelineEvent(evt: TimelineEvent): string {
  const time = new Date(evt.timestamp).toISOString().substring(11, 23);
  const prefix = `[${time} | seq=${evt.sequence}]`;

  switch (evt.type) {
    case 'navigation':
      return `${prefix} NAV: ${evt.kind} -> ${evt.toUrl}`;
    case 'console':
      return `${prefix} CONSOLE (${evt.level.toUpperCase()}): ${evt.args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
    case 'network':
      return `${prefix} NET: ${evt.method} ${evt.url} -> ${evt.status} (${evt.durationMs}ms) [${evt.result}]`;
    case 'marker':
      return `${prefix} MARKER: "${evt.label}" ${evt.data ? JSON.stringify(evt.data) : ''}`;
    case 'error':
      return `${prefix} ERROR (${evt.source}): [${evt.name}] ${evt.message}${evt.filename ? ` at ${evt.filename}:${evt.lineno}:${evt.colno}` : ''}`;
    default:
      return `${prefix} UNKNOWN`;
  }
}

function runGate0() {
  console.log('====================================================');
  console.log('   GATE 0 — Verificação de Fixture e Contratos v0.1 ');
  console.log('====================================================\n');

  const fixturePath = resolve(__dirname, '../fixtures/v1-synthetic-fixture.ffr.json');
  console.log(`Lendo fixture em: ${fixturePath}...`);

  let rawContent: string;
  try {
    rawContent = readFileSync(fixturePath, 'utf-8');
  } catch (err) {
    console.error('ERRO: Não foi possível ler o arquivo de fixture:', err);
    process.exit(1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    console.error('ERRO: JSON inválido na fixture:', err);
    process.exit(1);
  }

  console.log('Validando conformidade do artefato com o schema v1...');
  const result = validateFlightRecorderArtifact(parsed);

  if (!result.success) {
    console.error('FALHA NA VALIDAÇÃO DO GATE 0:');
    result.errors.forEach(err => console.error(` - ${err}`));
    process.exit(1);
  }

  const { data } = result;
  console.log('Artefato VÁLIDO!\n');
  console.log('--- METADATA DO INCIDENTE ---');
  console.log(`ID: ${data.incident.id}`);
  console.log(`Razão: ${data.incident.reason}`);
  console.log(`Triggers: ${data.incident.triggers.length}`);
  console.log(`Início: ${new Date(data.incident.startedAt).toLocaleTimeString()}`);
  console.log(`Disparado: ${new Date(data.incident.triggeredAt).toLocaleTimeString()}`);
  console.log(`Finalizado: ${new Date(data.incident.finalizedAt).toLocaleTimeString()}`);
  console.log(`URL do ambiente: ${data.environment.url}`);
  console.log(`Viewport: ${data.environment.viewport.width}x${data.environment.viewport.height}`);
  console.log(`Eventos rrweb replay: ${data.replay.length}`);
  console.log(`Bytes armazenados: ${data.diagnostics.storageBytes} bytes`);

  console.log('\n--- TIMELINE SINTÉTICA ---');
  data.timeline.forEach((evt) => {
    console.log(`  ${formatTimelineEvent(evt)}`);
  });

  console.log('\n====================================================');
  console.log(' GATE 0 APROVADO: Contratos e fixture validados!');
  console.log('====================================================\n');
}

runGate0();
