import type { ReactNode } from 'react';

import estilos from './login.module.css';
import { lerVersaoDoPainel } from '../../../src/version';

const FUSO_PROVISORIO = 'America/Sao_Paulo';

/**
 * A mesma moldura de duas colunas do login, para as telas do segundo fator.
 *
 * Reaproveitada de propósito: o desafio é a continuação do mesmo login, e
 * trocar a página inteira no meio do fluxo faria parecer que a pessoa saiu do
 * produto -- exatamente na tela em que ela está sendo perguntada se é quem
 * diz ser.
 */
export function MolduraDeSegundoFator({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
}) {
  return (
    <main className={estilos['tela']}>
      <aside className={estilos['identidade']} aria-hidden="true">
        <p className={estilos['wordmark']}>
          arenahub<span>.</span>
        </p>

        <div className={estilos['discurso']}>
          <p className={estilos['frase']}>Da matrícula ao resultado físico do aluno.</p>
          <p className={estilos['apoio']}>
            Pagamento, reconhecimento facial, acesso, frequência e evolução em uma única
            plataforma.
          </p>
        </div>

        <p className={estilos['rodape']}>
          admin-web v{lerVersaoDoPainel()} · {FUSO_PROVISORIO}
        </p>
      </aside>

      <div className={estilos['trabalho']}>
        <div className={estilos['painel']}>
          <div className={estilos['cabecalho']}>
            <h1 className={estilos['titulo']}>{titulo}</h1>
            <p className={estilos['subtitulo']}>{subtitulo}</p>
          </div>

          {children}
        </div>
      </div>
    </main>
  );
}
