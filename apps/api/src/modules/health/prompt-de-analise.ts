import { createHash } from 'node:crypto';

import { TIPOS_DE_MEDIDA } from './domain/medida.js';

/**
 * Prompt versionado da analise de saude (`M3-FR-016`, F21).
 *
 * ---------------------------------------------------------------------------
 * O NOME E VERSIONADO E O TEXTO E IMUTAVEL.
 * ---------------------------------------------------------------------------
 *
 * Mudar o texto SEM subir o numero quebraria a reprodutibilidade que a Slice
 * 3.5 exige: uma analise de tres meses atras apontaria para uma versao cujo
 * conteudo nao e mais o que a gerou. O `contentSha256` gravado na tabela e o
 * que denuncia isso -- se o hash da linha nao bate com o hash do texto atual,
 * alguem editou sem versionar.
 *
 * ---------------------------------------------------------------------------
 * O PROMPT NAO E A DEFESA. ELE E A PRIMEIRA CAMADA.
 * ---------------------------------------------------------------------------
 *
 * Pedir ao modelo que nao diagnostique reduz a frequencia; nao elimina. Quem
 * elimina e o `validarSaida`, que REJEITA a analise inteira. Escrever aqui
 * "nao diagnostique" e barato e ajuda -- confiar nisso seria a regra de
 * arquitetura no 8 virando pedido educado.
 */

const CONTEUDO = `Voce escreve o resumo de acompanhamento fisico de um aluno de academia, em portugues do Brasil.

Recebe um JSON com medidas de composicao corporal ao longo do tempo, metas combinadas e frequencia de treino. O aluno nao esta identificado, e voce nao deve tentar deduzir quem e.

O QUE ESCREVER
- Um resumo curto do que mudou no periodo.
- Pontos positivos: o que evoluiu na direcao combinada.
- Pontos a melhorar: o que ficou parado ou foi na direcao oposta.
- Perguntas para o profissional: duvidas que o avaliador deveria responder.

REGRAS
Uma checagem automatica descarta a analise inteira quando qualquer regra abaixo e violada.
1. Nao diagnostique. Nao nomeie doenca, sindrome ou condicao clinica. Nao escreva "voce tem", "voce apresenta" seguido de categoria clinica.
2. Nao prescreva. Nada de series, repeticoes, calorias, suplementos ou conduta.
3. Nao tranquilize clinicamente. Nao escreva que esta tudo bem com a saude, que nao ha risco, ou que a pessoa esta saudavel.
4. Nao invente numero. Cite apenas valores que estao no JSON recebido. Se nao tem o numero, escreva sem numero.
4.1. Nao escreva data nenhuma na prosa -- nem "22/08/2026", nem "em agosto", nem "no dia 21". A tela ja mostra a data de cada medicao ao lado do texto. Escreva "na ultima medicao", "na medicao anterior", "no periodo". Data escrita por extenso vira numero solto que a checagem de valores rejeita, e a analise inteira e descartada.
5. Se o campo "suppressedFindings" trouxer metricas, nao as transforme em ponto de atencao: a regra do sistema ja decidiu que aquele valor tem explicacao conhecida para este aluno.
6. Se "analysisBlocked" for true, devolva todos os campos de texto vazios e "analysisBlocked": true. Nao escreva analise nenhuma.
7. Se "pendingMedicalReferral" for true, inclua em attentionPoints exatamente esta frase, sem alterar: "Ha um encaminhamento medico pendente registrado na sua ficha. Procure o profissional de saude." Voce nao sabe qual e o achado e nao deve especular.
8. Se "confirmedSource" for false, nao afirme que o aluno faltou -- o sistema pode nao ter registrado as entradas.
9. Nao escreva vocabulario clinico na prosa, nem para nomear uma medida: "cardiaca", "arritmia", "fibrilacao", "hipertensao", "diabetes", "obesidade", "sindrome", "patologia", "doenca". O tipo HEART_RATE existe no snapshot e voce pode comenta-lo -- escreva "batimentos por minuto" ou "bpm em repouso", nunca "frequencia cardiaca". A checagem que protege o aluno de receber diagnostico e cega ao seu proposito: ela ve a palavra e descarta a analise inteira.

TOM
Direto e respeitoso. O texto vai ser lido pelo proprio aluno num totem e no aplicativo. Sem jargao, sem alarme, sem elogio vazio.

FORMATO
A resposta segue o schema de saida da requisicao. Array vazio quando nao ha o que dizer. Repita em "suppressedFindings", "pendingMedicalReferral" e "pendingReferralSince" o que veio no JSON recebido.`;

const TEXTO = { type: 'string' } as const;
const LISTA_DE_TEXTO = { type: 'array', items: TEXTO } as const;
/** Sem `enum` o modelo escreve o rotulo em pt-BR ("Peso") em vez do tipo (`WEIGHT`). */
const METRICA = { type: 'string', enum: [...TIPOS_DE_MEDIDA] } as const;

function objeto(propriedades: Record<string, unknown>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(propriedades),
    properties: propriedades,
  } as const;
}

/**
 * Schema de saida enviado em `output_config.format` (structured outputs): a
 * API garante a estrutura, o prompt nao precisa mais pedir. Mesmo contrato de
 * `SaidaDaAnalise`; as regras de dominio continuam no `validarSaida`.
 *
 * O schema VERSIONA JUNTO com o texto: mudar qualquer campo daqui exige subir
 * o `name`, igual ao texto.
 */
const SCHEMA_DE_SAIDA = objeto({
  summary: TEXTO,
  progress: { type: 'array', items: objeto({ metric: METRICA, observation: TEXTO }) },
  positivePoints: LISTA_DE_TEXTO,
  attentionPoints: LISTA_DE_TEXTO,
  trends: {
    type: 'array',
    items: objeto({ metric: METRICA, direction: { type: 'string', enum: ['UP', 'DOWN', 'STABLE'] } }),
  },
  goalProgress: LISTA_DE_TEXTO,
  questionsForProfessional: LISTA_DE_TEXTO,
  contextFactors: LISTA_DE_TEXTO,
  suppressedFindings: { type: 'array', items: objeto({ metric: METRICA, reason: TEXTO }) },
  disclaimerCode: { type: 'string', const: 'NOT_MEDICAL_DIAGNOSIS' },
  pendingMedicalReferral: { type: 'boolean' },
  pendingReferralSince: { anyOf: [TEXTO, { type: 'null' }] },
  analysisBlocked: { type: 'boolean' },
});

export const PROMPT_DE_ANALISE = {
  /**
   * Sobe o numero a cada mudanca de texto. Sem semver: prompt nao tem
   * "correcao compativel".
   *
   * `@4` troca o schema escrito na prosa por `output_config.format`: a
   * estrutura deixa de ser pedido e passa a ser garantia da API. As regras
   * perdem a caixa alta (o motivo delas vai no topo) e a regra do
   * `disclaimerCode` sai do texto -- virou `const` no schema.
   *
   * `@3` proibe vocabulario clinico ate para NOMEAR medida: o modelo escrevia
   * "frequencia cardiaca" -- rotulo do proprio campo do laudo -- e a guarda
   * `DIAGNOSTIC_LANGUAGE` (que mira "fibrilacao cardiaca") descartava a
   * analise inteira. A guarda esta certa e nao foi afrouxada; o prompt e que
   * passou a usar "bpm em repouso".
   *
   * `@2` declara o SCHEMA DE SAIDA. A `@1` dizia "responda com o JSON do
   * schema pedido" sem nunca mostrar o schema -- o modelo adivinhava a
   * estrutura, devolvia `improvementPoints` (campo que nao existe no
   * contrato) e omitia sete obrigatorios, e o `validarSaida` rejeitava com
   * `SCHEMA_INVALID`. Toda analise real falhava; so o dublê passava, porque
   * ele devolve o formato certo por construcao.
   */
  name: 'analise-de-saude@4',
  content: CONTEUDO,
  schema: SCHEMA_DE_SAIDA,
  // O hash cobre texto E schema: os dois sao o pedido, e mudar qualquer um
  // sem subir o `name` tem de ficar visivel na linha gravada.
  contentSha256: createHash('sha256')
    .update(CONTEUDO + JSON.stringify(SCHEMA_DE_SAIDA), 'utf8')
    .digest('hex'),
} as const;
