/**
 * Desafios (F34, Slice 5.5, ADR-048).
 *
 * PURO: sem banco, sem relogio, sem fuso. O "hoje" e os dias treinados entram
 * por parametro -- `CLAUDE.md`, "funcoes de calculo puras".
 *
 * ---------------------------------------------------------------------------
 * TEXTO ENTRA, TEXTO SAI -- NENHUM `Date` NESTE ARQUIVO.
 * ---------------------------------------------------------------------------
 *
 * Toda data e `AAAA-MM-DD` NO FUSO DA UNIDADE, ja resolvido por quem chama.
 * Mesma decisao de `semana-de-consistencia.ts` (F32) e pela mesma razao:
 * aceitar `Date` convidaria a reconverter o fuso na leitura, aplicando-o duas
 * vezes -- e aqui o efeito seria contar sessao fora da janela do desafio, ou
 * pior, deixar de contar o treino do ultimo dia.
 *
 * `AAAA-MM-DD` e ordenavel lexicograficamente, entao comparar janela e
 * comparacao de string. Nao "conserte" isto para `Date`.
 *
 * ---------------------------------------------------------------------------
 * OPT-IN, E ISSO NAO E DETALHE DE IMPLEMENTACAO.
 * ---------------------------------------------------------------------------
 *
 * Desafio e OPT-IN (`M5-BR-001`): sem participacao registrada, o aluno NAO
 * esta inscrito. E o OPOSTO de `participaDoRanking()` em `participacao.ts`,
 * onde ausencia de decisao significa PARTICIPA.
 *
 * NAO unifique os dois predicados. A diferenca e de REGIME (ADR-048, Decisao
 * 2): ranking e exposicao de algo que ja acontece; desafio e compromisso que o
 * aluno assume. Um predicado servindo aos dois passa verde enquanto nenhum
 * teste misturar os casos -- e ai ou o aluno vira participante de um desafio
 * que nunca aceitou, ou some do ranking.
 */

/** Teto de seguranca que o template fixa (`M5-BR-011`). */
export interface LimiteDoTemplate {
  readonly maxSessoesPorSemana: number;
  readonly maxJanelaEmDias: number;
}

/** Janela do desafio, em dia local da unidade. Bordas INCLUSIVAS. */
export interface JanelaDoDesafio {
  readonly inicio: string;
  readonly fim: string;
}

export type MotivoDeRecusaDeMeta =
  | 'JANELA_INVALIDA'
  | 'JANELA_LONGA_DEMAIS'
  | 'META_INVALIDA'
  | 'FREQUENCIA_ACIMA_DO_LIMITE';

export type AvaliacaoDeMeta =
  | { readonly permitido: true }
  | { readonly permitido: false; readonly motivo: MotivoDeRecusaDeMeta };

const MS_POR_DIA = 86_400_000;
const DIAS_POR_SEMANA = 7;

/**
 * Dias entre duas datas locais, INCLUSIVO nas duas bordas.
 *
 * `Date.UTC` e usado como ARITMETICA DE CALENDARIO, nao como instante: os tres
 * numeros ja vem do dia local da unidade, e fixar UTC garante que a subtracao
 * nao atravesse horario de verao. Nao ha fuso sendo aplicado aqui.
 */
function paraEpoch(dia: string): number {
  const ano = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const diaDoMes = Number(dia.slice(8, 10));

  return Date.UTC(ano, mes - 1, diaDoMes);
}

function diasNaJanela(inicio: string, fim: string): number {
  return (paraEpoch(fim) - paraEpoch(inicio)) / MS_POR_DIA + 1;
}

/**
 * A meta cabe no teto profissional do template?
 *
 * O teto e POR SEMANA, e a conversao e o ponto: um teto "por janela" generoso
 * aprovaria 30 sessoes em 30 dias -- treino diario, sem descanso. Semanas
 * parciais contam como semana (`Math.ceil`), senao uma janela de 10 dias
 * (1,43 semanas) teria teto de 7 sessoes com `Math.floor`, permitindo 5 delas
 * em 3 dias corridos.
 */
export function avaliarLimiteDoTemplate(
  limite: LimiteDoTemplate,
  desafio: { readonly inicio: string; readonly fim: string; readonly meta: number },
): AvaliacaoDeMeta {
  if (desafio.fim < desafio.inicio) {
    return { permitido: false, motivo: 'JANELA_INVALIDA' };
  }

  const dias = diasNaJanela(desafio.inicio, desafio.fim);

  if (dias > limite.maxJanelaEmDias) {
    return { permitido: false, motivo: 'JANELA_LONGA_DEMAIS' };
  }

  if (!Number.isInteger(desafio.meta) || desafio.meta <= 0) {
    return { permitido: false, motivo: 'META_INVALIDA' };
  }

  const semanas = Math.ceil(dias / DIAS_POR_SEMANA);
  const tetoDaJanela = semanas * limite.maxSessoesPorSemana;

  if (desafio.meta > tetoDaJanela) {
    return { permitido: false, motivo: 'FREQUENCIA_ACIMA_DO_LIMITE' };
  }

  return { permitido: true };
}

/**
 * Quantos dias distintos o aluno treinou DENTRO da janela.
 *
 * Deduplica por conta propria mesmo com o indice unico da F24 garantindo uma
 * sessao por `(aluno, dia, unidade, politica)`: o desafio pode valer para o
 * tenant inteiro, e ai duas unidades produzem duas sessoes no mesmo dia local.
 * Contar as duas daria progresso 2 por um dia de treino.
 */
export function progressoNoDesafio(
  diasTreinados: readonly string[],
  janela: JanelaDoDesafio,
): number {
  const dentro = new Set<string>();

  for (const dia of diasTreinados) {
    if (dia >= janela.inicio && dia <= janela.fim) dentro.add(dia);
  }

  return dentro.size;
}

export type StatusDoDesafio = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type StatusDaParticipacao = 'JOINED' | 'LEFT' | 'COMPLETED' | 'FAILED';

export type MotivoDeRecusaDeInscricao =
  | 'DESAFIO_NAO_ESTA_ABERTO'
  | 'FORA_DA_JANELA'
  | 'JA_INSCRITO';

export type AvaliacaoDeInscricao =
  | { readonly permitido: true }
  | { readonly permitido: false; readonly motivo: MotivoDeRecusaDeInscricao };

/**
 * O aluno pode se inscrever AGORA?
 *
 * `participacao` nula = nunca se inscreveu, e o padrao e NAO participar
 * (opt-in). Quem saiu (`LEFT`) pode voltar; quem ja concluiu ou fracassou nao
 * se reinscreve no mesmo desafio -- o resultado dele ja esta congelado.
 *
 * A janela e conferida ALEM do status porque `ACTIVE` com janela vencida e
 * estado real: o encerramento roda em lote e pode nao ter passado ainda.
 * Inscrever ali criaria participante que nasce fracassado.
 */
export function podeInscrever(
  desafio: { readonly status: StatusDoDesafio; readonly inicio: string; readonly fim: string },
  participacao: { readonly status: StatusDaParticipacao } | null,
  hoje: string,
): AvaliacaoDeInscricao {
  if (desafio.status !== 'ACTIVE') {
    return { permitido: false, motivo: 'DESAFIO_NAO_ESTA_ABERTO' };
  }

  if (hoje < desafio.inicio || hoje > desafio.fim) {
    return { permitido: false, motivo: 'FORA_DA_JANELA' };
  }

  if (participacao !== null && participacao.status !== 'LEFT') {
    return { permitido: false, motivo: 'JA_INSCRITO' };
  }

  return { permitido: true };
}

/**
 * Em que estado a participacao esta, dado o progresso.
 *
 * A ORDEM E O DESENHO: a meta batida vence o fechamento da janela. Avaliar
 * `janelaFechada` primeiro marcaria `FAILED` quem bateu a meta no ultimo dia e
 * so teve o desfecho calculado depois -- punindo exatamente quem cumpriu.
 */
export function desfechoDaParticipacao(estado: {
  readonly progresso: number;
  readonly meta: number;
  readonly janelaFechada: boolean;
}): Extract<StatusDaParticipacao, 'JOINED' | 'COMPLETED' | 'FAILED'> {
  if (estado.progresso >= estado.meta) return 'COMPLETED';

  return estado.janelaFechada ? 'FAILED' : 'JOINED';
}
