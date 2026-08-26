# SPEC-044 — Design system da superfície `kiosk`

| campo | valor |
|---|---|
| **Fatia** | F44 |
| **MVP** | 2.5 |
| **Slice** | **2.5.3** — definida no **ADR-025** (o design system não tem PRD) |
| **Fonte de verdade** | [`docs/design/DS-TOTEM.md`](../design/DS-TOTEM.md) — **Versão 2.0** |
| **Referência visual** | `docs/design/DS Totem.dc.html` — protótipo, **não é código a instalar** (ADR-026 decisão 2) |
| **Status** | `aprovada-pi` |
| **Gate de entrada** | **aberto em 26/08/2026** — ver §0 |
| **ADRs que bloqueiam** | nenhum |

> **Esta spec é um ponteiro (ADR-022).** O escopo mora em `docs/design/DS-TOTEM.md`.
>
> **Reconciliada em 26/08/2026 contra o DS-TOTEM v2.0.** A versão anterior desta spec apontava
> para seções que **não existem mais** — ver §0.

---

## 0. Por que esta spec foi reescrita, e o que mudou no mundo

Esta spec foi escrita em **16/08/2026**, quando `apps/kiosk` **não existia**. Duas coisas
aconteceram depois, e as duas invalidaram o texto original:

**1. O gate caiu por antecipação, não por priorização do MVP 4.** O ADR-025 condicionou esta
fatia a *"o PI priorizar o MVP 4"*, porque a superfície não existia. Em 22/08 o **ADR-042** criou
o MVP 3.5 e antecipou o totem: **F49–F52 construíram `apps/kiosk` inteiro** e foram aceitas pelo
PI em 26/08. O gate original perdeu objeto — a superfície existe, com dez componentes e 697 linhas
de CSS.

**2. O `DS-TOTEM.md` foi reescrito.** A F50 (`ff73a7f`) publicou a **Versão 2.0 — rebrand azul,
totem somente leitura, evolução 3D**, com **§1–§8**. A spec original citava `§6 KioskSession`,
`§8 tela pública da catraca`, `§9 conteúdo sensível`, `§11 as 12 regras não negociáveis` e
`§12 pendências`. **Nenhuma dessas seções existe no documento atual.**

**Consequência para o escopo desta fatia — e é o achado central.** O design system do totem
**não foi construído por esta fatia: ele nasceu dentro das F49–F52**, junto com as telas que o
consomem. O risco que o ADR-025 registrou (*"componente sem consumidor erra em silêncio"*) **não
se materializou**, porque a ordem se inverteu: veio consumidor primeiro, DS destilado dele.

O que a F44 entrega, então, **não é a camada de UI** — é **o que ficou de fora** dela.

## 1. O que esta fatia entrega

Fecha o gap entre o `apps/kiosk` entregue (F49–F52) e o `DS-TOTEM.md` v2.0.

| # | item | seção do DS | natureza |
|---|---|---|---|
| 1 | **Aviso sonoro na recusa** passa a ter consumidor | §6 (contrato `sessao`) | **defeito** |
| 2 | **Moldura do totem** — borda metálica, raio 48/46, glow azul | §3.1 | visual ausente |
| 3 | **Forma angular + ponto pulsante** no hero | §3.3, §2.6 | visual ausente |
| 4 | **Anel de pontuação** SVG | §3.12 | visual ausente |
| 5 | **`@keyframes ah-pulse` e `ah-spin`** | §2.6 | ausente |
| 6 | **Reconciliação desta spec** com o DS v2.0 | — | documento |

## 2. Decisões desta fatia

1. **O aviso sonoro era uma flag morta, e esse é o item mais importante da fatia.**
   `sessao.avisoSonoroNaRecusa` existe no contrato desde a F50 com **default `true`**, o painel
   tem o checkbox, e **nenhuma linha do `apps/kiosk` lia o campo**. A academia marcava a caixa e
   o totem seguia mudo. Mesmo padrão que a F51 encontrou na análise de IA e no OCR de ECG:
   recurso que parece pronto porque o contrato e a tela existem, e que nunca executou.

2. **Som sintetizado (`AudioContext`), sem asset.** Um `<audio src>` exigiria arquivo (mais um
   404 possível no modo quiosque) e esbarraria na política de autoplay — a recusa nasce de uma
   **resposta de rede**, não de um gesto. Dois tons descendentes (440 → 330 Hz) a volume 0.08:
   o totem fica na recepção **com fila atrás**, e bipe agudo anunciaria a recusa para a fila.
   **Nunca lança**: aparelho sem saída de áudio degrada para recusa muda, e o Toast continua
   sendo o canal de verdade — o §3.4 já fixa que esta superfície nunca *depende* de áudio.

3. **A moldura §3.1 só aparece acima de 1080 px de viewport.** No equipamento real a tela **já
   é** 1080×1920: ali a moldura roubaria 2 px úteis e arredondaria o canto do conteúdo contra a
   moldura **física** do gabinete, que já existe em metal. Fora dele — monitor de
   desenvolvimento, pré-visualização do painel — é o que dá a leitura de "isto é um totem".

4. **O anel §3.12 degrada para texto, e essa é uma decisão de segurança, não de estilo.** O §3.12
   pede arco *"proporcional"*, e o DS desenha `80 PONTOS` **sem nunca dizer 80 de quanto**. O valor
   chega do aparelho como **texto livre** (`score` / `bodyScore`), sem garantia de ser número.
   Escala assumida: **100**, isolada em `ESCALA_DA_PONTUACAO`. Quando o texto não for número
   dentro dela, **não há anel** — a tela cai no número em texto, que já funcionava. Inventar
   escala seria produzir interpretação sobre dado de saúde, o que a **regra de arquitetura 8**
   proíbe. ⚠️ **Pergunta 5 da §5**: a escala real é decisão do PI.

5. **`data-decorativo` já existia esperando por esta fatia.** A regra
   `[data-contraste='alto'] [data-decorativo] { display: none }` foi escrita na F51 e **nenhum
   elemento a acionava**. A forma angular e o ponto pulsante nascem já carregando o atributo.

6. **Mínimo tipográfico é 19 px, não 20 px.** A versão anterior desta spec dizia *"nada abaixo de
   20 px"*; o `DS-TOTEM.md` §2.2 e o checklist §8 dizem **19 px**, e o código implementa 19
   (`--tt-minimo`). **A spec estava errada** — corrigido aqui.

7. **`carbon-950` não existe.** A spec anterior nomeava o fundo assim. O token real é
   **`totem.bg.base`** (`#0A0B0D`), em `packages/ui/tokens/totem.json`. Vocabulário corrigido.

## 3. Escopo negativo

- **Tela pública da catraca.** A spec anterior a citava como `DS-TOTEM.md §8`. **Essa seção não
  existe na v2.0** — o §8 atual é o *Checklist de revisão*. Não há contrato de design vigente
  para essa tela, e escrevê-lo é decisão de produto. **Fora desta fatia.**
- **Render 3D da composição corporal** (§5.3/§5.4) e os **assets** do §7.3 — não existem no repo.
- **Ranking** (§5.8) — fora da grade por decisão (ADR-042, Decisão 5); depende da F33.
- **Componentes em `packages/ui`** — o totem não compartilha componente com o painel, só tokens.
  Extrair agora seria abstração de uso único.
- **Blocos §3.4, §3.10, §3.14–§3.17 com desvio de forma** — implementados e funcionais, com
  diferença de composição em relação ao DS. Ajuste cosmético sem defeito; não se toca no que
  funciona (`CLAUDE.md` → *Alterações cirúrgicas*).

## 4. Invariantes que esta fatia precisa preservar

| invariante | onde aparece |
|---|---|
| Mensagem de falha de identificação é **única e neutra** | O som **não diferencia motivo** — reforça o mesmo evento do Toast |
| Alto contraste desliga todo efeito decorativo | §2.6 — moldura, forma angular e ponto saem |
| A tela pública nunca vaza PII nem situação financeira | Nenhum item desta fatia toca conteúdo |
| IA/aparelho não interpreta dado de saúde | Decisão 4 — anel recusa desenhar o que não sabe ler |
| Nenhum dado do aluno anterior sobrevive à sessão | Não alterado por esta fatia |
| Cor nunca é o único canal | O som é **reforço** do Toast, nunca o canal único |

## 5. Perguntas ao PI

| # | pergunta | resposta | data |
|---|---|---|---|
| 1 | Tela pública da catraca — a seção que a definia saiu na v2.0. Reescrever o contrato de design ou a tela sai do escopo do totem? | — | — |
| 2 | ~~Timeout: 60 s com aviso aos 20 s?~~ | **respondida por implementação na F49**: 60 s (configurável 45/60/90/120), com **contador permanentemente visível** em vez de aviso pontual. Diferente do proposto | 25/08 |
| 3 | ~~Aviso sonoro ligado por padrão e configurável por unidade?~~ | **sim** — contrato F50 (`default: true`), **consumidor entregue nesta fatia** | 26/08 |
| 4 | ~~Accent que não alcança 7:1 — clarear ou recusar o seed?~~ | **dissolvida**: o accent virou **enum de 4** (`kiosk-config.ts`), não hex livre. `resolveAccent` **clareia até alcançar** e os 4 seeds resolvem no tom 50 | 25/08 |
| 5 | **NOVA — escala da pontuação do aparelho.** O §3.12 pede arco proporcional; o DS não define o máximo. Assumido **100**. Confirma, ou a escala é outra? | — | — |

## 6. Antes de codificar, confirme

- [x] Status desta spec é `aprovada-pi`
- [x] **O gate abriu** — por antecipação do ADR-042, não por priorização do MVP 4 (ver §0)
- [x] F42 entregue: os JSON de token existem e `build-tokens.mjs` gera `theme.css`
- [x] Esta spec foi reconciliada com o `DS-TOTEM.md` **v2.0** (§0)
- [ ] A pergunta 5 da §5 tem resposta — **muda o anel, não só o texto**
