import type { ReactNode } from 'react';

import estilos from './DataTable.module.css';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  /** Liga numeral tabular -- coluna de valor, horario, matricula ou contador. */
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
        {...(testId !== undefined ? { 'data-testid': testId } : {})}
      >
        <caption className={estilos['legenda']}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((coluna) => (
              <th key={coluna.key} scope="col">
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
                <td key={coluna.key} {...(coluna.numeric === true ? { 'data-numeric': '' } : {})}>
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
