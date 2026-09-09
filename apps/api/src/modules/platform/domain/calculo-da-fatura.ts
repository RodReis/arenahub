/**
 * Calculo da fatura da plataforma -- F64, ADR-052 (Fatura da plataforma).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). O "agora" e a
 * contagem de alunos entram por parametro -- quem consulta o banco e o caso de
 * uso. E o mesmo contrato de `correcao-por-indice.ts`, e pela mesma razao: e
 * aqui que mora a aritmetica de dinheiro, e ela precisa ser testavel sem subir
 * nada.
 *
 * ---------------------------------------------------------------------------
 * TUDO EM UTC, SEM EXCECAO.
 * ---------------------------------------------------------------------------
 *
 * A competencia sai do instante em UTC, e nao do fuso da academia. Em Sao
 * Paulo, o dia 1 as 00:00 local e o dia 30 do mes ANTERIOR as 03:00 UTC: um
 * job da madrugada faturaria o mes errado, e a chave unica
 * `(tenant, competencia)` aceitaria as duas linhas sem reclamar, porque de
 * fato sao meses diferentes. A idempotencia so vale se o mes for calculado do
 * mesmo jeito em toda a cadeia.
 */

import type { SaasPricingModel } from '@arenahub/database';

/** Os valores do contrato que a fatura le -- copia, nunca o `SaasPlan`. */
export interface ValoresDoContrato {
  readonly model: SaasPricingModel;
  readonly activeStudentPriceMinor: number | null;
  readonly inactiveStudentPriceMinor: number | null;
  /** Ja CORRIGIDO pelo indice quando o modelo e fixo -- ADR-052 §7. */
  readonly fixedPriceMinor: number | null;
}

/** O retrato dos alunos no dia da emissao. */
export interface ContagemDeAlunos {
  readonly ativos: number;
  readonly inativos: number;
}

/** As colunas da fatura que saem do calculo. */
export interface FaturaCalculada {
  readonly activeCount: number;
  readonly inactiveCount: number;
  readonly activeStudentPriceMinor: number | null;
  readonly inactiveStudentPriceMinor: number | null;
  readonly totalMinor: number;
}

/**
 * Quanto cobrar da academia nesta competencia.
 *
 * Aritmetica INTEIRA do inicio ao fim (regra 6): contagem inteira vezes preco
 * inteiro em centavos nunca produz fracao, entao nao ha arredondamento a
 * fazer aqui -- e nao havendo, nao ha onde ele divergir. O unico ponto do
 * sistema que arredonda e a correcao por indice, e ela acontece antes, sobre
 * o valor fixo.
 */
export function calcularFatura(
  contrato: ValoresDoContrato,
  contagem: ContagemDeAlunos,
): FaturaCalculada {
  if (contrato.model === 'FIXED_MONTHLY') {
    /*
     * CONTAGEM ZERADA no modelo fixo, e nao a contagem real.
     *
     * Gravar quantos alunos a academia tinha numa fatura que nao cobra por
     * aluno guardaria um numero que ninguem usou para cobrar -- e a proxima
     * leitura (uma tela, um relatorio, a F65) nao teria como saber disso. O
     * CHECK `platform_invoices_campos_por_modelo` recusa o contrario.
     */
    return {
      activeCount: 0,
      inactiveCount: 0,
      activeStudentPriceMinor: null,
      inactiveStudentPriceMinor: null,
      totalMinor: contrato.fixedPriceMinor ?? 0,
    };
  }

  const precoAtivo = contrato.activeStudentPriceMinor ?? 0;
  const precoInativo = contrato.inactiveStudentPriceMinor ?? 0;

  return {
    activeCount: contagem.ativos,
    // A contagem de inativos entra mesmo com preco zero: o tenant precisa ver
    // quantos entraram no calculo, ainda que nao tenham custado nada.
    inactiveCount: contagem.inativos,
    activeStudentPriceMinor: precoAtivo,
    inactiveStudentPriceMinor: precoInativo,
    totalMinor: contagem.ativos * precoAtivo + contagem.inativos * precoInativo,
  };
}

/** A competencia (primeiro dia do mes, UTC) a que um instante pertence. */
export function competenciaDe(instante: Date): Date {
  return new Date(Date.UTC(instante.getUTCFullYear(), instante.getUTCMonth(), 1));
}

/**
 * O vencimento: o dia de emissao dentro da propria competencia.
 *
 * `issueDay` para em 28 no banco (CHECK da F63), entao a data existe em
 * fevereiro sem regra de excecao -- e por isso nao ha nada a tratar aqui.
 */
export function vencimentoDaFatura(competencia: Date, issueDay: number): Date {
  return new Date(Date.UTC(competencia.getUTCFullYear(), competencia.getUTCMonth(), issueDay));
}

/**
 * A proxima data de emissao a partir de `agora` -- inclusive hoje.
 *
 * So o painel usa: o job nao pergunta "quando emite", ele pergunta "a
 * competencia corrente ja tem fatura?". Serve para a previa dizer ao OWNER
 * qual dia a fatura sai.
 */
export function proximaEmissao(agora: Date, issueDay: number): Date {
  const desteMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), issueDay));

  if (competenciaDe(agora).getTime() === competenciaDe(desteMes).getTime() && agora <= fimDoDia(desteMes)) {
    return desteMes;
  }

  return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() + 1, issueDay));
}

/** O ultimo instante do dia, para "hoje ainda conta". */
function fimDoDia(dia: Date): Date {
  return new Date(dia.getTime() + 24 * 60 * 60 * 1000 - 1);
}
