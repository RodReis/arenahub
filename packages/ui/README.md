# `@arenahub/ui`

Design system do ArenaHub. **Hoje este pacote é só o pipeline de tokens** — o
card `[INFRA]` do **ADR-025 decisão 1**.

Os componentes ainda não moram aqui. `StateBadge`, `ProblemDetail`,
`DataFreshness`, `Toast`, `state-labels.ts` e o resto do inventário de 17
(`DS-PAINEL.md` §9) são a fatia **F42 / SPEC-042**, que consome este pipeline.
A separação é o próprio ADR-025: rótulo pt-BR de enum de domínio é decisão de
produto e passa pelo aceite do PI; JSON virando CSS não decide nada.

## As três camadas

| camada | arquivo | quem lê |
|---|---|---|
| **primitiva** — valor bruto | `tokens/primitive.json` | ninguém, exceto o build |
| **semântica** — papel | `tokens/semantic.json` | todo componente |
| **expressão** — por superfície | `tokens/expression.json` | selecionada por `data-surface` |

Componente que lê `--ah-carbon-700` congela *"esta cor"* no lugar de *"este
papel"*, e na próxima mudança de paleta não acompanha. Por isso a regra de
lint 2 existe, e por isso a camada primitiva não tem consumidor direto.

## Comandos

```bash
pnpm --filter @arenahub/ui build:tokens            # gera theme.css e tokens.generated.ts
pnpm --filter @arenahub/ui build:tokens -- --check # verifica sem escrever (é o que o CI roda)
pnpm --filter @arenahub/ui test                    # contraste e resolvedor de accent
```

O gerado **é versionado** — ao contrário do client do Prisma. É o que permite
ao `--check` reprovar quando alguém edita o CSS à mão ou mexe no JSON sem
regerar. Ver a nota no `.gitignore`.

## Onde cada regra de lint mora

As seis regras do `DS-PAINEL.md` §11 não vivem todas no mesmo lugar, porque
não são todas da mesma natureza:

| regra | onde |
|---|---|
| 1 · hex literal fora de `tokens/` | `@arenahub/config/eslint/design-system` |
| 2 · componente lê primitivo | idem |
| 3 · accent em componente de estado | idem, escopo estreito por nome de arquivo |
| **4 · contraste abaixo do alvo** | **`scripts/build-tokens.mjs`** — não é sintática, nenhum ESLint mede contraste |
| 5 · `toLocaleString` fora de `TenantDateTime` | `@arenahub/config/eslint/design-system` |
| 6 · aritmética de moeda fora de `Money` | idem, complementando `eslint/money` |

## O resolvedor de accent

O tenant fornece **um hex seed**. `resolveAccent()` deriva dez tons em OKLCH e
escolhe cada papel **por contraste calculado** — nunca por número fixo de tom.

Fixar `accent-700` funcionaria para o Ciano Arena e produziria texto branco
ilegível sobre amarelo. O teste `resolve acao acessivel para QUALQUER seed de
tenant` existe exatamente para provar isso, e o amarelo `#FFD400` não sai da
lista de seeds do fixture.

Dois tenants costumam cair no **mesmo degrau** da rampa — `TONE_LIGHTNESS` é
fixa por tom, de propósito, para que `accent-700` tenha o mesmo *peso* visual
em qualquer academia. O que muda entre tenants é a cor, não o número.

## Pendências herdadas

- **Rampa do tenant em runtime.** O `theme.css` traz o Ciano Arena como
  *fallback*. `getTenantTheme()` e a injeção no `<html>` (`DS-PAINEL.md` §12)
  são F42.
- **Tailwind v4 `@theme`.** Previsto no ADR-025 decisão 1, ainda não ligado —
  o `admin-web` consome os tokens por CSS puro hoje.
- **Superfícies `app` e `totem`.** Declaradas em `expression.json` com
  `$status`, sem implementação. São F43 e F44, com gate no MVP 4.
