'use client';

import { useActionState, useState, useTransition } from 'react';

import {
  Button,
  DataTable,
  EmptyState,
  Identidade,
  TextareaField,
  useToastDeErro,
} from '@arenahub/ui';

import {
  resolverContestacao,
  type ContestacaoDaFila,
  type EstadoDaResolucao,
} from '../../../actions/engagement';
import estilos from './contestacoes.module.css';

const ESTADO_INICIAL: EstadoDaResolucao = {};

/** O que o aluno contestou, em palavra que a secretaria reconhece na tela. */
const ASSUNTO: Record<string, string> = {
  XP: 'Pontos',
  CONQUISTA: 'Conquista',
  CONSISTENCIA: 'Consistência',
  RANKING: 'Placar',
  DESAFIO: 'Desafio',
};

/**
 * Fila de contestações -- F35, Slice 5.6.
 *
 * A tela NÃO corrige pontuação: corrigir é ato do painel de XP, com a própria
 * permissão e o próprio teto. Aqui se registra o desfecho e a resposta que o
 * aluno vai ler. Juntar as duas coisas num botão só esconderia que são dois
 * atos com controles diferentes.
 */
export function FilaDeContestacoes({ itens }: { readonly itens: readonly ContestacaoDaFila[] }) {
  return (
    <DataTable
      caption="Contestações de engajamento aguardando decisão"
      testId="fila-de-contestacoes"
      rows={itens}
      rowKey={(item) => item.id}
      rowTestId={(item) => `contestacao-${item.id}`}
      empty={
        <EmptyState
          testId="fila-de-contestacoes-vazia"
          title="Nenhuma contestação aberta."
          hint="A fila enche conforme alunos discordam do XP, do placar ou de um desafio pelo totem."
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
          key: 'assunto',
          header: 'Sobre',
          role: 'state',
          render: (item) => ASSUNTO[item.subject] ?? item.subject,
        },
        {
          key: 'descricao',
          header: 'O que o aluno escreveu',
          role: 'label',
          render: (item) => item.descricao,
        },
        {
          key: 'decisao',
          header: 'Decisão',
          role: 'actions',
          render: (item) => <LinhaDaFila item={item} />,
        },
      ]}
    />
  );
}

/**
 * A decisão de uma linha.
 *
 * `useActionState` por LINHA, não por tabela: estado compartilhado
 * desabilitaria o botão de todas as linhas ao resolver uma.
 */
function LinhaDaFila({ item }: { readonly item: ContestacaoDaFila }) {
  const [estado, acao] = useActionState(resolverContestacao, ESTADO_INICIAL);
  const [desfecho, setDesfecho] = useState<'CORRIGIDA' | 'IMPROCEDENTE' | null>(null);
  const [resolucao, setResolucao] = useState('');
  const [enviando, iniciarEnvio] = useTransition();

  useToastDeErro(estado.erro, 'error', `erro-da-resolucao-${item.id}`);

  function enviar() {
    if (!desfecho) return;

    const formulario = new FormData();
    formulario.set('id', item.id);
    formulario.set('desfecho', desfecho);
    formulario.set('resolucao', resolucao);

    iniciarEnvio(() => {
      acao(formulario);
    });
  }

  if (desfecho) {
    // A resposta é obrigatória nos DOIS desfechos, e o rótulo muda porque o
    // que a secretaria escreve é diferente: num caso explica o que corrigiu,
    // no outro por que o sistema estava certo.
    const rotulo =
      desfecho === 'CORRIGIDA'
        ? 'O que foi corrigido'
        : 'Por que a pontuação está correta';

    return (
      <div className={estilos['formularioDaDecisao']} data-testid={`decisao-${item.id}`}>
        <TextareaField
          id={`resolucao-${item.id}`}
          label={rotulo}
          value={resolucao}
          disabled={enviando}
          onChange={(evento) => setResolucao(evento.target.value)}
          data-testid={`resolucao-${item.id}`}
        />

        <Button
          type="button"
          variant="solid"
          disabled={resolucao.trim() === '' || enviando}
          onClick={enviar}
          data-testid={`confirmar-${item.id}`}
        >
          {desfecho === 'CORRIGIDA' ? 'Registrar correção' : 'Responder ao aluno'}
        </Button>

        <Button
          type="button"
          variant="ghost"
          disabled={enviando}
          onClick={() => {
            setDesfecho(null);
            setResolucao('');
          }}
        >
          Voltar
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
        onClick={() => setDesfecho('CORRIGIDA')}
        data-testid={`corrigida-${item.id}`}
      >
        Corrigi
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={enviando}
        onClick={() => setDesfecho('IMPROCEDENTE')}
        data-testid={`improcedente-${item.id}`}
      >
        Estava correto
      </Button>
    </>
  );
}
