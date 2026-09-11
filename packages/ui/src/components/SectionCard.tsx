import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './SectionCard.module.css';

interface Props {
  readonly title: string;
  /** Uma frase: o que a secao faz, ou o limite que ela impoe. */
  readonly summary?: string;
  readonly icon?: IconName;
  /**
   * `perigo` tinge o cabecalho e o glifo com o tom semantico de risco -- e do
   * bloco que desliga o cliente, nao de qualquer secao importante.
   */
  readonly tom?: 'neutro' | 'perigo';
  /** Controles do canto direito do cabecalho. */
  readonly actions?: ReactNode;
  /** Corpo que ja e uma tabela: dispensa o respiro interno do card. */
  readonly encaixe?: boolean;
  readonly children: ReactNode;
  readonly testId?: string;
}

/**
 * Card de secao -- o que dava forma ao que era um empilhamento de formularios.
 *
 * SERVER COMPONENT: e so estrutura, e manter assim evita arrastar cada tela
 * que o usa para o cliente. Quem precisa de estado passa um filho `'use
 * client'`, como o resto do design system ja faz com o `trailing` do `Field`.
 *
 * `<section>` com `aria-labelledby` apontando para o proprio titulo: o leitor
 * de tela anuncia "Dados do cliente, regiao", e navegar por regioes passa a
 * valer a pena numa tela de quatro blocos -- que era exatamente o que faltava
 * quando os quatro eram `<form>` irmaos sem nome nenhum.
 */
export function SectionCard({
  title,
  summary,
  icon,
  tom = 'neutro',
  actions,
  encaixe,
  children,
  testId,
}: Props) {
  const id = `secao-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return (
    <section
      className={estilos['card']}
      data-tom={tom === 'perigo' ? 'perigo' : undefined}
      data-encaixe={encaixe === true ? 'true' : undefined}
      aria-labelledby={id}
      data-testid={testId}
    >
      <header className={estilos['cabecalho']}>
        {icon !== undefined ? (
          <span className={estilos['glifo']}>
            <Icon name={icon} />
          </span>
        ) : null}

        <div className={estilos['textos']}>
          <h2 id={id} className={estilos['titulo']}>
            {title}
          </h2>
          {summary !== undefined ? <p className={estilos['resumo']}>{summary}</p> : null}
        </div>

        {actions !== undefined ? <div className={estilos['acoes']}>{actions}</div> : null}
      </header>

      <div className={estilos['corpo']}>{children}</div>
    </section>
  );
}
