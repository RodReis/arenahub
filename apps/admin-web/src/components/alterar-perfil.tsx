'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from './alterar-perfil.module.css';

import { ROTULO_DE_PERFIL_COM_ALUNO } from '../team/formatar';

interface EstadoDoPerfil {
  erro?: string;
}

const ESTADO_INICIAL: EstadoDoPerfil = {};

interface Props {
  /** Nome do campo oculto que carrega o id -- `teamMemberId` ou `studentId`. */
  readonly nomeDoCampoDeId: 'teamMemberId' | 'studentId';
  readonly id: string;
  readonly perfilAtual: string;
  readonly version: number;
  readonly acao: (
    estadoAnterior: EstadoDoPerfil,
    formulario: FormData,
  ) => Promise<EstadoDoPerfil>;
}

function BotaoDeTroca() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-perfil">
      {pending ? 'Trocando…' : 'Trocar perfil'}
    </Button>
  );
}

/**
 * Troca de perfil -- F82. Compartilhado entre `team/[id]` e `students/[id]`:
 * mesma escrita do lado da API (`TeamRepository.alterarPerfil`), mesmo select
 * dos dois lados -- só o campo oculto de id e a action mudam.
 *
 * A troca REDIRECIONA no sucesso (a action cuida disso via `redirect()`), e
 * por isso este componente não precisa de estado de sucesso: só o de erro
 * sobrevive para o toast.
 */
export function AlterarPerfil({ nomeDoCampoDeId, id, perfilAtual, version, acao }: Props) {
  const [estado, executar] = useActionState(acao, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', `erro-do-perfil-${id}`);

  return (
    <form className={estilos['formulario']} action={executar}>
      <input type="hidden" name={nomeDoCampoDeId} value={id} />
      <input type="hidden" name="version" value={version} />

      <SelectField
        id={`perfil-${id}`}
        name="profile"
        label="Perfil"
        defaultValue={perfilAtual}
        required
        data-testid="campo-perfil"
      >
        {Object.entries(ROTULO_DE_PERFIL_COM_ALUNO).map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      <BotaoDeTroca />
    </form>
  );
}
