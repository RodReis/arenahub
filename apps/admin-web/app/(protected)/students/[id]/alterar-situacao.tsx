'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { alterarSituacao, type EstadoDaSituacao } from '../../../actions/students';
import { ROTULO_DE_SITUACAO, situacoesPossiveis } from '../../../../src/students/formatar';

interface Props {
  studentId: string;
  situacaoAtual: string;
  version: number;
}

const ESTADO_INICIAL: EstadoDaSituacao = {};

function BotaoDeAlteracao() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} data-testid="confirmar-situacao">
      {pending ? 'Alterando…' : 'Alterar situação'}
    </button>
  );
}

/**
 * Mudança de situação do aluno.
 *
 * O select oferece SÓ as transições que a API aceita. Sem isso, a recepção
 * escolheria um destino inválido e receberia um 409 traduzido depois do
 * clique — erro evitável vira erro explicado, que é pior.
 *
 * A `version` viaja junto: é o controle otimista que impede duas pessoas de
 * sobrescreverem a alteração uma da outra sem perceber.
 */
export function AlterarSituacao({ studentId, situacaoAtual, version }: Props) {
  const [estado, acao] = useActionState(alterarSituacao, ESTADO_INICIAL);

  // Depois de uma alteração, a verdade é o que a API devolveu -- não o que
  // veio na carga da página. `revalidatePath` atualiza o Server Component,
  // mas este componente segue montado com as props iniciais: sem estas duas
  // linhas, a SEGUNDA alteração seguida mandaria a versão velha e levaria um
  // "alguém alterou este aluno enquanto você editava" sem ninguém mais
  // envolvido.
  const situacaoVigente = estado.sucesso?.status ?? situacaoAtual;
  const versaoVigente = estado.sucesso?.version ?? version;

  const destinos = situacoesPossiveis(situacaoVigente);

  if (destinos.length === 0) {
    return (
      <p data-testid="situacao-terminal">
        Este cadastro está arquivado. Não há mudança de situação possível.
      </p>
    );
  }

  return (
    <form action={acao}>
      {estado.erro ? (
        <p role="alert" data-testid="erro-da-situacao">
          {estado.erro}
        </p>
      ) : null}

      {estado.sucesso ? (
        <p role="status" data-testid="situacao-alterada">
          Situação alterada para {ROTULO_DE_SITUACAO[estado.sucesso.status] ?? estado.sucesso.status}.
        </p>
      ) : null}

      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="version" value={versaoVigente} />

      <p>
        <label htmlFor="situacao">Nova situação</label>
        {/*
          `key` pela situação vigente: quando ela muda, os destinos possíveis
          mudam junto e o select precisa remontar. Sem a chave, o React
          reaproveita o elemento e mantém selecionada uma opção que acabou de
          sair da lista.
        */}
        <select
          key={situacaoVigente}
          id="situacao"
          name="status"
          defaultValue=""
          required
          data-testid="campo-situacao"
        >
          <option value="">Selecione…</option>
          {destinos.map((destino) => (
            <option key={destino} value={destino}>
              {ROTULO_DE_SITUACAO[destino] ?? destino}
            </option>
          ))}
        </select>
      </p>

      <BotaoDeAlteracao />
    </form>
  );
}
