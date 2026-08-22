# STATUS: BLOCKED -- bug real em apps/api/src, nao mexi

Nao editei nada em `apps/api/src`, nenhum teste e nenhum commit, conforme a regra "STOP e reporte".

## O bug

`apps/api/src/modules/health/ai-analysis.controller.ts` linha 45: o JSDoc do metodo
`gerar` (`/**` na linha 45) **nao fecha** com `*/` proprio. O parser so acha o proximo
`*/` na linha 77, que pertence ao comentario de UMA linha do metodo seguinte
(`/** A ultima analise publicada... */`). Resultado: tudo entre as linhas 45 e 77 --
`@Post('students/:id/ai-analyses')`, `@RequirePermissions('health.assess')` e o corpo
inteiro do metodo `gerar` -- vira comentario morto. A rota `POST
/api/v1/students/:id/ai-analyses` nunca e registrada no Nest.

Confirmado com Node: `content.indexOf('*/', <inicio do comentario>)` cai DEPOIS do
indice de `@Post(...)`.

## Por que isso explica os 12 failures, nao a mudanca de regra

Toda chamada de `gerar()` no teste bate num 404 generico do Nest (rota inexistente),
nunca chega no controller, no `AiAnalysisService.gerar`, nem em `avaliarAceite`. Por
isso:
- os 3 casos que deveriam virar 403 (`AI_CONSENT_MISSING_STUDENT`,
  `AI_CONSENT_REFUSED_STUDENT`, e o antigo `MISSING_PROFESSIONAL`) todos voltam 404;
- o caso feliz (`201 PUBLISHED`) tambem volta 404;
- `snapshot`/`analysisRef` nunca sao gravados -> `findFirstOrThrow` estoura;
- indisponibilidade da IA nunca roda -> nenhum registro `FAILED`;
- isolamento de tenant retorna `NOT_FOUND` generico em vez de `STUDENT_NOT_FOUND`
  (o codigo customizado tambem vem do metodo comentado).

Os 6 que passam sao exatamente os que nao dependem de `POST .../ai-analyses`
(leitura via GET, insercao direta no banco via Prisma).

Nao dá pra classificar setup/regra-removida/guarantee-do-titular com a rota fora do
ar: qualquer reescrita de assert ficaria testando um 404 de rota ausente, nao o
comportamento novo. Corrigir a atualizacao dos testes por cima disso mascararia o
bug, que e exatamente o helper "so o teste passa com as duas assinaturas -- se
falhar, ache o motivo real antes de mexer" pedia para eu achar.

## Numeros reais (estado atual, sem nenhuma edicao minha)

- `pnpm --filter @arenahub/api test:integration -- analise-por-ia` -> **12 failed, 6 passed, 18 total**
- `pnpm --filter @arenahub/api test` -> nao rodei (rodar a suite completa com a rota
  quebrada so reproduziria o mesmo sintoma em qualquer teste que dependa dela;
  aguardando decisao sobre o bug antes de gastar o rodada completa)
- `tsc --noEmit` -> nao rodei ainda (comentario nao quebra compilacao TS, entao
  provavelmente fica verde e esconde o problema -- reforca que isso so aparece em
  runtime/integration)
- `pnpm lint` -> nao rodei

## O que fazer

Corrigir a linha 45-52 de `ai-analysis.controller.ts` (fechar o comentario com `*/`
antes de `@Post`) esta **fora do meu escopo** (`apps/api/src`). Pedir aprovacao para
essa correcao pontual antes de eu continuar a classificacao/reescrita dos 12 testes.
Nao deletei nada.
