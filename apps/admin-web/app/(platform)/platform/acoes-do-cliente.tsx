'use client';

import { useState } from 'react';

import { ConfirmDialog, RowMenu, useToastDeErro } from '@arenahub/ui';

import { alternarStatusDoTenant, type EstadoDoStatus } from '../../actions/platform';

interface Props {
  readonly tenantId: string;
  readonly displayName: string;
  readonly status: string;
}

/**
 * As quatro acoes de um cliente, na propria linha da lista — F68.
 *
 * ANTES ELAS MORAVAM NA TELA DE DETALHE, e chegar a qualquer uma custava abrir
 * o cliente e rolar: "Contratos" e "Faturas" no topo, "Inativar" a um scroll
 * de distancia, no fim de um formulario de quatro blocos. Pedido do PI para
 * trazer as tres para a grid; "Editar" entrou junto porque abrir o cadastro e
 * a quarta coisa que se faz com um cliente, e deixa-la de fora obrigaria a
 * clicar no nome para uma acao e no menu para as outras tres.
 *
 * INATIVAR CONFIRMA COM MOTIVO, e a confirmacao e o `SensitiveAction` que o
 * produto ja usa em revogacao de biometria e estorno: desligar um cliente
 * corta a catraca dele e para a cobranca. Um item de menu que executasse
 * direto seria um acidente a um clique de distancia — e o motivo vai para a
 * auditoria da plataforma, que e onde alguem pergunta por que o cliente parou.
 *
 * REATIVAR NAO PEDE CONFIRMACAO com o mesmo peso, mas pede o motivo pela mesma
 * razao: a API exige, e a auditoria registra os dois sentidos.
 */
export function AcoesDoCliente({ tenantId, displayName, status }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoDoStatus>({});

  useToastDeErro(estado.erro, 'error', 'erro-da-situacao');

  const inativando = status === 'ACTIVE';

  /*
   * SUSPENSO NAO OFERECE O ATO: quem escreve `SUSPENDED` e a inadimplencia
   * (F65), e reativar por aqui esconderia a divida em vez de resolve-la. A
   * acao simplesmente nao aparece — item desabilitado convida ao clique e nao
   * explica nada.
   */
  const suspenso = status === 'SUSPENDED';

  const aplicar = (motivo: string): void => {
    const dados = new FormData();

    dados.set('tenantId', tenantId);
    dados.set('status', inativando ? 'INACTIVE' : 'ACTIVE');
    dados.set('reason', motivo);

    setConfirmando(false);

    /*
      A Server Action e chamada direto em vez de por `useActionState`: o menu
      nao e um `<form>`, e embrulhar quatro itens num formulario so para um
      deles poder enviar criaria um envio por engano nos outros tres.
    */
    void alternarStatusDoTenant({}, dados).then(setEstado);
  };

  return (
    <>
      <RowMenu
        label={`Ações de ${displayName}`}
        testId="acoes-do-cliente"
        itens={[
          {
            id: 'editar',
            label: 'Editar cadastro',
            icon: 'pencil',
            href: `/platform/${tenantId}`,
          },
          {
            id: 'contratos',
            label: 'Contratos',
            icon: 'file-text',
            href: `/platform/${tenantId}/contratos`,
          },
          {
            id: 'faturas',
            label: 'Faturas',
            icon: 'receipt',
            href: `/platform/${tenantId}/faturas`,
          },
          ...(suspenso
            ? []
            : [
                {
                  id: 'situacao',
                  label: inativando ? 'Inativar cliente' : 'Reativar cliente',
                  icon: 'power' as const,
                  onSelect: () => setConfirmando(true),
                  perigo: inativando,
                },
              ]),
        ]}
      />

      <ConfirmDialog
        open={confirmando}
        verb={inativando ? 'Inativar cliente' : 'Reativar cliente'}
        summary={
          inativando
            ? `${displayName} deixa de liberar a catraca e de ser cobrada. Os dados permanecem, e a reativação devolve tudo.`
            : `${displayName} volta à operação normal: catraca liberada e cobrança retomada.`
        }
        onConfirm={aplicar}
        onCancel={() => setConfirmando(false)}
        testId="confirmar-situacao-do-cliente"
      />
    </>
  );
}
