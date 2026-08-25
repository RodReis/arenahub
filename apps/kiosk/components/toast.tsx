'use client';

import { useEffect } from 'react';

import { IconeAtencao } from './icones';

/**
 * Toast do totem -- CLAUDE.md → Convencoes: "Nao usar Alert para msg, sempre
 * usar Toast para: Info, Warn e error".
 *
 * Some sozinho depois de alguns segundos porque ninguem dispensa um toast num
 * quiosque: a pessoa que errou o CPF ja esta digitando de novo. Botao de
 * fechar seria mais um alvo de 88 px competindo com o teclado numerico.
 */
const SEGUNDOS_VISIVEL = 6;

export function Toast({
  mensagem,
  aoSumir,
}: {
  readonly mensagem: string | null;
  readonly aoSumir: () => void;
}) {
  useEffect(() => {
    if (mensagem === null) return;

    const temporizador = setTimeout(() => {
      aoSumir();
    }, SEGUNDOS_VISIVEL * 1000);

    return () => {
      clearTimeout(temporizador);
    };
  }, [mensagem, aoSumir]);

  if (mensagem === null) return null;

  return (
    // `role="alert"` INTERROMPE o leitor de tela -- e o comportamento certo
    // aqui: a pessoa esta olhando para o teclado, nao para o rodape da tela.
    <div className="toast" role="alert" data-testid="toast-de-erro">
      <span className="toastIcone">
        <IconeAtencao tamanho={40} />
      </span>
      <span>{mensagem}</span>
    </div>
  );
}
