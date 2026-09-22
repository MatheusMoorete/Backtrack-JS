# 3. Armazenamento

Responsável por persistir eventos em lotes, comprimir replay e aplicar retenção.
Não escolhe a janela semântica de um incidente.

## Onde começar

- [IndexedDB](../../src/storage/db.ts), [writer](../../src/storage/batch-writer.ts) e [retenção](../../src/storage/retention.ts).
- [Formato do lote](../../src/types/chunk.ts) e [compressão](../../src/utils/compression.ts).

## Contratos a preservar

- O início de um lote deve representar seus eventos, não apenas o instante do flush.
- Preserve eventos e ordem ao comprimir/descomprimir; considere lotes antigos sem os metadados recentes.
- `hasFullSnapshot` indica existência, não a posição temporal do snapshot.
  Metadados de snapshots devem corresponder ao replay persistido.
- Retenção protege lotes associados a incidentes. Mudanças de quota precisam considerar essa proteção.
- Falhas de escrita devem ser observáveis pelo recorder sem quebrar a aplicação hospedeira.

## Validação

Use [db-and-writer.test.ts](../../tests/lote1/db-and-writer.test.ts),
[retention.test.ts](../../tests/lote1/retention.test.ts) e
[compression.test.ts](../../tests/lote2/compression.test.ts), conforme o contrato alterado.
Mudanças de metadados de snapshot também exigem verificar [recortes](incidentes-e-recortes.md).
