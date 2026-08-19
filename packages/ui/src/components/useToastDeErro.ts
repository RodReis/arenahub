'use client';

import { useEffect, useRef } from 'react';

import { useToast, type ToastKind } from './Toast.js';

/**
 * Dispara um toast quando a mensagem MUDA -- CLAUDE.md → Convencoes de
 * codigo: "Nao usar Alert para msg, sempre usar Toast para: Info, Warn e
 * error".
 *
 * EXISTE PORQUE ERRO DE `useActionState` NAO E EVENTO. Ele chega como um
 * valor novo no estado, no meio de um render -- nao ha `onError` onde chamar
 * `show`. Sem um efeito, cada tela repetiria o mesmo `useEffect`, e seis
 * copias divergem na primeira correcao.
 *
 * COMPARA A MENSAGEM, NAO SO A PRESENCA. Reenviar o formulario e receber o
 * MESMO erro tem de avisar de novo: a pessoa clicou, algo aconteceu, e uma
 * tela silenciosa parece um botao quebrado. Por isso a referencia guarda o
 * texto e nao um booleano -- e por isso ela e limpa quando o erro some, senao
 * o erro repetido depois de um sucesso passaria batido.
 */
export function useToastDeErro(
  mensagem: string | undefined | null,
  tipo: ToastKind = 'error',
  testId?: string,
): void {
  const { show } = useToast();
  const anterior = useRef<string | null>(null);

  useEffect(() => {
    if (!mensagem) {
      anterior.current = null;
      return;
    }

    if (anterior.current === mensagem) return;

    anterior.current = mensagem;
    show(tipo, mensagem, testId);
  }, [mensagem, tipo, testId, show]);
}
