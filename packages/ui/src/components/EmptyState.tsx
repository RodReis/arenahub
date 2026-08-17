import type { ReactNode } from 'react';

import estilos from './EmptyState.module.css';

interface Props {
  readonly title: string;
  readonly hint?: string;
  /**
   * Vazio SEM saida e beco -- DS-PAINEL.md §9 exige acao de saida.
   *
   * As duas mensagens de vazio que ja existem no painel definem o padrao:
   * "Confira a grafia ou cadastre um novo aluno" e "Ajuste os filtros". Ambas
   * dizem o proximo passo em vez de so constatar a ausencia.
   */
  readonly action?: ReactNode;
  /**
   * `data-testid` do bloco INTEIRO -- titulo, dica e acao dentro dele.
   *
   * Os E2E que este componente herda afirmam sobre o conteudo do vazio
   * (`toContainText(/grafia|cadastre/i)`), nao so sobre sua presenca.
   */
  readonly testId?: string;
}

export function EmptyState({ title, hint, action, testId }: Props) {
  return (
    <div
      className={estilos['vazio']}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <p className={estilos['titulo']}>{title}</p>
      {hint ? <p className={estilos['dica']}>{hint}</p> : null}
      {action}
    </div>
  );
}
