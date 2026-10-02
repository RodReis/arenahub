'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@arenahub/ui';

import estilos from './aplicativo.module.css';

/**
 * QR que amplia ao clique (#538): no balcao o aluno aponta a camera para a
 * tela do computador, e o QR de 240 px a meio metro falha na camera de
 * celular mais simples. Ampliado, ocupa a altura da tela.
 *
 * `<dialog>` NATIVO com `showModal()`: foco preso, `Esc` fecha, backdrop e
 * top layer de graca. O SVG vem pronto do servidor (gerado pela lib a partir
 * do link -- nao e HTML de usuario).
 */
export function QrAmpliavel({ svg, link }: { readonly svg: string; readonly link: string }) {
  const [aberto, setAberto] = useState(false);
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  // Fechou pelo `Esc` ou pelo backdrop: o navegador dispara `close` sem passar
  // pelo nosso botao, e o estado precisa acompanhar.
  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    const aoFechar = (): void => setAberto(false);
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, []);

  return (
    <>
      <button
        type="button"
        className={estilos['qrBotao']}
        onClick={() => setAberto(true)}
        aria-label="Ampliar o QR para o aluno ler com a câmera"
        data-testid="ampliar-qr"
      >
        <span
          className={estilos['qr']}
          data-testid="qr-do-instalador"
          role="img"
          aria-label="QR do instalador Android"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <span className={estilos['dicaDoQr']} aria-hidden="true">
          Clique para ampliar
        </span>
      </button>

      <dialog
        ref={dialogo}
        className={estilos['dialogoQr']}
        aria-label="QR ampliado do instalador Android"
        data-testid="dialogo-qr"
        onClick={(evento) => {
          // Clique no fundo (o proprio <dialog>, fora do conteudo) fecha.
          if (evento.target === evento.currentTarget) setAberto(false);
        }}
      >
        <div className={estilos['conteudoDoDialogo']}>
          <p className={estilos['tituloDoDialogo']}>Aponte a câmera do celular</p>
          <span
            className={estilos['qrAmpliado']}
            role="img"
            aria-label="QR ampliado"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          <p className={estilos['linkDoDialogo']}>{link}</p>
          <Button type="button" variant="outline" onClick={() => setAberto(false)} data-testid="fechar-qr">
            Fechar
          </Button>
        </div>
      </dialog>
    </>
  );
}
