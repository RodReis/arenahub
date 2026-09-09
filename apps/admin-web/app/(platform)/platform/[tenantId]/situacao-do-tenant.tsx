'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, EstadoSimples, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { alternarStatusDoTenant, type EstadoDoStatus } from '../../../actions/platform';

const ESTADO_INICIAL: EstadoDoStatus = {};

interface Props {
  readonly tenantId: string;
  readonly status: string;
}

function BotaoDeSituacao({ inativando }: { readonly inativando: boolean }) {
  const { pending } = useFormStatus();

  return (
    /*
      VERBO REAL, nunca "OK" (DS-PAINEL §6): quem lê o botão tem de saber o que
      vai acontecer sem reler o resumo. `destructive` só ao desligar -- reativar
      não destrói nada.
    */
    <Button
      type="submit"
      variant={inativando ? 'destructive' : 'solid'}
      disabled={pending}
      data-testid="confirmar-situacao"
    >
      {pending ? 'Aplicando…' : inativando ? 'Inativar academia' : 'Reativar academia'}
    </Button>
  );
}

/**
 * Situação da academia — ato com motivo auditado, separado da edição cadastral.
 *
 * BLOCO PRÓPRIO e não um campo do formulário de cima: corrigir um CNPJ e
 * desligar uma academia não podem compartilhar o mesmo botão "Salvar". Quem
 * desliga escreve por quê, e o motivo vai para a auditoria da plataforma.
 *
 * `SUSPENDED` NÃO APARECE, e a ausência é o desenho: quem escreve suspensão é
 * a inadimplência (F65). Oferecê-la aqui deixaria o painel fabricar uma
 * suspensão que a cobrança não conhece — e que a cobrança não saberia levantar.
 */
export function SituacaoDoTenant({ tenantId, status }: Props) {
  const [estado, acao] = useActionState(alternarStatusDoTenant, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-situacao');

  const inativando = status === 'ACTIVE';
  const suspensa = status === 'SUSPENDED';

  return (
    <form className={estilos['formulario']} action={acao}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="status" value={inativando ? 'INACTIVE' : 'ACTIVE'} />

      <fieldset className={estilos['grupo']}>
        <legend>Situação</legend>

        <p data-testid="situacao-atual">
          {status === 'ACTIVE' ? <EstadoSimples label="Ativa" tom="positivo" /> : null}
          {suspensa ? <EstadoSimples label="Suspensa" tom="atencao" /> : null}
          {status === 'INACTIVE' ? <EstadoSimples label="Inativa" tom="neutro" /> : null}
        </p>

        {suspensa ? (
          /*
            Suspensão é da cobrança, e reativar aqui esconderia a dívida em vez
            de resolvê-la. Dizer isso é mais útil que um botão que a API
            recusaria.
          */
          <p className={estilos['nota']} data-testid="situacao-da-cobranca">
            Esta academia está suspensa por inadimplência. A situação volta ao normal pela cobrança,
            não por aqui.
          </p>
        ) : (
          <>
            {inativando ? (
              <TextareaField
                id="motivo-da-situacao"
                name="reason"
                label="Motivo da inativação"
                required
                hint="Ao menos 10 caracteres. Vai para a auditoria da plataforma."
                data-testid="campo-motivo-da-situacao"
              />
            ) : null}

            <p className={estilos['nota']}>
              {inativando
                ? 'Academia inativa não libera catraca nem cobra assinatura.'
                : 'Reativar devolve a academia à operação normal.'}
            </p>

            {estado.salvo ? (
              <p role="status" data-testid="situacao-alterada">
                Situação alterada.
              </p>
            ) : null}

            <div className={estilos['acoes']}>
              <BotaoDeSituacao inativando={inativando} />
            </div>
          </>
        )}
      </fieldset>
    </form>
  );
}
