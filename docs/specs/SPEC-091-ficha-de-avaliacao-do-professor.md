# SPEC-091 — Ficha de avaliação física do professor (web)

| campo | valor |
|---|---|
| **Fatia** | F91 |
| **Slice do PRD** | — (pedido do PI em 22/10/2026; sem Slice — o escopo mora aqui) |
| **MVP** | 3 |
| **Plano de apoio** | — |
| **Status** | `entregue` |
| **Criada em** | 2026-10-22 |
| **Aprovada pelo PI em** | — (gate `aprovada-pi` extinto em 18/08/2026; aceite na issue) |
| **Card** | [#667](https://github.com/RodReis/arenahub/issues/667) |

---

## 1. Objetivo em uma frase

O professor faz a avaliação física mensal do aluno no painel: digita as medidas, vê na hora os 14
indicadores da folha de referência do PI com a faixa de cada um, publica, e compara mês a mês na aba
Histórico.

## 2. Pré-condições

| item | estado |
|---|---|
| Gate de entrada do MVP | n/a — a avaliação física manual existe desde a F17 |
| ADRs que bloqueiam | nenhum; esta fatia cria o ADR-066 (interpretação pela tabela) |
| Fatias anteriores | F17 (avaliação manual, rascunho → publicar, INV-102), F18 (evolução) |
| Decisões dos PRDs | n/a |

## 3. Fonte do escopo

Três páginas digitalizadas entregues pelo PI em 22/10/2026 — *Indicadores antropométricos,
cardiovasculares e perfusão* — com fórmula, faixa e observação de cada item, adulto e pediatria:

| # | indicador | entra como | faixa |
|---|---|---|---|
| 1 | IMC = peso ÷ estatura² | calculado | 18,5 · 25 · 30 · 35 · 40 |
| 2 | Circunferência da cintura | digitado | H 94 / 102 · M 80 / 88 |
| 3 | RCE = cintura ÷ estatura | calculado | 0,40 · 0,50 · 0,60 |
| 4 | RCQ = cintura ÷ quadril | calculado | H 0,90 · M 0,85 |
| 5 | %GC (bioimpedância, dobras, DEXA) | digitado | H 6/14/18/25 · M 14/21/25/32 |
| 6 | MG = peso × %GC ÷ 100 | calculado | sem ponto de corte |
| 7 | MLG = peso − MG | calculado | sem ponto de corte |
| 8 | Pressão arterial | digitado (par) | 120/80 · 130/80 · 140/90 · 180/120 |
| 9 | PAM = PAD + (PAS − PAD) ÷ 3 | calculado | 70–100 mmHg |
| 10 | FC de repouso | digitado | 50 · 60 · 80 · 100 (50–59 fora da tabela) |
| 11 | FCmáx: 220 − idade · Tanaka 208 − 0,7 × idade | calculado | estimativa |
| 12 | RFC = FCmáx − FC repouso | calculado | sem ponto de corte |
| 13 | Karvonen: FC repouso + RFC × intensidade | calculado | zonas 50–100 % |
| 14 | VO₂máx | digitado | sem ponto de corte único |

## 4. Decisões desta fatia

| # | decisão | alternativa descartada | por quê |
|---|---|---|---|
| 1 | A ficha **mostra a interpretação da tabela**, rotulada como referência, não diagnóstico (decisão do PI, 22/10/2026) | só valores, sem rótulo | pedido literal do PI ("de acordo com as imagens"); registrado no **ADR-066** |
| 2 | Menor de 18 anos **nunca** recebe ponto de corte adulto; FCmáx/RFC/Karvonen não são calculados | aplicar a faixa adulta | a própria folha proíbe |
| 3 | Faixa por sexo sem sexo no cadastro diz "sexo não informado" | supor um sexo | não inventar dado |
| 4 | PA, FC de repouso e VO₂máx entram **dentro** da `BodyAssessment` (tipos novos `BLOOD_PRESSURE_SYSTOLIC`, `BLOOD_PRESSURE_DIASTOLIC`, `VO2_MAX`; FC usa `HEART_RATE`) | gravar PA/FC em `HealthMeasurement` avulso | publicar leva a ficha inteira junto (INV-102) e o histórico sai de uma consulta só |
| 5 | MG, MLG e RCQ são **recalculados na Server Action** e gravados como medida | aceitar o número da tela | o navegador digita, não decide a conta que vai para o histórico; gravados, entram nos gráficos de evolução |
| 6 | IMC, RCE, PAM, FCmáx, RFC e zonas **não** são gravados — derivam das medidas na leitura | gravar todos | derivado gravado diverge da fonte no primeiro ajuste de fórmula |
| 7 | Classifica o número **arredondado como a tela mostra** (IMC 24,96 → 25,0 → Sobrepeso) | classificar o valor bruto | tela e rótulo nunca discordam |
| 8 | Entrada pelo menu **Avaliação física** (`health.assess`) e pela ficha do aluno (porta + botão na evolução) | só um caminho | decisão do PI |
| 9 | Fluxo rascunho → publicar da F17 | publicar direto | decisão do PI |
| 10 | Aba **Histórico**: matriz indicador × ficha (até 12, a mais recente à direita), variação contra a anterior, leitura no tom da faixa com a idade de cada data | gráfico por indicador | pedido do PI ("vão ser feitas todo mês"); os gráficos de evolução seguem na tela da F18 |
| 11 | Data da avaliação gravada ao meio-dia UTC | meia-noite UTC | meia-noite UTC vira o dia anterior no fuso das unidades do Brasil |

## 5. Escopo negativo

| não faz | vai para |
|---|---|
| App do professor (mobile) | depois, por decisão do PI; `src/health/indicadores.ts` sobe para `packages/` quando o app precisar |
| Tabela pediátrica (percentis por idade e sexo) | não pedido; a ficha diz "usar referência pediátrica" |
| Campo estruturado de método do %GC | vai em Observações |
| Esconder a recepção | a recepção tem `health.assess` desde o #656; o menu mostra |

## 6. Invariantes preservadas

- **INV-102** — publicada é imutável; correção vira nova versão vinculada (fluxo da F17 intacto).
- **INV-104** — campo vazio não vira linha nem zero; leitura sem valor diz o que falta.
- **Regra 8** — nenhuma IA ou OCR envolvida; todo número tem avaliador humano.

## 7. Critérios de aceite

1. Professor (`TRAINER`) vê **Avaliação física** no menu, busca o aluno e abre a ficha.
2. Digitar peso e estatura mostra o IMC com a faixa e a régua; idem para os 14 itens.
3. Menor de 18 anos: nenhum ponto de corte adulto; FCmáx/zonas indisponíveis com o motivo escrito.
4. Salvar rascunho reabre a ficha preenchida; publicar leva ao Histórico com a coluna nova.
5. Histórico mostra a variação contra a ficha anterior e a leitura de cada mês.

## 8. Testes

- `apps/admin-web/src/health/indicadores.test.ts` — exemplos da própria folha (MG 20 kg, PAM 93,
  FCmáx 180, RFC 120, zonas), limites de cada faixa, pediatria, sexo ausente.
- `apps/admin-web/app/actions/avaliacao-fisica.test.ts` — corpo enviado à API (canário: tirar o
  cálculo da MG derruba o teste), PA em par, publicar.
- `apps/admin-web/app/(protected)/students/[id]/avaliacao/ficha.test.tsx` — leitura ao vivo,
  ausência, Karvonen, campo inválido, rascunho.
- `apps/api/src/modules/health/domain/medida.spec.ts` e `test/integration/avaliacao-fisica.int-spec.ts`
  — tipos novos gravam e publicam.
