# Design

> **Este arquivo é um ponteiro, não a fonte.** O sistema visual do ArenaHub já vive em documento
> normativo; duplicá-lo aqui criaria uma segunda verdade que diverge na primeira correção — que é
> exatamente o que o **ADR-022** existe para impedir.

## Onde mora o contrato

Por **ADR-026**, o contrato de implementação de UI é **por superfície**:

| superfície | app | contrato |
|---|---|---|
| Painel administrativo | `apps/admin-web` | [`docs/design/DS-PAINEL.md`](docs/design/DS-PAINEL.md) |
| App do aluno | `apps/mobile` | [`docs/design/DS-APP.md`](docs/design/DS-APP.md) |
| Totem | `apps/kiosk` | [`docs/design/DS-TOTEM.md`](docs/design/DS-TOTEM.md) |

[`docs/DESIGN-UI.md`](docs/DESIGN-UI.md) é **documento de direção**, não de contrato (rebaixado por
ADR-026). É de onde saíram Carbono Adaptativo e o pipeline de accent. Onde os `DS-*.md` divergirem
dele, **eles vencem**.

**Exceção:** sobre nome de estado, razão ou enum, o **ADR de domínio vence** e o documento de
design é corrigido. Rótulo de tela é design; código de domínio não é.

## Direção adotada

**Carbono Adaptativo.** Três papéis que nunca se misturam:

- **Carbono** — estrutura, superfície e texto. Não é a cor de ação.
- **Accent do tenant** — ação: botão primário, link, foco, seleção. Derivado de um hex seed em
  OKLCH, com papéis escolhidos **por contraste calculado, nunca por número fixo de tom**.
- **Semântico** — estado: sucesso, atenção, erro, informação, risco. **Fixo e não configurável.**

O accent é proibido em badge de máquina de estado, decisão de acesso, faixa de risco, alerta, toast
de erro e banner de degradação. Não é recomendação: é regra de lint que falha o build.

Padrão comercial: **Ciano Arena `#00A9B8`**, adotado como padrão revisável (PI, 16/08/2026).

## Tokens

Fonte: `packages/ui/tokens/*.json`, em três camadas.

| camada | o que é | quem lê |
|---|---|---|
| **primitiva** | valor bruto (`carbon-700`, `accent-500`) | só a camada semântica |
| **semântica** | papel (`--ah-surface-canvas`, `--ah-text-default`, `--ah-danger`) | componente |
| **expressão** | por superfície (`data-surface="panel"`) | seletor de raiz |

O pipeline `packages/ui/scripts/build-tokens.mjs` gera `theme.css` e `tokens.generated.ts`, com
guardas que **falham o build**: hex literal na camada semântica, `ref` para primitivo inexistente,
par texto/superfície abaixo do alvo sem exceção nomeada, e gerado divergente da fonte.

**Componente que lê token primitivo é erro de lint.** Um componente que lê `--ah-carbon-700` congela
*"esta cor"* no lugar de *"este papel"*, e na próxima mudança de paleta não acompanha.

## Regras de lint (DS-PAINEL §11)

1. Hex literal fora de `packages/ui/tokens` é erro.
2. Componente que lê token primitivo é erro.
3. `--ah-action-*` dentro de arquivo de badge, alerta ou gráfico de estado é erro.
4. Par texto/superfície abaixo do alvo **falha o build** — vive no pipeline, não no ESLint
   (contraste não é sintático).
5. `new Date().toLocaleString()` fora de `TenantDateTime` é erro.
6. Aritmética de moeda em `number` fora de `Money` é erro.

## Rótulo de estado

O dicionário canônico `enum → { label, tone, icon }` vive em **um único arquivo**:
`packages/ui/src/domain/state-labels.ts`. Nenhum componente escreve rótulo inline; o badge não
renderiza sem `label`.

Os códigos vêm de `packages/access-policy/src/types.ts` — o dicionário **importa**, nunca
redeclara. Código novo lá sem rótulo aqui quebra o teste de cobertura.

## Como manter isto atualizado

Este arquivo muda quando **muda o ponteiro**, não quando muda um token. Token novo, componente
novo ou correção de contraste vão para o `DS-*.md` da superfície e para `packages/ui/tokens/`.
