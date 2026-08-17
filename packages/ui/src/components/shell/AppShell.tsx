import type { ReactNode } from 'react';

import estilos from './AppShell.module.css';

interface Props {
  /**
   * Seletor ou indicador de unidade, no TOPBAR -- DS-PAINEL.md §5.
   *
   * Fica no topbar e nao na sidebar porque toda data, horario e politica
   * dependem da unidade, e o topbar e o unico lugar visivel em qualquer tela.
   * O §5 nomeia: "trocar de unidade sem perceber e o erro operacional mais
   * caro do painel".
   *
   * A TROCA de unidade e fatia separada (exige decisao de produto sobre
   * persistencia e escopo de sessao). Aqui entra o que a tela ja souber.
   */
  readonly unitSelector: ReactNode;
  readonly user: ReactNode;
  readonly nav: ReactNode;
  /** Faixa de sessao elevada, quando houver. */
  readonly banner?: ReactNode;
  readonly children: ReactNode;
}

const ID_CONTEUDO = 'conteudo-principal';

/**
 * Shell do painel -- DS-PAINEL.md §5. Topbar e sidebar em carbono; conteudo
 * sobre o canvas claro.
 */
export function AppShell({ unitSelector, user, nav, banner, children }: Props) {
  return (
    <div className={estilos['shell']}>
      {banner}

      {/*
        Skip link: sem ele, toda navegacao de rota reobriga quem usa teclado a
        tabular os sete links da sidebar antes de chegar ao conteudo. Fica
        invisivel ate receber foco.
      */}
      <a className={estilos['pular']} href={`#${ID_CONTEUDO}`}>
        Pular para o conteúdo
      </a>

      <header className={estilos['topbar']}>
        <span className={estilos['logo']}>ArenaHub</span>
        {unitSelector}
        <div className={estilos['direita']}>{user}</div>
      </header>

      <div className={estilos['corpo']}>
        <nav className={estilos['sidebar']} aria-label="Navegação principal">
          {nav}
        </nav>
        <main className={estilos['conteudo']} id={ID_CONTEUDO}>
          {children}
        </main>
      </div>
    </div>
  );
}
