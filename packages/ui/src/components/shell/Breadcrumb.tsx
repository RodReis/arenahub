import estilos from './Breadcrumb.module.css';

export interface Migalha {
  readonly rotulo: string;
  /** Ausente na última migalha -- é a página atual, não um link. */
  readonly href?: string;
}

interface Props {
  readonly trilha: readonly Migalha[];
}

/**
 * Trilha de navegação -- DS-PAINEL.md §5, substitui o link solto "Voltar
 * para X" que cada ficha reimplementava.
 *
 * A ÚLTIMA migalha é a página atual: sem `href`, sem estilo de link,
 * `aria-current="page"` -- mesmo padrão do item ativo da sidebar
 * (`.navlink[aria-current='page']` em `AppShell.module.css`), não uma
 * invenção nova de semântica.
 */
export function Breadcrumb({ trilha }: Props) {
  return (
    <nav aria-label="Trilha de navegação">
      <ol className={estilos['trilha']}>
        {trilha.map((migalha, indice) => {
          const ehAtual = indice === trilha.length - 1;

          return (
            <li key={`${migalha.rotulo}-${indice}`} className={estilos['item']}>
              {indice > 0 ? <span aria-hidden="true">/</span> : null}
              {ehAtual || !migalha.href ? (
                <span aria-current={ehAtual ? 'page' : undefined}>{migalha.rotulo}</span>
              ) : (
                <a href={migalha.href}>{migalha.rotulo}</a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
