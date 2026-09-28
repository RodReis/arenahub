'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { useToast } from '@arenahub/ui';

/**
 * Toast de sucesso apos o redirect de `alterarPerfilDeAluno`/`alterarPerfilDeTime`
 * -- F82. A troca de perfil redireciona para a listagem (ver comentario nas
 * actions), entao o sucesso nao pode virar estado de `useActionState": a
 * pagina de destino e outro componente. Viaja via querystring, dispara o
 * toast, e limpa o param -- senao um F5 na lista repetiria a mensagem.
 *
 * A REF EVITA TOAST DUPLICADO -- StrictMode do dev monta/desmonta/remonta o
 * componente, rodando o efeito duas vezes para o MESMO valor de `alterado`.
 * Sem a ref, `show()` empilha dois toasts identicos (mesmo padrao de guarda
 * do `useToastDeErro`, que compara contra o valor anterior).
 */
export function AvisoDePerfilAlterado() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { show } = useToast();
  const jaAvisado = useRef(false);

  const alterado = searchParams.get('perfilAlterado');

  useEffect(() => {
    if (!alterado || jaAvisado.current) return;
    jaAvisado.current = true;

    show('info', 'Perfil alterado.', 'perfil-alterado');

    const proximos = new URLSearchParams(searchParams);
    proximos.delete('perfilAlterado');
    router.replace(proximos.size > 0 ? `${pathname}?${proximos}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só dispara quando `alterado` muda; incluir `searchParams`/`router`/`pathname` reexecutaria a cada replace.
  }, [alterado]);

  return null;
}
