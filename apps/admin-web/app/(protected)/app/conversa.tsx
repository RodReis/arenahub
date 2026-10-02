import { Fragment } from 'react';

import estilos from './aplicativo.module.css';

/**
 * A mensagem como o ALUNO vai ve-la no WhatsApp (#538): cartao de previa do
 * link (nome da academia, como a pagina /baixar o publica), texto com o link
 * azul e clicavel, hora e os dois tiques. E a resposta visual para "o que eu
 * estou mandando?" -- antes de mandar.
 *
 * O link abre em aba nova para a recepcao conferir a pagina que o aluno vai
 * receber.
 */
export function Conversa({
  mensagem,
  link,
  academia,
  destaque = false,
}: {
  readonly mensagem: string;
  readonly link: string;
  readonly academia: string;
  /** Pisca a borda quando a mensagem acabou de ser copiada. */
  readonly destaque?: boolean;
}) {
  const host = hostDe(link);

  return (
    <div className={estilos['conversa']} data-testid="previa-da-mensagem-conversa">
      <div className={estilos['topoDaConversa']} aria-hidden="true">
        <span className={estilos['avatar']}>{academia.slice(0, 1)}</span>
        <span className={estilos['nomeNaConversa']}>{academia}</span>
      </div>

      <div className={estilos['fundoDaConversa']}>
        <div
          className={estilos['balao']}
          data-destaque={destaque ? 'true' : 'false'}
          data-testid="previa-da-mensagem"
        >
          <a className={estilos['cartaoDoLink']} href={link} target="_blank" rel="noopener noreferrer">
            <span className={estilos['iconeDoCartao']} aria-hidden="true">
              {academia.slice(0, 1)}
            </span>
            <span className={estilos['textoDoCartao']}>
              <strong>Baixe o app da {academia}</strong>
              <span>{host}</span>
            </span>
          </a>

          <p className={estilos['textoDoBalao']}>
            {partes(mensagem, link).map((parte, indice) =>
              parte === link ? (
                <a key={indice} href={link} target="_blank" rel="noopener noreferrer" className={estilos['linkNoBalao']}>
                  {link}
                </a>
              ) : (
                <Fragment key={indice}>{parte}</Fragment>
              ),
            )}
          </p>

          <span className={estilos['horaDoBalao']} aria-hidden="true">
            agora
            <svg width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M1 5.5 3.8 8.3 9.5 1.8" />
              <path d="M6.5 8.3 12.2 1.8" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Quebra o texto em volta das ocorrencias do link, para pinta-lo de azul. */
function partes(texto: string, link: string): string[] {
  if (!link) return [texto];

  return texto.split(link).flatMap((trecho, indice, todos) =>
    indice < todos.length - 1 ? [trecho, link] : [trecho],
  );
}

function hostDe(link: string): string {
  try {
    return new URL(link).host;
  } catch {
    return link;
  }
}
