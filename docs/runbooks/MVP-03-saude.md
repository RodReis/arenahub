# Runbook — operação de saúde (MVP 3)

> **Para quem atende a recepção e para quem opera a nuvem.** Cada seção começa
> pelo que o operador **vê**, não pelo nome interno do erro.
>
> Escopo: Slice 3.6 (F22). Cobre importação de laudo, análise por IA e o que
> fazer quando qualquer um dos dois para.
>
> **Regra que atravessa o documento inteiro:** nada aqui manda alterar banco
> nem apagar avaliação publicada. O aceite da Slice 3.6 é literal — *"equipe
> corrige falhas sem alterar banco ou apagar avaliação publicada"*. Se um
> procedimento parecer exigir isso, ele está errado e o problema sobe.

---

## 1. Alertas e o que fazer com cada um

Todos aparecem no painel de operação, junto dos alertas de catraca. **Nenhum
deles é `CRITICAL`** — essa severidade é reservada para *a catraca não está
funcionando agora*. Laudo parado e análise recusada são problemas reais e
nenhum impede alguém de treinar.

### `HEALTH_IMPORT_PENDING_REVIEW`

**O que aconteceu.** Há laudo importado esperando revisão há mais de 48 h.

**Por que importa.** O aluno mediu, pagou pela bioimpedância e não vê o
resultado. O sistema está funcionando: o INV-103 exige que um humano olhe
campo a campo antes de o número virar histórico.

**O que fazer.**

1. Abrir a fila (`GET /api/v1/assessment-imports/pending`).
2. Abrir a importação mais antiga. Os campos vêm em **ordem de revisão** —
   menor confiança primeiro, que é onde o OCR provavelmente errou.
3. Para cada campo: confirmar, corrigir ou descartar.
4. Confirmar a importação, informando a **data da medição** (não a de hoje —
   um laudo de três meses atrás na data errada desloca o gráfico inteiro).

**O que NÃO fazer.** Não confirmar tudo em bloco sem olhar. A confiança alta
do OCR não é garantia: ela ordena a fila, não decide nada.

### `HEALTH_IMPORT_FAILED`

**O que aconteceu.** Arquivo enviado que não virou avaliação — ou a extração
falhou, ou o antivírus recusou.

**O que fazer.**

| causa | como identificar | ação |
|---|---|---|
| antivírus recusou | `status: INFECTED` | **Não insista com o mesmo arquivo.** Peça outro ao aluno — de preferência exportado de novo pelo app da balança |
| extrator fora do ar | `FAILED` com `EXTRACTOR_UNAVAILABLE` / `TIMEOUT` | Tente de novo mais tarde; se pressa, digite a avaliação à mão |
| arquivo sem conteúdo legível | `FAILED` com `EXTRACTOR_NO_CONTENT` | O CSV não tem as colunas `tipo` e `valor`, ou o PDF não tem camada de texto (traçado puro, PDF protegido por senha). O PDF do OmronConnect **tem** camada de texto e é lido desde 22/08/2026 — se um ECG do aparelho cair aqui, é defeito, não limitação. Digite à mão |

**A saída que sempre existe: digitar à mão.** O INV-140 é explícito — OCR fora
**não impede** avaliação manual. Se a fila de falhas está crescendo e o aluno
está esperando, digite. A avaliação digitada vale exatamente o mesmo.

### `HEALTH_AI_REJECTION_RATE_HIGH`

**O que aconteceu.** Mais de 30% das análises dos últimos 7 dias foram
recusadas pela validação.

**Por que importa — e por que rejeição isolada NÃO é alarme.** Uma análise
recusada é a regra de arquitetura nº 8 funcionando: a saída trazia diagnóstico,
prescrição ou número que não existia no snapshot, e foi rejeitada inteira. O
que este alerta vigia é a **taxa**: muitas caindo seguidas deixou de ser o
modelo tropeçando e virou prompt, snapshot ou versão de modelo.

**O que fazer.**

1. Abrir as análises rejeitadas e ler o `rejectionReason` de cada uma.
2. Se o motivo se repete, o problema é sistêmico:

| motivo repetido | provável causa |
|---|---|
| `DIAGNOSTIC_LANGUAGE` | o prompt afrouxou, ou o modelo mudou de versão |
| `VALUE_NOT_IN_SNAPSHOT` | o modelo está inventando número — versão de modelo, quase sempre |
| `SCHEMA_INVALID` | o contrato de saída mudou dos dois lados sem combinar |
| `SUPPRESSED_FINDING_REINTRODUCED` | o ADR-037 está sendo ignorado pelo modelo |

3. Escalar para quem opera a nuvem. **Não há ação de recepção aqui** — e é
   correto que não haja.

**O que NÃO fazer.** Não desligar a validação para "destravar". Ela é o que
impede a IA de publicar diagnóstico, e desligá-la transforma o produto em
dispositivo médico sob a RDC 657/2022.

### `HEALTH_AI_BUDGET_NEAR_LIMIT`

**O que aconteceu.** O gasto com IA chegou a 80% do teto do período — ou já
estourou.

**O que fazer.** Decidir entre aumentar o teto ou aceitar a degradação. Com o
teto estourado, a análise degrada para **modo manual** (`M3-NFR-004`): a
avaliação, o histórico, os comparativos e as metas continuam funcionando; só o
texto gerado para de sair.

> ⚠️ **Hoje este alerta não dispara**, porque o teto por tenant ainda não tem
> tela de configuração e vale `null` — e `null` **desliga** o alerta em vez de
> assumir um número. Ver §4.

---

## 2. Indisponibilidade do provedor de IA

**Sintoma.** Análises saindo com `status: FAILED` e `rejectionReason` de
`AI_PROVIDER_*`.

**O que continua funcionando, e é quase tudo:** avaliação manual, importação,
histórico, comparativos, metas e frequência. Nenhum deles chama IA.

**O que para:** só a geração de texto novo. Análises já publicadas continuam
visíveis no totem e no app.

**Ação:** nenhuma, na recepção. A falha fica registrada — inclusive para o teto
de gasto poder contar, porque o provedor cobra pela chamada e não pelo
resultado. Se persistir por horas, escalar.

---

## 3. Correção de dado errado — o procedimento que substitui mexer no banco

**Nunca** se apaga avaliação publicada, e **nunca** se edita o valor de uma.
A prova de que o número errado circulou é o que protege a academia se o aluno
questionar.

| situação | procedimento |
|---|---|
| valor errado numa avaliação **publicada** | criar **correção vinculada** (`POST /assessments/:id/corrections`). A original continua publicada; a correção a substitui na série |
| valor errado num **rascunho** | editar o rascunho normalmente — ele ainda não é histórico |
| campo do OCR lido errado, ainda **em revisão** | corrigir o campo. O valor do OCR fica guardado ao lado do corrigido |
| importação que não deveria virar avaliação | **descartar** a importação. Ela sai da fila e não vira nada |
| análise de IA com texto ruim que **passou** pela validação | gerar outra. A anterior fica registrada; não se apaga |

**Se nenhuma linha acima resolve, o problema sobe.** Alterar banco à mão não é
uma opção deste runbook — é o que o aceite da Slice 3.6 proíbe em voz alta.

---

## 4. O que este runbook ainda não cobre

Registrado aqui para não virar surpresa:

- **Teto de gasto por tenant não tem tela.** Vale `null`, o que desliga o
  alerta de orçamento. O ADR-036 decisão 4 diz que o teto é parâmetro do
  cliente e avisa para *puxar o número real antes de fixá-lo* — o número ainda
  não foi puxado.
- **Não há OCR de verdade.** Imagem e PDF passam por dublê. O extrator de CSV
  é produção.
- ~~**O parser de ECG não existe**~~ **Existe desde 22/08/2026** (ADR-035 decisão 8,
  implementada). O PDF do OmronConnect passa por extração da camada de texto
  (`unpdf`) e rende frequência, duração, achado do aparelho, marcações e as
  observações que quem operou digitou — tudo como atributo opaco, exibido e
  nunca interpretado.
  **A pendência médica continua sempre `false`**, agora por dívida e não por
  falta de parser: `ai-analysis.service.ts` fixa `pendenciaMedicaAberta: false`
  com um `TODO(F19)` que apontava para este parser. Ligar os dois é trabalho de
  outra entrega, e exige decidir o que conta como pendência — o achado do
  aparelho não é diagnóstico, e transformá-lo em pendência automática seria
  interpretá-lo, que é o que o ADR-035 proíbe.
- **O piloto com profissionais e alunos consentidos** (item da Slice 3.6) é
  operação em turno real, com gente — não é código, e não foi feito.
