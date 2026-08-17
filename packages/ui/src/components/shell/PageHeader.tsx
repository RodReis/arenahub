import type { ReactNode } from 'react';

import estilos from './AppShell.module.css';

interface Props {
  readonly title: string;
  readonly id?: string;
  readonly breadcrumb?: ReactNode;
  readonly actions?: ReactNode;
}

/**
 * Cabecalho de pagina -- DS-PAINEL.md §5: breadcrumb, titulo e acoes
 * primarias na mesma linha.
 *
 * `id` opcional porque as telas ja usam `aria-labelledby` apontando para o
 * proprio `<h1>`; a migracao passa o id que a `<section>` ja referencia, em
 * vez de quebrar a associacao existente.
 */
export function PageHeader({ title, id, breadcrumb, actions }: Props) {
  return (
    <header className={estilos['cabecalho']}>
      {breadcrumb}
      <div className={estilos['linha-titulo']}>
        <h1 className={estilos['titulo']} {...(id !== undefined ? { id } : {})}>
          {title}
        </h1>
        {actions !== undefined ? <div className={estilos['acoes']}>{actions}</div> : null}
      </div>
    </header>
  );
}
