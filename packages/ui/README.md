# `@arenahub/ui`

Design system do ArenaHub: **pipeline de tokens** (card `[INFRA]` do
**ADR-025 decisão 1**) e **componentes** (fatia **F42 / SPEC-042**).

A separação entre os dois é o próprio ADR-025: rótulo pt-BR de enum de domínio
é decisão de produto e passa pelo aceite do PI; JSON virando CSS não decide
nada.

## Componentes

Todos são **Server Components por padrão**. Só `Toast`, `SensitiveAction` e
`PasswordField` levam `'use client'`, porque dependem de estado.

| componente | o que resolve |
|---|---|
| `StateBadge` | estado de máquina, com ícone **e** rótulo — cor nunca é o único canal |
| `ProblemDetail` | erro `problem+json` sem stack, sem detalhe interno, sem PII |
| `DataTable` | tabela com `caption` e `scope="col"`, paginação por cursor |
| `EmptyState` | vazio **com saída** — beco sem ação é o anti-padrão |
| `Field` / `PasswordField` | campo com rótulo, dica e erro associados por `aria-describedby` |
| `Button` | quatro variantes, com a exceção nomeada de contraste no *Disabled* |
| `TenantDateTime` | data e hora no fuso da **unidade**, nunca no do navegador |
| `Money` | centavos inteiros — aritmética em `number` fora dele é erro de lint |
| `MaskedCPF` | recusa CPF que não chegou mascarado da API |
| `Toast` | info / warn / error, fechando a dívida do `CLAUDE.md` |
| `SensitiveAction` | motivo obrigatório + verbo real, nunca "OK" |
| `ConsentCard` | versão, data, IP e dispositivo do consentimento |
| `ElevatedSessionBanner` | faixa persistente, **sem** `onDismiss` |
| `AppShell` / `NavLink` / `PageHeader` | topbar, sidebar, skip link e `aria-current` |
| `Icon` / `Ausente` | conjunto fechado de ícones; `—` com `aria-label` |

**Contrato sem tela** (`contracts/future-components.ts`): `Money`,
`AsyncJobStatus`, `ChartWithTable`, `AIDisclaimer`, `FieldReview` e `RiskBand`
entram como props e token, sem implementação. O MVP dono constrói a tela — e
construí-la antes produziria código morto que envelhece antes do primeiro uso.

### Rótulo pt-BR mora em UM lugar

`src/domain/state-labels.ts` é a fonte única. Nenhum componente escreve rótulo
inline, e nenhuma tela redeclara dicionário.

O motivo é a divergência: antes desta fatia, o mesmo estado tinha dois nomes em
duas telas (`RETRYING` era "Tentando de novo" e "Tentando novamente"), e a
recepção concluía que eram situações diferentes.

Os códigos vêm de `@arenahub/access-policy` — **nunca redeclarados aqui**. O
teste de cobertura percorre `ALLOW_REASON`/`DENY_REASON` e falha se o motor
ganhar um código sem rótulo, em vez de deixá-lo chegar à tela como badge vazio.

**Nem todo dicionário pt-BR cabe aqui.** O §7 define 11 máquinas de estado;
`ROTULO_DE_MODO`, `ROTULO_DE_METODO`, `ROTULO_DE_ORIGEM`, `ROTULO_DE_EVENTO`,
`ROTULO_DE_SEVERIDADE` e `ROTULO_DE_ESTADO_DE_ALERTA` continuam em
`apps/admin-web/src/` porque nenhuma os cobre. Dar-lhes destino é decisão de
produto — Cowork + PI.

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

## Pendências

- **Rampa do tenant em runtime.** O `theme.css` traz o Ciano Arena como
  *fallback*; o `<html>` já sai do servidor com `data-surface`/`data-mode`
  (`DS-PAINEL.md` §12). Falta `getTenantTheme()`, que só faz sentido quando
  houver mais de um tenant com marca própria.
- **Tailwind v4 `@theme`.** Previsto no ADR-025 decisão 1, ainda não ligado —
  o `admin-web` consome os tokens por CSS puro hoje.
- **Superfícies `app` e `totem`.** Declaradas em `expression.json` com
  `$status`, sem implementação. São F43 e F44, com gate no MVP 4.
- **Dark mode.** Escopo negativo da SPEC-042 §3, v2 após o piloto.
- **Fuso da unidade nas telas.** `TenantDateTime` exige `timeZone` sem default,
  de propósito. As telas passam `America/Sao_Paulo` fixo porque as rotas
  devolvem `gymUnitId`, não o fuso — resolver exige mudança de API, que é
  comportamento, não aparência.
