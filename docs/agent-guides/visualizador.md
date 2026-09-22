# 6. Visualizador

Responsável por reproduzir o artefato e sincronizar tela, controles e timeline.
A aplicação React do viewer é separada do núcleo da biblioteca.

## Onde começar

- [App.tsx](../../viewer/App.tsx): artefato carregado e tempo compartilhado.
- [ReplayPlayer.tsx](../../viewer/components/ReplayPlayer.tsx): rrweb, reprodução, seek e zoom.
- [TimelineView.tsx](../../viewer/components/TimelineView.tsx), [cabeçalho](../../viewer/components/IncidentHeader.tsx) e [estilos](../../viewer/styles.css).

## Contratos a preservar

- Timeline, marcador de erro e player devem apontar para o mesmo instante.
  Confira a diferença entre início do incidente e primeiro evento do replay.
- Zoom altera apresentação, não viewport gravado, timestamps ou dados do artefato.
- Preserve pausa, velocidade, navegação por teclado, estados vazios e erros de importação.
- Antes de compensar tela incorreta no player, verifique se o artefato contém a base
  e as mutações exigidas por [incidentes e recortes](incidentes-e-recortes.md).

## Validação

Comece por [viewer.test.tsx](../../tests/lote3/viewer.test.tsx).
Para fidelidade visual/seek, abra uma captura sintética no navegador e compare
o estado antes e depois do ponto afetado; mocks do rrweb não bastam.
`npm run viewer` inicia o viewer para essa verificação.
