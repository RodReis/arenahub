import { Button } from './Button.js';
import { Icon } from './Icon.js';
import estilos from './ProblemDetail.module.css';

/**
 * `application/problem+json` -- CLAUDE.md → Convencoes de codigo.
 *
 * Os cinco campos sao os mesmos de `ProblemDetails` em
 * `apps/admin-web/lib/api/server-client.ts`. A forma e estrutural, nao uma
 * copia a manter em sincronia: quem chama passa `resposta.erro` direto.
 */
export interface ProblemJson {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
}

interface Props {
  readonly problem: ProblemJson;
  /** Onde o erro aconteceu: "Catraca 02 · Recepção". */
  readonly context?: string;
  /** O proximo passo. Opcional porque nem todo erro sabe qual e. */
  readonly hint?: string;
  readonly onRetry?: () => void;
  /**
   * `data-testid` do bloco de erro -- as 6 telas que este componente
   * substitui ja carregam `erro-de-permissao`.
   */
  readonly testId?: string;
}

/**
 * Erro com os quatro campos que a recepcao precisa -- DS-PAINEL.md §8.1.
 *
 * O tipo lista SO o que a tela mostra, e isso e deliberado: o payload pode
 * trazer `stack` ou `detail` tecnico, e este componente e burro de proposito.
 * Stack, detalhe interno e PII nunca aparecem -- nem na tela, nem no log de
 * erro do navegador.
 */
export function ProblemDetail({ problem, context, hint, onRetry, testId }: Props) {
  return (
    <div
      className={estilos['problema']}
      role="alert"
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <p className={estilos['titulo']}>
        <Icon name="alert-circle" />
        {problem.title}
      </p>

      {context ? <p className={estilos['contexto']}>{context}</p> : null}
      {hint ? <p className={estilos['acao']}>O que fazer: {hint}</p> : null}

      {onRetry ? (
        <p>
          <Button variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        </p>
      ) : null}

      {/*
        `correlationId` visivel e a primeira coisa que o suporte pede. Fica
        selecionavel; o botao de copiar exige `navigator.clipboard`, portanto
        `'use client'`, e o feedback de "copiado" e o Toast -- os dois entram
        quando alguma tela precisar, nao antes.
      */}
      <p className={estilos['codigo']} data-testid="codigo-do-erro">
        {problem.code} · {problem.correlationId}
      </p>
    </div>
  );
}
