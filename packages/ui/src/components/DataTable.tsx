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
}: Props<T>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      <table className={estilos['tabela']}>
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
            <tr key={rowKey(linha)}>
              {columns.map((coluna) => (
                <td key={coluna.key} {...(coluna.numeric === true ? { 'data-numeric': '' } : {})}>
                  {coluna.render(linha)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

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
