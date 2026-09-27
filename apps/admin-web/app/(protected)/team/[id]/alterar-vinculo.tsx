'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import { atualizarVinculo, type EstadoDoVinculo } from '../../../actions/team';
import { ROTULO_DE_VINCULO } from '../../../../src/team/formatar';
import estilos from './ficha.module.css';

interface Props {
  teamMemberId: string;
  employmentType: string | null;
  employmentStartedAt: string | null;
  version: number;
}

const ESTADO_INICIAL: EstadoDoVinculo = {};

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="salvar-vinculo">
      {pending ? 'Salvando…' : 'Salvar vínculo'}
    </Button>
  );
}

/**
 * Vínculo trabalhista editável -- F81 Task 8, PATCH `/api/v1/team/:id/employment`.
 *
 * Mesmo padrão de `AlterarSituacao` (students/[id]): `useActionState` +
 * `version` viajando junto como trava otimista, erro virando toast (CLAUDE.md:
 * "sempre usar Toast para: Info, Warn e error").
 */
export function AlterarVinculo({
  teamMemberId,
  employmentType,
  employmentStartedAt,
  version,
}: Props) {
  const [estado, acao] = useActionState(atualizarVinculo, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', 'erro-do-vinculo');

  // Mesma razão de `AlterarSituacao`: depois de salvar, a verdade é o que a
  // API devolveu -- o componente segue montado com as props iniciais.
  const tipoVigente = estado.sucesso?.employmentType ?? employmentType;
  const inicioVigente = estado.sucesso?.employmentStartedAt ?? employmentStartedAt;
  const versaoVigente = estado.sucesso?.version ?? version;

  const [tipo, setTipo] = useState(tipoVigente ?? '');

  return (
    <form className={estilos['formularioDeVinculo']} action={acao}>
      {estado.sucesso ? (
        <p role="status" data-testid="vinculo-salvo">
          Vínculo salvo.
        </p>
      ) : null}

      <input type="hidden" name="teamMemberId" value={teamMemberId} />
      <input type="hidden" name="version" value={versaoVigente} />

      <SelectField
        id="employment-type"
        name="employmentType"
        label="Tipo de vínculo"
        value={tipo}
        onChange={(evento) => setTipo(evento.target.value)}
        required
        data-testid="campo-tipo-de-vinculo"
      >
        <option value="">Selecione…</option>
        {Object.entries(ROTULO_DE_VINCULO).map(([valor, rotulo]) => (
          <option key={valor} value={valor}>
            {rotulo}
          </option>
        ))}
      </SelectField>

      <Field
        id="employment-started-at"
        name="employmentStartedAt"
        type="date"
        label="Início do vínculo"
        defaultValue={inicioVigente ?? ''}
        required
        data-testid="campo-inicio-do-vinculo"
      />

      <BotaoDeSalvar />
    </form>
  );
}
