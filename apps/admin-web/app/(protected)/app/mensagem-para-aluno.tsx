'use client';

import { useState } from 'react';

import { Button, Icon } from '@arenahub/ui';

import estilos from './aplicativo.module.css';
import { linkDoWhatsApp } from './mensagem';

/**
 * A mensagem pronta (#538): previa em balao -- exatamente o texto que o aluno
 * recebe --, copiar e abrir no WhatsApp. O contato a recepcao escolhe la; o
 * painel nunca guarda telefone de aluno para isto.
 */
export function MensagemParaAluno({ mensagem }: { readonly mensagem: string }) {
  const [copiada, setCopiada] = useState(false);

  const copiar = (): void => {
    void navigator.clipboard
      .writeText(mensagem)
      .then(() => {
        setCopiada(true);
        setTimeout(() => setCopiada(false), 2000);
      })
      .catch(() => setCopiada(false));
  };

  return (
    <div className={estilos['mensagem']}>
      <div className={estilos['balao']} data-testid="previa-da-mensagem">
        {mensagem}
      </div>

      <div className={estilos['acoesDaMensagem']}>
        <Button
          type="button"
          variant="outline"
          onClick={copiar}
          data-testid="copiar-mensagem"
          data-copiado={copiada ? 'true' : 'false'}
          aria-live="polite"
        >
          <Icon name={copiada ? 'check-circle' : 'copy'} />
          {copiada ? 'Mensagem copiada' : 'Copiar mensagem'}
        </Button>
        <Button
          type="button"
          onClick={() => {
            // Aba nova e sem `opener`: o WhatsApp Web nao ganha acesso ao painel.
            window.open(linkDoWhatsApp(mensagem), '_blank', 'noopener,noreferrer');
          }}
          data-testid="abrir-no-whatsapp"
        >
          <Icon name="message-circle" />
          Abrir no WhatsApp
        </Button>
      </div>
    </div>
  );
}
