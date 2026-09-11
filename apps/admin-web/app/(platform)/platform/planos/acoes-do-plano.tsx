'use client';

import { useState } from 'react';

import { ConfirmDialog, RowMenu, useToastDeErro } from '@arenahub/ui';

import { arquivarPlano, type EstadoSimplesDaAcao } from '../../../actions/contratos';

interface Props {
  readonly planoId: string;
  readonly nome: string;
  readonly status: 'ACTIVE' | 'ARCHIVED';
  /** Abre o formulário abaixo da tabela já preenchido com este plano. */
  readonly onEditar: () => void;
}

/**
 * Editar e arquivar um plano do catálogo — F68.
 *
 * AS DUAS ROTAS JÁ EXISTIAM na API desde a F63 (`PATCH plans/:id` e
 * `POST plans/:id/archive`) e a tela nunca as ofereceu: o catálogo só sabia
 * cadastrar. Corrigir o nome de um plano ou tirá-lo de circulação exigia
 * chamar a API à mão.
 *
 * EDITAR NÃO É TELA NOVA: o formulário de cadastro abaixo da tabela vira o de
 * edição, preenchido com o plano escolhido. São os mesmos quatro campos e a
 * mesma Server Action (ela já aceitava `id`), e uma segunda tela duplicaria a
 * regra de "qual preço aparece em qual modelo".
 *
 * ARQUIVAR CONFIRMA, e o resumo diz o que ninguém adivinharia da palavra: o
 * plano arquivado some da escolha de contrato NOVO, e os contratos já
 * fechados com ele continuam valendo — eles guardam cópia dos valores, não
 * referência ao catálogo (ADR-052 §8).
 */
export function AcoesDoPlano({ planoId, nome, status, onEditar }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoSimplesDaAcao>({});

  useToastDeErro(estado.erro, 'error', 'erro-do-plano');

  const arquivar = (): void => {
    const dados = new FormData();

    dados.set('id', planoId);

    setConfirmando(false);
    void arquivarPlano({}, dados).then(setEstado);
  };

  /*
   * PLANO ARQUIVADO não tem ato: a API não desarquiva, e alterar o preço de um
   * plano fora de circulação não muda nada em lugar nenhum. Menu inerte seria
   * um gatilho que promete ação onde não há.
   */
  if (status === 'ARCHIVED') return null;

  return (
    <>
      <RowMenu
        label={`Ações do plano ${nome}`}
        testId="acoes-do-plano"
        itens={[
          {
            id: 'editar',
            label: 'Editar plano',
            icon: 'pencil',
            onSelect: onEditar,
          },
          {
            id: 'arquivar',
            label: 'Arquivar plano',
            icon: 'archive',
            onSelect: () => setConfirmando(true),
            perigo: true,
          },
        ]}
      />

      <ConfirmDialog
        open={confirmando}
        verb="Arquivar plano"
        summary={`${nome} deixa de aparecer na escolha de contrato novo. Os contratos já fechados com ele continuam valendo — eles guardam cópia dos valores acordados.`}
        onConfirm={arquivar}
        onCancel={() => setConfirmando(false)}
        testId="confirmar-arquivamento"
      />
    </>
  );
}
