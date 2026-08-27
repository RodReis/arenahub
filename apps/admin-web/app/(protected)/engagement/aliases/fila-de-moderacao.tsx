'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  AcoesDaLinha,
  Button,
  DataTable,
  EmptyState,
  Identidade,
  SelectField,
  useToastDeErro,
} from '@arenahub/ui';

import { moderarAlias, type EstadoDaModeracao } from '../../../actions/engagement';
import { RAZAO_DE_REJEICAO, rotuloDoSinal } from '../../../../src/engagement/rotulos';
import estilos from './aliases.module.css';

export interface ItemDaFila {
  readonly id: string;
  readonly alunoNome: string;
  readonly alias: string | null;
  readonly status: string;
  readonly screeningSignals: readonly string[];
  readonly rejectionReason: string | null;
  readonly version: number;
}

const ESTADO_INICIAL: EstadoDaModeracao = {};

/**
 * Fila de moderação de apelido público -- F30, Task 9.
 *
 * O MODERADOR SÓ JULGA, NUNCA EDITA: não há campo de texto para o apelido em
 * lugar nenhum desta tela -- ver `LinhaDaFila`. Quem escreveu foi o aluno; o
 * papel do painel é aprovar ou rejeitar com motivo categorizado.
 *
 * Único pedaço cliente do fluxo: a página que busca a fila é Server
 * Component (`page.tsx`), este componente só recebe os itens prontos e
 * cuida da interação de aprovar/rejeitar.
 */
export function FilaDeModeracao({ itens }: { readonly itens: readonly ItemDaFila[] }) {
  return (
    <DataTable
      caption="Apelidos públicos aguardando moderação"
      testId="fila-de-moderacao"
      rows={itens}
      rowKey={(item) => item.id}
      rowTestId={(item) => `item-${item.id}`}
      empty={
        <EmptyState
          testId="fila-de-moderacao-vazia"
          title="Nenhum apelido aguardando moderação."
          hint="A fila enche conforme alunos escolhem um apelido nas preferências públicas."
        />
      }
      columns={[
        {
          key: 'aluno',
          header: 'Aluno',
          role: 'identity',
          render: (item) => <Identidade nome={item.alunoNome} />,
        },
        {
          key: 'apelido',
          header: 'Apelido pedido',
          role: 'label',
          render: (item) => item.alias ?? <em>sem apelido</em>,
        },
        {
          key: 'sinais',
          header: 'Sinais da triagem',
          role: 'support',
          render: (item) =>
            item.screeningSignals.length === 0 ? (
              <span className={estilos['semSinal']}>sem sinal</span>
            ) : (
              <span className={estilos['sinais']}>
                {item.screeningSignals.map((sinal) => (
                  <span key={sinal} className={estilos['sinal']}>
                    {rotuloDoSinal(sinal)}
                  </span>
                ))}
              </span>
            ),
        },
        {
          key: 'decisao',
          header: '',
          role: 'actions',
          render: (item) => (
            <AcoesDaLinha>
              <LinhaDaFila item={item} />
            </AcoesDaLinha>
          ),
        },
      ]}
    />
  );
}

/**
 * A decisão de uma linha -- aprovar direto, ou abrir o motivo para rejeitar.
 *
 * Separado da tabela para isolar o `useActionState`: cada linha tem seu
 * próprio envio em voo, e um único estado compartilhado faria o clique numa
 * linha desabilitar o botão de todas as outras.
 */
function LinhaDaFila({ item }: { readonly item: ItemDaFila }) {
  const [estado, acao] = useActionState(moderarAlias, ESTADO_INICIAL);
  const [rejeitando, setRejeitando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, iniciarEnvio] = useTransition();

  useToastDeErro(estado.erro, 'error', `erro-de-moderacao-${item.id}`);

  function enviar(decisao: 'APPROVED' | 'REJECTED') {
    const formulario = new FormData();
    formulario.set('perfilId', item.id);
    formulario.set('decisao', decisao);
    if (decisao === 'REJECTED') formulario.set('rejectionReason', motivo);

    iniciarEnvio(() => {
      acao(formulario);
    });
  }

  if (rejeitando) {
    return (
      <div className={estilos['formularioDeRejeicao']} data-testid={`rejeicao-${item.id}`}>
        <SelectField
          id={`motivo-${item.id}`}
          label="Motivo"
          value={motivo}
          disabled={enviando}
          onChange={(evento) => setMotivo(evento.target.value)}
        >
          <option value="">Selecione…</option>
          {RAZAO_DE_REJEICAO.map((razao) => (
            <option key={razao.value} value={razao.value}>
              {razao.label}
            </option>
          ))}
        </SelectField>

        <Button
          type="button"
          variant="destructive"
          disabled={motivo === '' || enviando}
          onClick={() => enviar('REJECTED')}
          data-testid={`confirmar-rejeicao-${item.id}`}
        >
          Confirmar
        </Button>

        <Button
          type="button"
          variant="ghost"
          disabled={enviando}
          onClick={() => {
            setRejeitando(false);
            setMotivo('');
          }}
        >
          Cancelar
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="solid"
        disabled={enviando}
        onClick={() => enviar('APPROVED')}
        data-testid={`aprovar-${item.id}`}
      >
        Aprovar
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={enviando}
        onClick={() => setRejeitando(true)}
        data-testid={`rejeitar-${item.id}`}
      >
        Rejeitar
      </Button>
    </>
  );
}
