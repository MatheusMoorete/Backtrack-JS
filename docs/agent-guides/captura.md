# 1. Captura

Responsável por transformar atividade do navegador em eventos de replay e timeline,
aplicando a política de privacidade antes de entregá-los ao armazenamento.

## Onde começar

- [Capturadores](../../src/capturers/): rrweb, console, rede, navegação, erros e performance.
- [Opções](../../src/types/options.ts), [sanitização](../../src/capturers/sanitizer.ts) e [rotas](../../src/capturers/route-matcher.ts).
- [Modelo de privacidade](../privacy-and-threat-model.md): consulte para mudanças de dados capturados.
  É um documento histórico v0.1; confira opções e implementação atuais antes de tratar suas descrições como garantias.

## Contratos a preservar

- Wrappers e listeners devem preservar o comportamento da aplicação e ser removidos no encerramento.
- Mascaramento, bloqueio e captura de canvas dependem das opções efetivas; não presuma fidelidade ou proteção apenas pelo nome da flag.
- Não corrija recortes aqui: eventos seguem para o writer; seleção de intervalos pertence a [incidentes](incidentes-e-recortes.md).

## Validação

Comece por [capturers.test.ts](../../tests/lote2/capturers.test.ts),
[sanitizer.test.ts](../../tests/lote2/sanitizer.test.ts) ou
[widget-and-routes.test.ts](../../tests/lote2/widget-and-routes.test.ts), conforme a mudança.
Para DOM/canvas, complemente com gravação e reprodução em navegador quando a alteração depender da renderização real.
