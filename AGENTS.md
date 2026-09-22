# Backtrack — guia para agentes

Biblioteca TypeScript de gravação no navegador, com viewer React separado.
Este é o arquivo canônico de instruções. As seis partes abaixo são fronteiras
de responsabilidade; não exigem novos pacotes nem reorganização de diretórios.

## Encontre o contexto

Leia apenas o guia da tarefa e os guias vizinhos cujo contrato será alterado.

| Se a tarefa envolve… | Responsabilidade |
| --- | --- |
| DOM, canvas, inputs, console, rede, erros ou privacidade | [1. Captura](docs/agent-guides/captura.md) |
| Sessão, aba, reload, ordem ou unidade de tempo | [2. Sessão e relógio](docs/agent-guides/sessao-e-relogio.md) |
| IndexedDB, lotes, compressão, retenção ou quota | [3. Armazenamento](docs/agent-guides/armazenamento.md) |
| Captura manual/automática, duração ou snapshot inicial | [4. Incidentes e recortes](docs/agent-guides/incidentes-e-recortes.md) |
| Schema, importação, exportação ou compartilhamento | [5. Artefato e transporte](docs/agent-guides/artefato-e-transporte.md) |
| Tela reproduzida, player, zoom, seek ou timeline | [6. Visualizador](docs/agent-guides/visualizador.md) |

Fluxo: captura → armazenamento → incidente/recorte → artefato → visualizador.
Sessão e relógio atravessam esse fluxo. A orquestração fica em
`src/core/flight-recorder.ts`; a API pública, em `src/index.ts`.
O widget em `src/widget/` aciona essas responsabilidades. Configuração de
aplicações consumidoras, como uTicket, pertence à integração delas.

## Como trabalhar

- Leia o código afetado e seus consumidores antes de editar; preserve trabalho existente.
- Faça a menor mudança coesa. Corrija em `src/` ou `viewer/`, não em `dist/` ou no pacote instalado.
- Preserve privacidade e isolamento da aplicação hospedeira. Use dados sintéticos em testes.
- Se documentação, teste e comportamento divergirem, exponha a diferença; não transforme um bug em contrato.
- Para correções, reproduza o problema no teste mais específico. Testes com mocks do player não comprovam fidelidade visual.

## Validação

`npm test -- tests/caminho.test.ts` executa uma suíte específica.
Para TypeScript alterado, rode também `npm run typecheck`.
Para mudanças de empacotamento, configuração ou API pública, rode `npm run build`.
Documentação exige revisão de conteúdo e links, sem build.
Informe o que mudou, o que foi validado e o que ficou sem validação.

Mantenha estes guias curtos: caminhos, fronteiras e contratos difíceis de descobrir.
Atualize-os quando esses pontos mudarem; não acrescente histórico de sessões,
catálogos de funções ou cópias de código.
