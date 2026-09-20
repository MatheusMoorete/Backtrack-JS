import { IDBFactory } from 'fake-indexeddb';
import { FlightRecorderDB } from '../src/storage/db';
import { BatchWriter } from '../src/storage/batch-writer';
import { IncidentManager } from '../src/storage/incident-manager';
import { validateFlightRecorderArtifact } from '../src/validation/validate';
import type { EnvironmentMetadata } from '../src/types/artifact';

async function runGate1() {
  console.log('====================================================');
  console.log('   GATE 1 — Verificação de Storage e Incidentes     ');
  console.log('====================================================\n');

  // 1. Simula IndexedDB compartilhado pelo browser
  const sharedIdb = new IDBFactory();
  const sessionId = 'session_gate1_sim';
  const tabId = 'tab_gate1_sim';

  const mockEnv: EnvironmentMetadata = {
    url: 'http://localhost:3000/checkout',
    userAgent: 'Gate1Browser/1.0',
    viewport: { width: 1280, height: 800 }
  };

  console.log('1. Gravando eventos pré-bug no IndexedDB antes do F5...');
  const db1 = new FlightRecorderDB(sharedIdb);
  const writer1 = new BatchWriter(db1, sessionId, tabId);
  const incidentMgr1 = new IncidentManager(db1, sessionId, tabId, mockEnv, {
    afterErrorSeconds: 2
  });

  writer1.addTimelineEvent({
    id: 'e_nav',
    timestamp: 1000,
    sequence: 1,
    type: 'navigation',
    kind: 'initial',
    toUrl: 'http://localhost:3000/checkout'
  });
  writer1.addReplayEvent({
    type: 4,
    data: { href: 'http://localhost:3000/checkout', width: 1280, height: 800 },
    timestamp: 1000
  });

  writer1.addTimelineEvent({
    id: 'e_net',
    timestamp: 1500,
    sequence: 2,
    type: 'network',
    method: 'POST',
    url: 'http://localhost:3000/api/order',
    status: 500,
    durationMs: 250,
    result: 'error'
  });

  await writer1.flush();

  console.log('2. Disparando trigger automático de incidente...');
  const incidentId = await incidentMgr1.trigger('http', {
    id: 'trig_500',
    timestamp: 1510,
    type: 'http',
    signature: 'HTTP 500 POST /api/order'
  });

  console.log(`   Incidente criado: ${incidentId} (state=pending)`);

  // Simula F5: fecha conexões da aba anterior
  writer1.destroy();
  incidentMgr1.destroy();
  db1.close();

  console.log('3. Simulando F5 / Reload da página...');
  // Nova aba abrindo o mesmo IndexedDB com os mesmos tabId/sessionId (via sessionStorage)
  const db2 = new FlightRecorderDB(sharedIdb);
  const incidentMgr2 = new IncidentManager(db2, sessionId, tabId, mockEnv, {
    afterErrorSeconds: 2
  });

  console.log('4. Inicializando IncidentManager na nova página (recuperação pós-reload)...');
  await incidentMgr2.init();

  const pending = incidentMgr2.getPendingIncident();
  if (!pending) {
    console.error('ERRO: Incidente pendente não foi recuperado após o reload!');
    process.exit(1);
  }
  console.log(`   Incidente recuperado com sucesso: ${pending.id} (status=${pending.state})`);

  console.log('5. Gravando evento complementar pós-reload...');
  const writer2 = new BatchWriter(db2, sessionId, tabId);
  writer2.addTimelineEvent({
    id: 'e_post_reload',
    timestamp: 1800,
    sequence: 3,
    type: 'marker',
    label: 'Page reloaded after error'
  });
  await writer2.flush();

  console.log('6. Finalizando o incidente...');
  await incidentMgr2.finalize(incidentId);

  console.log('7. Exportando incidente como artefato canônico .ffr.json...');
  const artifact = await incidentMgr2.exportArtifact(incidentId);

  console.log('8. Validando conformidade do artefato exportado com o schema v1...');
  const validation = validateFlightRecorderArtifact(artifact);

  if (!validation.success) {
    console.error('FALHA: Artefato gerado pelo Lote 1 é inválido:');
    validation.errors.forEach((e) => console.error(` - ${e}`));
    process.exit(1);
  }

  console.log('\n--- ARTEFATO EXPORTADO COM SUCESSO ---');
  console.log(`Incident ID: ${artifact.incident.id}`);
  console.log(`Eventos na timeline: ${artifact.timeline.length}`);
  console.log(`Eventos no replay: ${artifact.replay.length}`);
  console.log(`Bytes calculados: ${artifact.diagnostics.storageBytes}`);

  writer2.destroy();
  incidentMgr2.destroy();
  db2.close();

  console.log('\n====================================================');
  console.log(' GATE 1 APROVADO: Storage, reload e exportação OK! ');
  console.log('====================================================\n');
}

runGate1().catch((err) => {
  console.error('Erro fatal no Gate 1:', err);
  process.exit(1);
});
