'use client';

import { useEffect } from 'react';

import { useToast } from '@arenahub/ui';

/**
 * Toast de SUCESSO de uma Server Action, a cada envio. O `useToastDeErro`
 * compara o TEXTO e calava o segundo "Mensagem salva." seguido -- parecia
 * botao quebrado. Aqui a chave e o proprio estado: o `useActionState` devolve
 * um objeto novo a cada resposta.
 */
export function useToastDeSucesso(
  estado: { readonly sucesso?: string },
  sucesso: string,
  texto: string,
  testId: string,
): void {
  const { show } = useToast();

  useEffect(() => {
    if (estado.sucesso === sucesso) show('info', texto, testId);
  }, [estado, sucesso, texto, testId, show]);
}
