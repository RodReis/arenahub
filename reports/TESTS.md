# TESTS.md — relatório de evidência

> **Gerado por `pnpm test:report`. Não edite à mão.**
>
> O CI roda `pnpm test:report --check` e falha se este arquivo divergir do que a execução
> produz. É a guarda de evidência do `docs/TESTING.md` §5.
>
> **Data e SHA da execução ficam no log do CI, não aqui.** Gravá-los no arquivo tornaria a
> guarda impossível de satisfazer: gerar mudaria o conteúdo, exigindo commit, que mudaria o
> SHA, que desatualizaria o relatório. Este arquivo só carrega o que é reproduzível a partir
> do código.

## Arquivos de teste por nível

Classificação por **sufixo de arquivo**, não por pasta (`docs/TESTING.md` §2).

| nível | sufixo | arquivos |
|---|---|---|
| unitário | `.spec.ts` | 0 |
| contrato | `.contract-spec.ts` | 0 |
| integração | `.int-spec.ts` | 0 |
| e2e | `.e2e-spec.ts` | 0 |
| hardware | `.hw-spec.ts` | 0 |
| **total** | | **0** |

## Nenhum teste de domínio existe ainda

Isto não é falha do relatório — é o estado real do repositório. O bootstrap `[INFRA]`
monta o encanamento; teste de domínio nasce com a primeira fatia que tiver regra a provar.

**Enquanto esta linha existir, nenhum documento deste repositório pode afirmar que há
cobertura.** Cobertura de regra de domínio: **n/a** — não há regra de domínio.

O que já é verificado por máquina, e vale registrar para não parecer que nada roda:

- `pnpm lint` e `pnpm typecheck` sobre `packages/config` e `packages/database`;
- `pnpm test:guardas` — 6 casos sobre os guardas de `scripts/`;
- `pnpm test:report:selfcheck` — o self-check deste gerador.

Nenhum deles é teste de regra de negócio, e por isso nenhum entra na tabela acima.
