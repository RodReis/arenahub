'use client';

import { useState } from 'react';

import { Button, Icon } from '@arenahub/ui';

/**
 * Copia o link para a area de transferencia. Falha de clipboard (aba sem foco,
 * navegador sem permissao) nao derruba a tela: o botao so nao muda de rotulo,
 * e o link continua legivel ao lado para copiar na mao.
 */
export function CopiarLink({ url }: { readonly url: string }) {
  const [copiado, setCopiado] = useState(false);

  const copiar = (): void => {
    // Sem HTTPS `navigator.clipboard` nao existe: vira rejeicao tratada.
    void Promise.resolve()
      .then(() => navigator.clipboard.writeText(url))
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      })
      .catch(() => setCopiado(false));
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={copiar}
      data-testid="copiar-link"
      data-copiado={copiado ? 'true' : 'false'}
      aria-live="polite"
    >
      <Icon name={copiado ? 'check-circle' : 'copy'} />
      {copiado ? 'Copiado' : 'Copiar link'}
    </Button>
  );
}
