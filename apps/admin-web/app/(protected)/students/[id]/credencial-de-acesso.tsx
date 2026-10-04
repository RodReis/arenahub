'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import { NumeroEmDestaque } from '@/components/numero-em-destaque';

import estilos from '../../../formulario.module.css';

import { definirCredencial, type EstadoDaCredencial } from '../../../actions/membership';

interface Props {
  studentId: string;
  /** O que o aluno JA tem, por tipo -- lista vazia quando nenhum foi gravado. */
  credenciais: { kind: string; externalId: string }[];
}

const ROTULO_DO_TIPO: Record<string, string> = {
  TURNSTILE_CARD: 'Cartão de catraca',
  FACIAL_ENROLL_ID: 'Identificador facial',
};

const ESTADO_INICIAL: EstadoDaCredencial = {};

function BotaoDeCredencial() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-credencial">
      {pending ? 'Salvando…' : 'Salvar'}
    </Button>
  );
}

/**
 * Vincula o numero que o leitor reconhece para o aluno -- ISSUE #396.
 *
 * CAMINHO MANUAL para alterar o numero. Desde a spec 2026-10-03 o aluno
 * novo ja nasce com identificador facial, mostrado no visor em destaque
 * (`NumeroEmDestaque`) -- e a recepcao o digita no leitor. O identificador
 * facial salvo aqui vai pela rota do numero da catraca, que vincula ao
 * leitor na hora; cartao segue o PUT de credenciais.
 *
 * FECHADO POR PADRAO, mesmo criterio de `AtribuirPlano`: a secao existe
 * para RESPONDER "este aluno tem numero vinculado", nao para editar o
 * tempo todo. Abre quando ha erro a corrigir.
 */
export function CredencialDeAcesso({ studentId, credenciais }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(definirCredencial, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', 'erro-da-credencial');

  const porTipo = new Map(credenciais.map((c) => [c.kind, c.externalId]));
  const facial = porTipo.get('FACIAL_ENROLL_ID');

  if (!aberto && !estado.valores && !estado.sucesso) {
    return (
      <div className={estilos['secao']}>
        {facial === undefined ? null : <NumeroEmDestaque numero={facial} />}
        {credenciais.length === 0 ? (
          <p data-testid="sem-credenciais">Nenhum número de catraca vinculado.</p>
        ) : (
          <ul data-testid="lista-de-credenciais">
            {credenciais.map((c) => (
              <li key={c.kind}>
                {ROTULO_DO_TIPO[c.kind] ?? c.kind}: {c.externalId}
              </li>
            ))}
          </ul>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setAberto(true)}
          data-testid={`abrir-credencial-${studentId}`}
        >
          {credenciais.length === 0 ? 'Vincular número' : 'Alterar número'}
        </Button>
      </div>
    );
  }

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="credencial-definida">
        {estado.sucesso.kind === 'FACIAL_ENROLL_ID' ? (
          <NumeroEmDestaque numero={estado.sucesso.externalId} />
        ) : null}
        <p>
          {ROTULO_DO_TIPO[estado.sucesso.kind] ?? estado.sucesso.kind} vinculado:{' '}
          {estado.sucesso.externalId}
        </p>
        <Button type="button" variant="ghost" onClick={() => setAberto(true)}>
          Vincular outro
        </Button>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <input type="hidden" name="studentId" value={studentId} />

      <SelectField
        id="tipo-de-credencial"
        name="kind"
        label="Tipo"
        data-testid="campo-tipo-de-credencial"
        defaultValue={estado.valores?.kind ?? 'FACIAL_ENROLL_ID'}
        required
      >
        <option value="FACIAL_ENROLL_ID">Identificador facial</option>
        <option value="TURNSTILE_CARD">Cartão de catraca</option>
      </SelectField>

      <Field
        id="numero-da-credencial"
        name="externalId"
        label="Número"
        defaultValue={estado.valores?.externalId ?? porTipo.get('FACIAL_ENROLL_ID') ?? ''}
        required
        maxLength={60}
        data-testid="campo-numero-da-credencial"
        hint="O número exatamente como o leitor o mostra -- zero à esquerda importa."
      />

      <div className={estilos['acoes']}>
        <BotaoDeCredencial />
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
