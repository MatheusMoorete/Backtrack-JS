# 5. Artefato e transporte

Responsável pelo contrato entre recorder e viewer e pelos caminhos de entrada/saída.

## Onde começar

- [Schema](../../src/types/artifact.ts), [validação](../../src/validation/validate.ts) e [fixtures](../../fixtures/).
- Montagem em [incident-manager.ts](../../src/storage/incident-manager.ts); download em [flight-recorder.ts](../../src/core/flight-recorder.ts).
- Entrada por arquivo em [FileImporter.tsx](../../viewer/components/FileImporter.tsx);
  mensagens/URLs em [App.tsx](../../viewer/App.tsx).
- [Widget](../../src/widget/widget.ts), [Gist](../../src/utils/gist-uploader.ts) e [Markdown](../../src/utils/markdown.ts).

## Contratos a preservar

- Artefatos externos são dados não confiáveis: valide antes de usar; não execute conteúdo gravado.
- Evolução de schema precisa considerar gravações existentes, produtor e consumidor.
- Compressão interna dos lotes não deve vazar acidentalmente para o formato exportado.
- Alterações de mensagens exigem verificar emissor e receptor; preserve os fluxos de compartilhamento explícitos.
- Em entrega de pacote, fonte, build e dependência do consumidor precisam corresponder à versão corrigida.

## Validação

Use [artifact-validation.test.ts](../../tests/lote0/artifact-validation.test.ts),
[gist-uploader.test.ts](../../tests/lote2/gist-uploader.test.ts) ou
[viewer.test.tsx](../../tests/lote3/viewer.test.tsx), conforme o caminho.
Teste entrada inválida e compatibilidade com uma fixture existente.
