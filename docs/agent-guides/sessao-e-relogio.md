# 2. Sessão e relógio

Responsável pela identidade e coerência temporal dos eventos. Não há um serviço
central de relógio: esta responsabilidade está distribuída pelos arquivos abaixo.

## Onde começar

- [Identidade da sessão](../../src/storage/session.ts): sessionStorage e compatibilidade com chaves antigas.
- [Orquestração](../../src/core/flight-recorder.ts) e [estados](../../src/core/state-machine.ts).
- [Timeline](../../src/types/timeline.ts) e [ordenação](../../src/validation/validate.ts).

## Contratos a preservar

- Timestamps persistidos são instantes em milissegundos; offsets do player são relativos. Não misture segundos, tempo absoluto e relativo.
- Reload deve recuperar a sessão sem misturar eventos de outras abas.
- Empates de timestamp não tornam eventos equivalentes: preserve sequência da timeline e ordem do replay.
- Horário de persistência/recuperação não substitui horário do evento nem prazo do incidente.
- Ao mudar a base temporal, acompanhe [armazenamento](armazenamento.md),
  [recortes](incidentes-e-recortes.md) e [viewer](visualizador.md).

## Validação

Use [session-isolation.test.ts](../../tests/lote1/session-isolation.test.ts) e
[state-machine.test.ts](../../tests/lote0/state-machine.test.ts).
Para prazos/reload, use [incident-manager.test.ts](../../tests/lote1/incident-manager.test.ts)
com relógio controlado, incluindo retomada após o prazo.
