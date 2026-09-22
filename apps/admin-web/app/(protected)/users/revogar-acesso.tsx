'use client';

import { useState } from 'react';

import { Button, ConfirmDialog, useToastDeErro } from '@arenahub/ui';

import { revogarAcesso, type EstadoDaRevogacao } from '../../actions/usuarios';

interface Props {
  readonly userId: string;
  readonly email: string;
}

/**
 * Tira o acesso de alguém ao painel — F80.
 *
 * AÇÃO DE LINHA e não tela própria: a decisão se toma olhando a lista, e
 * quem revoga já sabe de quem se trata. O que a linha não diz — que o ato não
 * se desfaz — cabe no diálogo.
 *
 * CONFIRMAÇÃO COM MOTIVO, como toda revogação no ArenaHub: o link de volta é
 * convidar de novo, e a justificativa vai para a auditoria da academia.
 *
 * O BOTÃO NÃO SABE SE VAI DAR CERTO, e não tenta adivinhar: revogar o último
 * dono ou a si mesmo é recusado pela API com código próprio, e a frase chega
 * por toast. Esconder o botão exigiria a tela replicar duas regras de domínio
 * — e errar a réplica é pior que mostrar uma recusa clara.
 */
export function RevogarAcesso({ userId, email }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoDaRevogacao>({});

  useToastDeErro(estado.erro, 'error', 'erro-da-revogacao');

  const aplicar = (motivo: string): void => {
    const dados = new FormData();

    dados.set('userId', userId);
    dados.set('reason', motivo);

    setConfirmando(false);
    void revogarAcesso({}, dados).then(setEstado);
  };

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => setConfirmando(true)}
        /*
          O E-MAIL VAI NO RÓTULO ACESSÍVEL, não no visível: a coluna já mostra
          de quem é a linha, e repetir o endereço no botão pouparia zero
          dúvida a quem enxerga. Quem navega por leitor de tela ouve os botões
          fora do contexto da linha, e "Revogar" sozinho não diria de quem.
        */
        aria-label={`Revogar acesso de ${email}`}
        data-testid={`revogar-${userId}`}
      >
        Revogar
      </Button>

      <ConfirmDialog
        open={confirmando}
        verb="Revogar acesso"
        summary={`${email} perde o acesso ao painel imediatamente. Para devolvê-lo, será preciso convidar a pessoa outra vez.`}
        onConfirm={aplicar}
        onCancel={() => setConfirmando(false)}
        testId="dialogo-de-revogacao"
      />
    </>
  );
}
