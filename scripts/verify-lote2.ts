import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../src/storage/db';
import { FlightRecorderImpl } from '../src/core/flight-recorder';
import { validateFlightRecorderArtifact } from '../src/validation/validate';

async function runGate2() {
  console.log('====================================================');
  console.log('   GATE 2 — Verificação dos Capturadores e Replay   ');
  console.log('====================================================\n');

  const sharedIdb = new IDBFactory();

  // 1. Inicia FlightRecorder
  console.log('1. Inicializando FlightRecorder com capturadores integrados...');
  const db1 = new FlightRecorderDB(sharedIdb);
  const recorder1 = new FlightRecorderImpl(
    {
      bufferMinutes: 5,
      afterErrorSeconds: 0.2
    },
    db1
  );

  await recorder1.start();
  console.log('   Recorder em execução! Health:', recorder1.getHealth().state);

  // 2. Produz fluxo realista: logs, navegação simulada, erro
  console.log('2. Emitindo eventos pelo app (console, rede, erros)...');
  console.log('App inicializado com sucesso', { user: 'sintetico_01', auth_token: 'Bearer SecretKey123' });
  console.warn('Aviso sintético de latência na requisição');

  recorder1.captureException(new Error('Falha crítica simulada no carrinho de ingressos'), {
    source: 'react',
    componentStack: '\n    at CartView\n    at SentryBoundary\n    at App'
  });

  console.log('3. Aguardando período posterior pós-erro (150ms)...');
  await new Promise((r) => setTimeout(r, 150));

  // 4. Simula reload da página
  console.log('4. Simulando Reload da página com incidente em andamento...');
  recorder1.stop();
  db1.close();

  // Nova instância pós-reload conectada ao mesmo banco
  const db2 = new FlightRecorderDB(sharedIdb);
  const recorder2 = new FlightRecorderImpl(
    {
      bufferMinutes: 5,
      afterErrorSeconds: 0.2
    },
    db2
  );

  await recorder2.start();
  console.log('   Nova aba iniciada. Aguardando finalização do incidente...');
  await new Promise((r) => setTimeout(r, 250));

  const incidents = await recorder2.listIncidents();
  console.log(`   Incidentes encontrados após reload: ${incidents.length}`);

  if (incidents.length === 0) {
    console.error('ERRO: Nenhum incidente encontrado pós-reload!');
    process.exit(1);
  }

  const incident = incidents[0];
  console.log(`   Incidente ID: ${incident.id} (motivo: ${incident.reason})`);

  console.log('5. Exportando artefato .ffr.json...');
  const artifact = await recorder2.getArtifact(incident.id);

  console.log('6. Validando artefato contra o contrato v1...');
  const validation = validateFlightRecorderArtifact(artifact);

  if (!validation.success) {
    console.error('FALHA NA VALIDAÇÃO DO ARTEFATO:');
    validation.errors.forEach((e) => console.error(` - ${e}`));
    process.exit(1);
  }

  console.log('\n--- ARTEFATO EXPORTADO DO LOTE 2 ---');
  console.log(`Versão: ${artifact.formatVersion}`);
  console.log(`Incident ID: ${artifact.incident.id}`);
  console.log(`Eventos na timeline: ${artifact.timeline.length}`);
  console.log(`Redação ativa: verificando ausência de "SecretKey123"...`);
  const rawString = JSON.stringify(artifact);
  if (rawString.includes('SecretKey123')) {
    console.error('ERRO: Segredo "SecretKey123" vazou no artefato!');
    process.exit(1);
  }
  console.log('   -> Segredo devidamente redigido!');

  recorder2.stop();
  db2.close();

  console.log('\n====================================================');
  console.log(' GATE 2 APROVADO: Capturadores, reload e sanitização OK! ');
  console.log('====================================================\n');
}

runGate2().catch((err) => {
  console.error('Erro fatal no Gate 2:', err);
  process.exit(1);
});
