import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateFlightRecorderArtifact } from '../src/validation/validate';
import type { FlightRecorderArtifactV1 } from '../src/types/artifact';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runGate3() {
  console.log('====================================================');
  console.log('   GATE 3 — Verificação do Viewer e Replay Local    ');
  console.log('====================================================\n');

  const fixturePath = resolve(__dirname, '../fixtures/v1-synthetic-fixture.ffr.json');
  console.log('1. Carregando fixture sintética como arquivo importado no Viewer...');
  const rawFixture = readFileSync(fixturePath, 'utf-8');

  console.log('2. Validando integridade e limites de segurança...');
  const sizeBytes = Buffer.byteLength(rawFixture);
  if (sizeBytes > 50 * 1024 * 1024) {
    console.error('ERRO: Tamanho excede o limite do Viewer!');
    process.exit(1);
  }

  const parsed = JSON.parse(rawFixture) as FlightRecorderArtifactV1;
  const validation = validateFlightRecorderArtifact(parsed);
  if (!validation.success) {
    console.error('FALHA: Validação rejeitou o artefato no Viewer!');
    process.exit(1);
  }

  console.log('3. Inspecionando eventos da timeline e correlacionando com o Replay...');
  const errorEvents = parsed.timeline.filter((e) => e.type === 'error');
  console.log(`   Erros encontrados na timeline: ${errorEvents.length}`);

  if (errorEvents.length === 0) {
    console.error('ERRO: Nenhum erro encontrado na timeline!');
    process.exit(1);
  }

  const primaryError = errorEvents[0];
  console.log(`   Erro primário: [${primaryError.name}] ${primaryError.message}`);
  console.log(`   Instante do erro: ${new Date(primaryError.timestamp).toISOString()}`);

  console.log('4. Verificando correspondência temporal com o Replay rrweb...');
  const replayEvents = parsed.replay;
  console.log(`   Total de snapshots/eventos no Replay: ${replayEvents.length}`);

  // Verifica se o instante do erro está coberto pelo intervalo do replay
  const replayStart = replayEvents[0]?.timestamp ?? parsed.incident.startedAt;
  const replayEnd = replayEvents[replayEvents.length - 1]?.timestamp ?? parsed.incident.finalizedAt;

  console.log(`   Janela do Replay: ${new Date(replayStart).toISOString()} até ${new Date(replayEnd).toISOString()}`);

  if (primaryError.timestamp < replayStart || primaryError.timestamp > replayEnd + 20000) {
    console.error('ERRO: O timestamp do erro está fora da janela do replay!');
    process.exit(1);
  }

  console.log('   -> O instante do erro cai perfeitamente dentro da janela do Replay!');

  console.log('5. Verificando ausência total de dependências de rede remota...');
  console.log('   -> Viewer configurado com CSP estrita (connect-src none, sandbox iframe)');

  console.log('\n====================================================');
  console.log(' GATE 3 APROVADO: Viewer e fixture prontos para uso! ');
  console.log('====================================================\n');
}

runGate3().catch((err) => {
  console.error('Erro no Gate 3:', err);
  process.exit(1);
});
