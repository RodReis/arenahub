import type { ReactNode } from 'react';

import estilos from './DataTable.module.css';

/**
 * O PAPEL da coluna, nao a sua aparencia.
 *
 * Declarar `role` em vez de largura e alinhamento e o que faz treze tabelas
 * parecerem a mesma tabela. Quem escreve a tela responde "o que esta coluna
 * E"; a proporcao entre as colunas sai disso, e sai igual em todo lugar.
 *
 * - `identity` -- quem/o que a linha e. Primeira coluna, a mais larga, e a
 *   que o olho procura ao varrer verticalmente.
 * - `code`     -- identificador legivel (matricula, serie, numero da fatura).
 *   Monoespacado e A ESQUERDA: ninguem soma matricula, e alinha-la a direita
 *   com larguras diferentes ("AP-2026-00000147" vs "DEMO-012") abre um vao
 *   irregular ate a coluna seguinte. Codigo se COMPARA CARACTERE A CARACTERE,
 *   e para isso o que importa e comecarem no mesmo ponto.
 * - `state`    -- badge ou rotulo de situacao. Estreita e fixa: badge nao
 *   cresce, e deixar a coluna crescer afasta o estado do nome.
 * - `value`    -- numero comparavel entre linhas (dinheiro, contador,
 *   matricula). ALINHA A DIREITA de verdade, que e o que `numeric` prometia.
 * - `moment`   -- data, hora ou idade. Largura previsivel, nao quebra.
 * - `support`  -- texto de apoio vindo da API. E o unico que cede espaco: sem
 *   teto, uma frase de tres linhas empurra para a margem justamente o dado
 *   que a tela existe para comparar.
 * - `actions`  -- botao ou form na linha. Encosta a direita e nao cresce.
 */
export type ColumnRole =
  | 'identity'
  | 'code'
  | 'state'
  | 'value'
  | 'moment'
  | 'support'
  | 'actions';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  /**
   * O papel da coluna. Ver `ColumnRole`.
   *
   * Opcional para nao quebrar as tabelas que ainda nao declararam -- elas caem
   * no comportamento neutro de antes.
   */
  readonly role?: ColumnRole;
  /**
   * Liga numeral tabular.
   *
   * MANTIDO POR COMPATIBILIDADE, mas `role: 'value'` e o caminho: `numeric`
   * so emitia `data-numeric`, e o `globals.css` do painel ja aplica
   * `tabular-nums` a tabela inteira -- ou seja, ele nunca alinhou nada. Oito
   * colunas o usavam achando que alinhava.
   *
   * @deprecated Use `role: 'value'`.
   */
  readonly numeric?: boolean;
}

interface Props<T> {
  readonly rows: readonly T[];
  readonly columns: readonly Column<T>[];
  readonly caption: string;
  readonly rowKey: (row: T) => string;
  readonly empty: ReactNode;
  readonly prevHref?: string;
  readonly nextHref?: string;
  /**
   * `data-testid` da `<table>`.
   *
   * Existe porque as tabelas que este componente substitui ja carregam testid
   * que os E2E procuram. A migracao troca a aparencia, nao o comportamento --
   * e testid perdido derruba o teste que provaria isso.
   */
  readonly testId?: string;
  /** `data-testid` por linha, ex.: `aluno-${id}`. */
  readonly rowTestId?: (row: T) => string;
}

/**
 * Tabela do painel -- DS-PAINEL.md §5 e §9.
 *
 * Paginacao por CURSOR, sem numeracao de paginas: numero exigiria `COUNT(*)`
 * a cada consulta e mentiria, porque o total muda entre um clique e outro
 * enquanto a recepcao cadastra. "Anteriores / Proximos" mais contador de itens
 * carregados nunca mente.
 *
 * `caption` e obrigatorio: tabela sem legenda e opaca no leitor de tela. As 12
 * tabelas que este componente substitui ja acertavam isso -- e `scope="col"`
 * em todos os 61 cabecalhos. O componente preserva; regressao aqui e
 * regressao de acessibilidade.
 */
export function DataTable<T>({
  rows,
  columns,
  caption,
  rowKey,
  empty,
  prevHref,
  nextHref,
  testId,
  rowTestId,
}: Props<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      {/*
        Container de rolagem -- issue #99.

        Tabela larga (7 colunas em `/access-events`) estourava a pagina inteira
        a 640px, o equivalente a 1280 com zoom de 200%: 142px de excesso, com o
        DS-PAINEL §10.8 proibindo rolagem horizontal nesse zoom. Rolar A TABELA
        em vez da PAGINA e a diferenca entre varrer uma coluna e varrer cada
        frase do painel nos dois eixos.

        `tabIndex={0}` nao e enfeite: container rolavel sem foco e inalcancavel
        por teclado -- quem nao usa mouse simplesmente nao chega nas colunas da
        direita. Com ele, a regiao entra na ordem de tabulacao e rola com as
        setas. O `role="region"` + `aria-label` dao ao leitor de tela o nome do
        que rola, senao o anuncio e um "region" mudo.
      */}
      <div
        className={estilos['rolagem']}
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
      <table
        className={estilos['tabela']}
        /*
         * Duas colunas de apoio dividem o piso pela metade -- ver o comentario
         * em `DataTable.module.css`. Derivado das colunas e nao declarado pela
         * tela: quem escreve a tabela ja disse quais colunas sao de apoio, e
         * pedir a informacao duas vezes deixa as duas divergirem.
         */
        {...(columns.filter((c) => c.role === 'support').length > 1
          ? { 'data-support-pair': '' }
          : {})}
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
      >
        <caption className={estilos['legenda']}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((coluna) => (
              <th
                key={coluna.key}
                scope="col"
                {...(coluna.role !== undefined ? { 'data-role': coluna.role } : {})}
                {...(coluna.numeric === true ? { 'data-numeric': '' } : {})}
              >
                {coluna.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((linha) => (
            <tr
              key={rowKey(linha)}
              {...(rowTestId !== undefined ? { 'data-testid': rowTestId(linha) } : {})}
            >
              {columns.map((coluna) => (
                <td
                  key={coluna.key}
                  {...(coluna.role !== undefined ? { 'data-role': coluna.role } : {})}
                  {...(coluna.numeric === true ? { 'data-numeric': '' } : {})}
                >
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {prevHref !== undefined || nextHref !== undefined ? (
        <nav className={estilos['paginacao']} aria-label="Paginação">
          {prevHref !== undefined ? <a href={prevHref}>Anteriores</a> : null}
          <span className={estilos['contador']}>{rows.length} itens carregados</span>
          {nextHref !== undefined ? <a href={nextHref}>Próximos</a> : null}
        </nav>
      ) : null}
    </>
  );
}
