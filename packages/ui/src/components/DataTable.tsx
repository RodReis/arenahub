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
 * - `label`    -- dado curto e FECHADO: nome de plano, tipo de dispositivo,
 *   origem. Nao e `code` (nao se le caractere a caractere, entao nao e mono) e
 *   nao e `support` (nao tem piso, porque nao e frase). Encolhe ao conteudo.
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
  | 'label'
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
   * Torna o cabeçalho clicável, ordenando por esta coluna.
   *
   * A tela recebe a chave e devolve o `href` — a ordenação é NAVEGAÇÃO, não
   * estado de componente. Ordenar no cliente mentiria numa lista paginada por
   * cursor: reordenaria as vinte linhas carregadas, não as mil que existem, e
   * a recepção acharia que viu o maior valor quando viu o maior da página.
   */
  readonly sortKey?: string;
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
  /**
   * Esta coluna e o CABECALHO DA LINHA (`<th scope="row">`), nao uma celula.
   *
   * Ligue quando a primeira coluna identifica a linha e a tabela e larga o
   * bastante para o leitor de tela precisar da ancora: com quatro colunas de
   * numero, `scope="row"` faz ele anunciar "Peso, 92,3 kg" em vez de ler os
   * numeros soltos sem dizer de qual medida sao (WCAG 2.2 AA, `M3-NFR-007`).
   *
   * Opcional e desligado por padrao: as tabelas que este componente ja serve
   * usam `<td>` em todas as celulas, e mudar isso de uma vez alteraria a
   * semantica de doze telas num commit que nao e sobre elas.
   */
  readonly rowHeader?: boolean;
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
   * Quantos itens o filtro alcanca -- o denominador do "20 de 341".
   *
   * OPCIONAL de proposito: rota que nao informa total continua mostrando so
   * "20 itens carregados", como sempre mostrou. `undefined` e "nao sei", que
   * nao e o mesmo que zero -- anunciar "0" numa base cheia seria pior que
   * calar.
   */
  readonly total?: number;
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
  /**
   * Ordenação vigente e como mudá-la.
   *
   * `href` recebe a chave e a direção, e devolve o link — quem monta a URL é a
   * tela, que sabe quais outros filtros precisam sobreviver ao clique.
   */
  readonly sort?: {
    readonly key: string;
    readonly direction: 'asc' | 'desc';
    readonly href: (key: string, direction: 'asc' | 'desc') => string;
  };
}

/**
 * Tabela do painel -- DS-PAINEL.md §5 e §9.
 *
 * Paginacao por CURSOR, sem numeracao de paginas: numerar exigiria calcular
 * quantas paginas existem, e esse numero muda entre um clique e outro
 * enquanto a recepcao cadastra -- a pagina 5 de hoje nao e a pagina 5 de
 * daqui a um minuto. "Anteriores / Proximos" nunca mente sobre isso.
 *
 * O TOTAL, por outro lado, entrou em 01/09/2026 a pedido do PI, e a
 * preocupacao original foi MEDIDA em vez de presumida: `COUNT(*)` com os
 * mesmos filtros custa **0,27 ms sem filtro e 0,38 ms com filtro e busca**
 * no banco da bancada (1.968 alunos), os dois por indice. Ele muda entre
 * cliques como qualquer outro dado da tela -- e "20 de 1.968" com um segundo
 * de atraso e infinitamente mais util que "20 itens carregados", que nao
 * distingue uma base de 25 alunos de uma de 2.000.
 *
 * `caption` e obrigatorio: tabela sem legenda e opaca no leitor de tela. As 12
 * tabelas que este componente substitui ja acertavam isso -- e `scope="col"`
 * em todos os 61 cabecalhos. O componente preserva; regressao aqui e
 * regressao de acessibilidade.
 */
/**
 * Separador de milhar do total -- "1.968", nunca "1968".
 *
 * `Intl.NumberFormat` e nao `toLocaleString`: a regra 5 do lint (DS §11)
 * restringe o METODO, que e por onde a formatacao de data escaparia para o
 * fuso do navegador. Formatacao de NUMERO por `Intl.NumberFormat` e permitida
 * -- `formatarDinheiro` ja o usa pela mesma razao.
 *
 * Instancia UNICA no modulo, e nao uma por render: construir `Intl` e caro, e
 * a tabela redesenha a cada navegacao de pagina.
 */
const MILHAR = new Intl.NumberFormat('pt-BR');

export function DataTable<T>({
  rows,
  columns,
  caption,
  rowKey,
  empty,
  prevHref,
  nextHref,
  total,
  testId,
  rowTestId,
  sort,
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
            {columns.map((coluna) => {
              const ordenavel = coluna.sortKey !== undefined && sort !== undefined;
              const ativa = ordenavel && sort.key === coluna.sortKey;
              /*
                Clicar na coluna JÁ ordenada inverte; clicar em outra começa
                ascendente. É o que todo mundo espera de tabela, e quebrar a
                convenção aqui não compraria nada.
              */
              const proxima: 'asc' | 'desc' = ativa && sort.direction === 'asc' ? 'desc' : 'asc';

              return (
                <th
                  key={coluna.key}
                  scope="col"
                  {...(coluna.role !== undefined ? { 'data-role': coluna.role } : {})}
                  {...(coluna.numeric === true ? { 'data-numeric': '' } : {})}
                  /*
                    `aria-sort` é o que faz o leitor de tela anunciar "ordenado
                    de forma crescente" ao entrar na coluna. Sem ele, a seta é
                    informação só para quem enxerga.
                  */
                  {...(ativa
                    ? { 'aria-sort': sort.direction === 'asc' ? 'ascending' : 'descending' }
                    : {})}
                >
                  {ordenavel ? (
                    <a
                      className={estilos['ordenar']}
                      href={sort.href(coluna.sortKey, proxima)}
                      data-ativa={ativa ? '' : undefined}
                    >
                      {coluna.header}
                      <span className={estilos['seta']} aria-hidden="true">
                        {ativa ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
                      </span>
                    </a>
                  ) : (
                    coluna.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((linha) => (
            <tr
              key={rowKey(linha)}
              {...(rowTestId !== undefined ? { 'data-testid': rowTestId(linha) } : {})}
            >
              {columns.map((coluna) => {
                const atributos = {
                  ...(coluna.role !== undefined ? { 'data-role': coluna.role } : {}),
                  ...(coluna.numeric === true ? { 'data-numeric': '' } : {}),
                };

                /*
                 * `rowHeader` emite `<th scope="row">` no lugar de `<td>`.
                 *
                 * Numa tabela larga, isso e o que faz o leitor de tela
                 * anunciar "Peso, 92,3 kg" em vez de ler quatro numeros
                 * soltos sem dizer de qual medida sao. E OPCIONAL porque as
                 * doze tabelas que este componente ja serve usam `<td>` em
                 * todas as celulas -- ligar por padrao mudaria a semantica
                 * delas de uma vez, e cabecalho de linha so faz sentido
                 * quando a primeira coluna IDENTIFICA a linha.
                 */
                if (coluna.rowHeader === true) {
                  return (
                    <th key={coluna.key} scope="row" {...atributos}>
                      {coluna.render(linha)}
                    </th>
                  );
                }

                return (
                  <td key={coluna.key} {...atributos}>
                    {coluna.render(linha)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {/*
        O RODAPE APARECE TAMBEM SEM PAGINACAO, quando ha total.
        
        Antes ele so existia com "Anteriores" ou "Proximos" -- e numa base de
        18 alunos, que cabe numa pagina, a recepcao nao via contagem nenhuma.
        O total responde "quantos alunos existem?", pergunta que independe de
        haver proxima pagina; esconde-lo justamente na base pequena inverte
        quem mais precisa da resposta.
      */}
      {prevHref !== undefined || nextHref !== undefined || total !== undefined ? (
        <nav className={estilos['paginacao']} aria-label="Paginação">
          {prevHref !== undefined ? <a href={prevHref}>Anteriores</a> : null}
          <span className={estilos['contador']}>
            {total === undefined
              ? `${rows.length} itens carregados`
              : `${rows.length} de ${MILHAR.format(total)}`}
          </span>
          {nextHref !== undefined ? <a href={nextHref}>Próximos</a> : null}
        </nav>
      ) : null}
    </>
  );
}
