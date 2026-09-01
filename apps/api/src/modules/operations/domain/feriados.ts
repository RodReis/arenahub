/**
 * Calendario de feriados da unidade -- F57, bloco 7.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" e o fuso da
 * unidade entram por parametro.
 *
 * NACIONAIS vem de `date-holidays`, que resolve EM PROCESSO a partir de dados
 * embutidos -- nunca por rede (`SPEC-057` §5.1). A API roda em rede de
 * academia; um bloco do painel que depende do link de um terceiro fica vazio
 * exatamente no dia em que a internet cai.
 *
 * MUNICIPAIS nao sao calculaveis: vem do cadastro por unidade (§5.2, saida A).
 */
import Holidays from 'date-holidays';

/** De onde a data veio -- a tela distingue o que da para editar. */
export type OrigemDoFeriado = 'NACIONAL' | 'MUNICIPAL';

export interface FeriadoDoCalendario {
  /** `AAAA-MM-DD` no fuso da unidade. */
  readonly data: string;
  readonly nome: string;
  readonly origem: OrigemDoFeriado;
}

/**
 * Que tipos da biblioteca contam como "a academia fecha".
 *
 * A resposta nao e um tipo so, e por isso esta escrita aqui em vez de inline:
 *
 * - `public` traz os nacionais de lei -- MENOS o "Dia de Eleicao", que a
 *   biblioteca classifica como publico e em que academia abre normalmente
 *   (ele so aparece em ano par, o que torna o defeito invisivel metade do
 *   tempo -- medido para 2025-2028).
 * - `bank` traz Carnaval (segunda e terca) e Corpus Christi, que sao
 *   justamente os dias em que a recepcao mais pergunta se abre.
 * - `optional` e `observance` NAO entram: Dia das Maes e Dia dos Namorados
 *   nao fecham academia nenhuma, e vespera de Natal e decisao da unidade --
 *   quem quiser fechar cadastra como municipal.
 */
const TIPOS_QUE_FECHAM: readonly string[] = ['public', 'bank'];

/**
 * Dia de eleicao e feriado civil, nao dia de porta fechada.
 *
 * Casado pelo NOME porque a biblioteca nao da outro discriminador: o tipo e
 * `public`, igual ao Natal.
 */
const NAO_FECHA_ACADEMIA = /elei[çc][ãa]o/i;

/**
 * Os feriados nacionais de um ano, ja no formato do calendario.
 *
 * Ordenados por data: a lista alimenta uma tela, e ordem de biblioteca nao e
 * contrato.
 */
export function feriadosNacionais(ano: number): readonly FeriadoDoCalendario[] {
  const calendario = new Holidays('BR');

  return calendario
    .getHolidays(ano)
    .filter((f) => TIPOS_QUE_FECHAM.includes(f.type) && !NAO_FECHA_ACADEMIA.test(f.name))
    .map((f) => ({
      // `f.date` vem como `AAAA-MM-DD HH:mm:ss` na hora local do pais; o dia
      // e o prefixo, e cortar e mais seguro que reparsear para Date -- o
      // reparse reintroduziria fuso onde ja nao ha.
      data: f.date.slice(0, 10),
      nome: f.name,
      origem: 'NACIONAL' as const,
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Nacionais + municipais de um MES, sem duplicata.
 *
 * O municipal vence o nacional na mesma data: se a unidade cadastrou algo em
 * 25/12, foi porque quis dizer outra coisa sobre aquele dia, e o cadastro
 * dela e mais especifico que a lista do pais.
 */
export function feriadosDoMes(
  mes: string,
  municipais: readonly FeriadoDoCalendario[],
): readonly FeriadoDoCalendario[] {
  const ano = Number(mes.slice(0, 4));

  const doMes = (f: FeriadoDoCalendario): boolean => f.data.startsWith(mes);

  const municipaisDoMes = municipais.filter(doMes);
  const datasCadastradas = new Set(municipaisDoMes.map((f) => f.data));

  return [
    ...feriadosNacionais(ano).filter((f) => doMes(f) && !datasCadastradas.has(f.data)),
    ...municipaisDoMes,
  ].sort((a, b) => a.data.localeCompare(b.data));
}
