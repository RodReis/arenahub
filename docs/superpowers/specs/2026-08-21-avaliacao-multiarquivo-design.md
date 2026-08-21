# Avaliação multiarquivo: bioimpedância, análise e ECG numa medição só

**Data:** 21/08/2026 · **Status:** `proposta` — aguarda aceite do PI
**Origem:** decisão do PI em sessão de brainstorming, 21/08/2026
**Condiciona:** ADR novo (migração de dado histórico + contrato consumido pelo mobile)
**Emenda material:** nenhuma ao PRD — `M3-FR-005` já pedia medidas segmentares

---

## 1. O problema

A Arena Positiva mede o aluno uma vez por mês e sai com **três arquivos da mesma
medição**:

| arquivo | aparelho | o que traz |
|---|---|---|
| Relatório de medição | balança `CF610_G` (`CF:E8:CC:12:00:11`) | composição básica, segmentares, índices |
| Relatório de análise de composição humana | Unique Health, **mesma balança** | os mesmos dados + derivados + faixas |
| ECG de 30 s | OMRON HEM-7530T (algoritmo AliveCor) | bpm, achado do aparelho, tags |

O modelo entregue na F19 força **um arquivo = uma importação = uma avaliação**:
`AssessmentImport.assessmentId` é `@unique` e `BodyAssessment.import` é singular.
Três arquivos produziriam **três avaliações no mesmo instante** — três pontos no
gráfico para uma medição só, e o comparativo da F18 passaria a mentir.

Os dois relatórios de bioimpedância **não são duas medições**: mesmo instante
(03/08/2026 07:47), mesma balança, mesmo peso (92,25 kg). O segundo é o primeiro
com mais campos derivados.

## 2. Decisões do PI (21/08/2026)

| # | pergunta | decisão |
|---|---|---|
| 1 | campo repetido nos dois relatórios | **deduplicar** quando concordam; divergência vira escolha humana |
| 2 | achado do ECG dispara ação? | **não.** Anexo já pressupõe conversa presencial. Guardar para histórico, **nunca interpretar** |
| 3 | o que guardar do ECG | bpm + achado textual + tags. **PDF expurgado** como os demais |
| 4 | 3D do aluno | boneco fixo + números por região. **Sem avatar deformável** |
| 5 | avaliação incompleta | **bioimpedância obrigatória, ECG opcional** |
| 6 | mobile e totem | **fatia seguinte.** Só o contrato sai agora |

Decisão técnica tomada pelo Code e registrada (reversível): o boneco é **asset
fixo** gerado por MCP na fase de design, versionado em `packages/ui`, colorido em
runtime. Geração por visualização foi descartada — custo por view, latência no
totem, dependência de rede num equipamento que precisa operar offline, e dado de
saúde saindo para serviço externo de imagem.

## 3. Modelo de dados

### 3.1 Uma avaliação, N importações

Inverte a relação: `@unique` sai de `assessmentId`, `BodyAssessment.import` vira
`imports AssessmentImport[]`.

Cada arquivo permanece sua própria `AssessmentImport`, com seu antivírus, seu
extrator e sua proveniência. O que muda é o destino: todas apontam para a mesma
avaliação.

**Por que não uma entidade agrupadora nova:** os três arquivos *já são* a mesma
avaliação — mesmo instante, mesma balança. Tabela intermediária acrescentaria
indireção para expressar o que `BodyAssessment` já expressa.

### 3.2 Sessão de revisão

Hoje cada import confirma sozinho e cria sua avaliação. Passa a existir uma
**sessão**: arquivos sobem, viram conjunto pendente, o professor revisa o
consolidado e confirma **uma vez**. A avaliação nasce nesse commit, com as
medidas de todos os arquivos.

Preserva o **INV-103** (nada vira histórico sem confirmação humana) e o resolve
melhor: uma decisão em vez de três.

### 3.3 Deduplicação

`ImportedField` ganha:

- **`sourceLabel`** — de qual arquivo veio (`CF610_G`, `Unique Health`, `ECG 30s`).
  É a coluna "Origem" da tela.
- **`agreesWithFieldId`** — quando dois arquivos trazem o mesmo tipo com valor
  equivalente, o segundo aponta para o primeiro e não vira linha própria. Vira o
  selo "confirmado por 2 arquivos".

**Divergência nunca é deduplicada.** Os dois valores aparecem lado a lado, sem
pré-seleção, e o professor escolhe. Mantém a garantia da F19: o valor do extrator
nunca é sobrescrito.

Comparação por **valor canônico com tolerância de arredondamento por tipo** —
92,25 e 92,3 são o mesmo peso. Tolerância apertada de propósito: divergência falsa
é chata, divergência escondida é grave.

### 3.4 Bioimpedância obrigatória

A confirmação recusa conjunto sem ao menos um arquivo de bioimpedância. Regra no
domínio, com código de erro estável — não validação de tela.

## 4. Tipos de medida: 15 → 34

### 4.1 Segmentares (10 novos) — alimentam o 3D

`SEGMENTAL_FAT_MASS_{ARM_LEFT,ARM_RIGHT,TRUNK,LEG_LEFT,LEG_RIGHT}`
`SEGMENTAL_MUSCLE_MASS_{ARM_LEFT,ARM_RIGHT,TRUNK,LEG_LEFT,LEG_RIGHT}`

Valor em kg. O **percentual do padrão** (233,3% no braço direito) não vira tipo:
é o valor comparado à faixa do fabricante, não medida do aluno. Guardado como
campo da medida, junto da faixa vigente.

`M3-FR-005` já exigia isto. Não é escopo novo — é dívida sendo paga.

### 4.2 Composição (8 novos)

`BONE_MASS`, `BODY_CELL_MASS`, `SUBCUTANEOUS_FAT_MASS`, `SUBCUTANEOUS_FAT_PERCENT`,
`SKELETAL_MUSCLE_PERCENT`, `MUSCLE_MASS`, `PROTEIN_PERCENT`, `WAIST_HIP_RATIO`.

Todos medidos ou derivados pelo aparelho, com faixa no laudo, comparáveis mês a mês.

### 4.3 Cardíaco (1 novo)

`HEART_RATE`. Unique Health traz 89 (repouso), ECG traz 99 — medições distintas de
aparelhos distintos. **Não deduplicam**: viram duas linhas com `sourceLabel`
diferente.

### 4.4 O que NÃO vira medida

**Critério: vira medida o que é medido e comparável; vira atributo o que é índice,
classificação ou sugestão do fabricante.**

| valor | por que fica fora do gráfico |
|---|---|
| idade corporal (53), pontuação (80) | índice proprietário, fórmula não pública — firmware novo produziria tendência falsa |
| tipo de corpo | classificação textual do aparelho |
| controle de peso/gordura/muscular, peso ideal | **meta sugerida pelo fabricante**, não medição. Meta oficial é a F20, com baseline, alvo e responsável |
| achado do ECG, tags, observações | texto do aparelho. Atributo, nunca medida, **nunca interpretado** (ADR-035) |

Moram em `BodyAssessment.deviceReport` (JSON), com `deviceModel` e `deviceSerial`.
JSON é adequado: conteúdo varia por fabricante e não é consultado por valor. Se
virar consulta, promove-se a coluna.

## 5. Tela do professor (`admin-web`)

Rota: `students/[id]/health/imports/[sessionId]`.

- **Topo** — aluno, consentimento versionado, um card por arquivo com tipo real
  (assinatura, não extensão), campos extraídos, confiança e estado.
- **Miolo** — revisão campo a campo. Concordância → uma linha com selo "2 arquivos".
  Divergência → duas linhas agrupadas, destacadas, **sem pré-seleção**. Exclusivo →
  linha simples. Confirmar, corrigir ou descartar por linha; `extractedValue` sempre
  preservado. Botão único **"Confirmar N campos"**.
- **Direita** — análise da F21: resumo, `positivePoints`, `attentionPoints`,
  `questionsForProfessional`, com modelo, versão de prompt e janela (`M3-FR-016`).
- **Rodapé** — barras por segmento e histórico (consome a F18, já pronta).

**Sai do mock original:** o card "Registrar encaminhamento" — decisão 2 do PI. O
achado do ECG aparece como texto atribuído ao aparelho, sem ação pendente.
`pendingMedicalReferral` permanece falso neste fluxo.

**Renomeado:** "Metas e controle" → "Sugerido pelo aparelho", separando sugestão do
fabricante de meta do professor.

Contrato de UI: `docs/design/DS-PAINEL.md` (ADR-026). Sem hex literal. Skills
`/impeccable` e `gstack:design-review` na implementação.

## 6. Contrato do aluno (só o contrato nesta fatia)

`GET /api/v1/students/:id/body-evolution` — por mês: 5 regiões com kg, percentual e
**faixa de cor já resolvida**; série temporal; pontos positivos e de atenção.

**Faixa e cor são calculadas no servidor.** Se cada superfície calculasse a sua,
totem e mobile divergiriam quando uma faixa mudasse — o aluno veria o braço verde no
celular e amarelo no totem.

Telas de mobile e totem são **F26–F28, MVP 4**, hoje bloqueado no `STATUS.md`. Não
entram nesta fatia.

## 7. Testes (`docs/TESTING.md`)

**Domínio (puro):** dedução com valores iguais, divergentes, ausentes e no limite da
tolerância; recusa sem bioimpedância; conversão dos segmentares; separação
medida × atributo.

**Integração:** 3 arquivos → **uma** avaliação com todas as medidas; isolamento por
tenant; idempotência da confirmação.

**Idempotência — o caso que mais importa:** confirmar duas vezes não pode criar duas
avaliações. Exclusão mútua em **índice parcial**, nunca em `if` — contagem derivada
já cobrou aluno em dobro antes.

**Fixtures:** derivadas dos laudos reais com **dado sintético** (nome, CPF e datas
trocados). O `CLAUDE.md` proíbe dado real de aluno no repositório, e os arquivos de
origem são do PI.

## 8. Migração

`20260821200000_f19_upload_e_revisao` é a migration mais recente e nenhuma avaliação
de produção tem import associado: a migração é **estrutural**, não de dado — remover
`@unique`, acrescentar colunas, estender o enum.

Verificar contra o banco antes de escrever a migration. Havendo dado, o plano muda e
o PI é avisado.

## 9. Riscos declarados

1. **Tolerância de dedução mal calibrada** — erra para o lado de mostrar divergência
   falsa (chato), nunca de esconder real (grave).
2. **Faixas são do fabricante** e mudam com firmware. Guardadas **junto da medida**,
   não em tabela global: a leitura de agosto continua válida em dezembro.
3. **Divergência real entre os relatórios** sinaliza problema no aparelho. A tela
   mostra; não resolve.

## 10. Ordem de execução

1. Domínio + testes (dedução, tipos, regras)
2. Schema + migration
3. API e sessão de revisão
4. Tela do professor
5. Contrato de evolução corporal

## 11. Fora de escopo

- Telas de mobile e totem (F26–F28, MVP 4 bloqueado)
- Avatar 3D deformável (decisão 4: forma não medida não se inventa)
- Qualquer interpretação de ECG (ADR-035; RDC 657/2022 da ANVISA)
- Metas oficiais (F20)
