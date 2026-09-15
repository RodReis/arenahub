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
  /**
   * Rotulo acessivel da navegacao.
   *
   * Existe como prop, e nao fixo, porque o E2E que ja roda na `main` procura
   * `getByRole('navigation', { name: 'Navegacao principal' })` -- sem acento.
   * Trocar por "Navegação" quebraria um teste que afirma comportamento, numa
   * fatia que so pode mudar aparencia.
   *
   * A grafia certa e com acento; corrigir os dois lados junto e mudanca de
   * texto, portanto card separado.
   */
  readonly navLabel?: string;
  /** Faixa de sessao elevada, quando houver. */
  readonly banner?: ReactNode;
  readonly children: ReactNode;
}

const ID_CONTEUDO = 'conteudo-principal';

/**
 * Shell do painel -- DS-PAINEL.md §5. Topbar e sidebar em carbono; conteudo
 * sobre o canvas claro.
 */
export function AppShell({
  unitSelector,
  user,
  nav,
  navLabel = 'Navegação principal',
  banner,
  children,
}: Props) {
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
        <span className={estilos['marca']}>
          {/* Selo halter -- mesmo traço do hero de login (DS-PAINEL.md v2 §4.1). */}
          <span className={estilos['selo']} aria-hidden="true">
            <span className={estilos['seloMiolo']}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2.5 9.5v5 M5 7.5v9 M19 7.5v9 M21.5 9.5v5 M5 12h3.2 M15.8 12H19" />
              </svg>
            </span>
          </span>
          <span className={estilos['logo']}>
            arenahub<span className={estilos['ponto']}>.</span>
          </span>
        </span>
        {unitSelector}
        <div className={estilos['direita']}>{user}</div>
      </header>

      <div className={estilos['corpo']}>
        <nav className={estilos['sidebar']} aria-label={navLabel}>
          {nav}
        </nav>
        <main className={estilos['conteudo']} id={ID_CONTEUDO}>
          {children}
        </main>
      </div>
    </div>
  );
}
