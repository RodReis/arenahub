/**
 * Analise por intencao de tratar (F39, Slice 6.4, `M6-AC-007`).
 *
 * PURA: recebe os participantes ja alocados e devolve o resumo. Sem banco, sem
 * relogio, sem sorteio.
 *
 * ---------------------------------------------------------------------------
 * O QUE "INTENCAO DE TRATAR" QUER DIZER, E POR QUE E A UNICA HONESTA
 * ---------------------------------------------------------------------------
 *
 * ITT conta o aluno no grupo em que ele foi ALOCADO, mesmo que a intervencao
 * nao tenha acontecido -- ninguem atendeu o telefone, a tarefa expirou, a
 * recepcao nao chegou nela.
 *
 * A alternativa tentadora e "analisar so quem foi de fato contatado". Ela
 * parece mais justa e e o vies classico do campo: quem atende o telefone e
 * sistematicamente mais engajado do que quem nao atende. Comparar
 * "contatados" contra "controle inteiro" mede a diferenca entre pessoas
 * engajadas e pessoas medias -- nao o efeito da ligacao. O numero sai bonito e
 * nao significa nada.
 *
 * Por isso a taxa de contato e REPORTADA ao lado, e nao usada para filtrar: um
 * efeito nulo com 10% de contato quer dizer "quase ninguem foi tratado", e um
 * efeito nulo com 90% quer dizer "ligar nao adiantou". Sao conclusoes opostas,
 * e sem a taxa as duas parecem iguais.
 *
 * ---------------------------------------------------------------------------
 * EFEITO ADVERSO E MEDIDO NOS DOIS GRUPOS
 * ---------------------------------------------------------------------------
 *
 * `M6-AC-011` pede impacto operacional E efeitos adversos. Medir cancelamento
 * so no tratamento nao diz nada -- aluno em risco cancela de qualquer jeito. O
 * que interessa e a DIFERENCA: se o tratamento cancela mais que o controle, a
 * ligacao esta lembrando a pessoa de sair.
 */

import type { GrupoDoExperimento } from './randomizacao.js';

/**
 * O que pode ter dado errado. Decisao do PI em 31/08/2026.
 *
 * `RECUSOU` sai de graca da F38 (resultado da interacao). `OPT_OUT`,
 * `CANCELOU` e `SUPRESSAO_SOLICITADA` sao estado do aluno na janela.
 */
export const EFEITOS_ADVERSOS = [
  'OPT_OUT',
  'CANCELOU',
  'RECUSOU',
  'SUPRESSAO_SOLICITADA',
] as const;

export type EfeitoAdverso = (typeof EFEITOS_ADVERSOS)[number];

/**
 * O minimo por braco para o resultado valer alguma coisa.
 *
 * Nao e teste de significancia -- e um piso grosseiro que impede a leitura
 * ingenua de "3 de 4 permaneceram, logo 75%". Com menos que isso o relatorio
 * sai marcado `conclusivo: false`, e a decisao de continuar/ajustar/interromper
 * espera mais dado.
 */
const MINIMO_POR_BRACO = 50;

export interface ParticipanteDoExperimento {
  readonly studentId: string;
  readonly grupo: GrupoDoExperimento;
  /** A metrica primaria: ainda tinha assinatura ativa no fim da janela. */
  readonly permaneceu: boolean;
  /** So faz sentido no tratamento; no controle e sempre `false`. */
  readonly contatado?: boolean;
  readonly adversos?: readonly EfeitoAdverso[];
}

export interface ResumoDoBraco {
  readonly participantes: number;
  readonly permaneceram: number;
  readonly taxaDePermanencia: number;
  readonly contatados: number;
  readonly taxaDeContato: number;
  readonly adversos: Readonly<Record<EfeitoAdverso, number>>;
}

export interface ResultadoDoExperimento {
  readonly tratamento: ResumoDoBraco;
  readonly controle: ResumoDoBraco;
  /** Tratamento menos controle, em pontos percentuais. Positivo = tratamento reteve mais. */
  readonly diferencaEmPontos: number;
  /** `false` quando algum braco esta abaixo do minimo -- nao decida com isso. */
  readonly conclusivo: boolean;
}

function zerado(): Record<EfeitoAdverso, number> {
  return { OPT_OUT: 0, CANCELOU: 0, RECUSOU: 0, SUPRESSAO_SOLICITADA: 0 };
}

function resumir(participantes: readonly ParticipanteDoExperimento[]): ResumoDoBraco {
  const adversos = zerado();

  let permaneceram = 0;
  let contatados = 0;

  for (const participante of participantes) {
    if (participante.permaneceu) permaneceram += 1;
    if (participante.contatado === true) contatados += 1;

    // `Set` por aluno: o mesmo efeito listado duas vezes para a mesma pessoa e
    // uma pessoa, nao duas. Contar repetido inflaria o dano medido.
    for (const efeito of new Set(participante.adversos ?? [])) {
      adversos[efeito] += 1;
    }
  }

  const total = participantes.length;

  return {
    participantes: total,
    permaneceram,
    // Zero, e nao `NaN`: braco vazio e um numero que a tela consegue desenhar.
    taxaDePermanencia: total === 0 ? 0 : permaneceram / total,
    contatados,
    taxaDeContato: total === 0 ? 0 : contatados / total,
    adversos,
  };
}

export function analisarPorIntencaoDeTratar(
  participantes: readonly ParticipanteDoExperimento[],
): ResultadoDoExperimento {
  // Agrupa pelo grupo ALOCADO -- nunca por quem foi efetivamente contatado.
  const tratamento = resumir(participantes.filter((p) => p.grupo === 'TRATAMENTO'));
  const controle = resumir(participantes.filter((p) => p.grupo === 'CONTROLE'));

  return {
    tratamento,
    controle,
    diferencaEmPontos: (tratamento.taxaDePermanencia - controle.taxaDePermanencia) * 100,
    conclusivo:
      tratamento.participantes >= MINIMO_POR_BRACO &&
      controle.participantes >= MINIMO_POR_BRACO,
  };
}
