'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { alterarTenant, type EstadoDaEdicao } from '../../../actions/platform';
import { FUSOS } from '../../../(protected)/units/fusos';

const ESTADO_INICIAL: EstadoDaEdicao = {};

interface Props {
  readonly tenantId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly cnpj: string;
  readonly timezone: string;
  readonly responsavelNome: string;
  readonly responsavelEmail: string;
}

function BotaoDeSalvar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="salvar-academia">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição cadastral da academia — F61.
 *
 * O IDENTIFICADOR NÃO É CAMPO: ele é a chave pública e permanente (a F62 fará
 * login por ele). Aparece como texto para quem precisa lê-lo, e não como
 * entrada que sugere poder ser trocada.
 *
 * `defaultValue` sai do estado quando há erro e do servidor quando não há: a
 * ação devolve o que foi digitado justamente para o formulário não esvaziar em
 * recusa.
 */
export function FormularioDeEdicao(props: Props) {
  const [estado, acao] = useActionState(alterarTenant, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-edicao');

  const valor = (campo: keyof Omit<Props, 'tenantId' | 'slug'>): string =>
    estado.valores?.[campo] ?? props[campo];

  return (
    <form className={estilos['formulario']} action={acao}>
      <input type="hidden" name="tenantId" value={props.tenantId} />

      <p className={estilos['nota']}>
        Identificador: <strong data-testid="slug-da-academia">{props.slug}</strong> — permanente e
        público, não pode ser trocado.
      </p>

      <Field
        id="nome-da-academia"
        name="displayName"
        label="Nome fantasia"
        defaultValue={valor('displayName')}
        maxLength={120}
        required
        data-testid="campo-nome-da-academia"
      />

      <Field
        id="razao-da-academia"
        name="legalName"
        label="Razão social"
        defaultValue={valor('legalName')}
        maxLength={200}
        required
        data-testid="campo-razao-da-academia"
      />

      <div className={estilos['par']}>
        <Field
          id="cnpj-da-academia"
          name="cnpj"
          label="CNPJ"
          defaultValue={valor('cnpj')}
          required
          inputMode="numeric"
          hint="14 dígitos. Pode digitar com pontuação."
          data-testid="campo-cnpj-da-academia"
        />

        <SelectField
          id="fuso-da-academia"
          name="timezone"
          label="Fuso horário"
          defaultValue={valor('timezone')}
          required
          data-testid="campo-fuso-da-academia"
        >
          {FUSOS.map((fuso) => (
            <option key={fuso.valor} value={fuso.valor}>
              {fuso.rotulo}
            </option>
          ))}
        </SelectField>
      </div>

      <fieldset className={estilos['grupo']}>
        <legend>Responsável</legend>

        <div className={estilos['par']}>
          <Field
            id="nome-do-responsavel"
            name="responsavelNome"
            label="Nome"
            defaultValue={valor('responsavelNome')}
            maxLength={120}
            required
            data-testid="campo-nome-do-responsavel"
          />

          <Field
            id="email-do-responsavel"
            name="responsavelEmail"
            label="E-mail"
            type="email"
            defaultValue={valor('responsavelEmail')}
            required
            data-testid="campo-email-do-responsavel"
          />
        </div>
      </fieldset>

      {/*
        A confirmação fica na tela, e não só num toast: quem salvou precisa
        poder conferir depois de olhar para outro lado, e toast some sozinho.
      */}
      {estado.salvo ? (
        <p role="status" data-testid="academia-salva">
          Alterações salvas.
        </p>
      ) : null}

      <div className={estilos['acoes']}>
        <BotaoDeSalvar />
        <Button href="/platform" variant="ghost">
          Voltar
        </Button>
      </div>
    </form>
  );
}
