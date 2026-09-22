# 4. Incidentes e recortes

Responsável por gatilhos, janela temporal, finalização e escolha dos eventos
necessários para reconstruir o início de uma captura.

## Onde começar

- [IncidentManager e sliceReplayEventsForWindow](../../src/storage/incident-manager.ts).
- [Tipos de incidente](../../src/types/incident.ts); entradas públicas em [flight-recorder.ts](../../src/core/flight-recorder.ts).

## Contratos a preservar

- A base do recorte é o snapshot efetivamente anterior ou igual ao corte, nunca uma tela futura reposicionada.
- Preserve Meta, snapshot e todas as mutações necessárias até o corte, inclusive lotes intermediários e eventos no mesmo milissegundo.
- Um snapshot logo depois do corte não substitui a reconstrução do início da janela.
- Consulte timestamps reais, inclusive em lotes comprimidos/antigos; uma flag de existência não prova que o snapshot antecede o corte.
- Recuperar um incidente vencido não estende sua duração até o horário do reload.
- Diferencie a janela solicitada dos eventos de preparação usados para reconstruí-la; confira o contrato com o [viewer](visualizador.md).

## Validação

Use [incident-manager.test.ts](../../tests/lote1/incident-manager.test.ts).
Para mudanças de recorte, cubra corte entre snapshots, mutações em lotes intermediários,
empates de timestamp e dados comprimidos. Para prazo, cubra reload antes/depois do término.
Compare também o artefato exportado, não só os IDs dos lotes selecionados.
