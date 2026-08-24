'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { cadastrarUnidade, type EstadoDaUnidade } from '../../../actions/units';
import { FUSOS } from '../fusos';

const ESTADO_INICIAL: EstadoDaUnidade = {};


function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-unidade">
      {pending ? 'Cadastrando…' : 'Cadastrar unidade'}
    </Button>
  );
}

/**
 * Cadastro de unidade.
 *
 * A API tem `POST /units` desde sempre, com validação de fuso e auditoria; o
 * que nunca existiu foi quem a chamasse. A tela `/units` listava e o próprio
 * estado vazio dela mandava "cadastre a primeira unidade" — sem oferecer
 * caminho nenhum.
 */
export function FormularioDeUnidade() {
  const [estado, acao] = useActionState(cadastrarUnidade, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-unidade');

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="unidade-cadastrada">
        <p>
          Unidade <strong>{estado.sucesso.name}</strong> cadastrada.
        </p>
        <p>
          <a href="/units">Ver a lista de unidades</a>
        </p>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <Field
        id="codigo-da-unidade"
        name="code"
        label="Código"
        defaultValue={estado.valores?.code ?? ''}
        maxLength={32}
        required
        hint="Curto e estável — aparece nas telas e nos relatórios. Ex.: MATRIZ, ZONA-SUL."
        data-testid="campo-codigo-da-unidade"
      />

      <Field
        id="nome-da-unidade"
        name="name"
        label="Nome"
        defaultValue={estado.valores?.name ?? ''}
        maxLength={120}
        required
        data-testid="campo-nome-da-unidade"
      />

      <SelectField
        id="fuso-da-unidade"
        name="timezone"
        label="Fuso horário"
        defaultValue={estado.valores?.timezone ?? 'America/Sao_Paulo'}
        required
        data-testid="campo-fuso-da-unidade"
      >
        {FUSOS.map((fuso) => (
          <option key={fuso.valor} value={fuso.valor}>
            {fuso.rotulo}
          </option>
        ))}
      </SelectField>

      {/*
        O FUSO NÃO É DETALHE: toda data, horário e política de acesso da
        unidade dependem dele, e o bloqueio por inadimplência o usa sem
        fallback (ADR-019). Dizer isso aqui evita a escolha distraída que só
        aparece meses depois, quando alguém for bloqueado no dia errado.
      */}
      <p role="note" className={estilos['nota']}>
        O fuso decide o horário de toda a operação desta unidade — janela de acesso, vencimento e
        bloqueio. Confira antes de salvar.
      </p>

      {/*
        HORÁRIO DE FUNCIONAMENTO fica de fora desta tela, de propósito: quem
        controla o acesso é a janela do PLANO, não o horário declarado aqui.
        A unidade nasce sem ele e nada fica bloqueado.
      */}
      <p role="note" className={estilos['nota']}>
        O horário de funcionamento não é pedido aqui — o acesso é controlado pelas janelas do plano.
      </p>

      <div className={estilos['acoes']}>
        <BotaoDeCadastro />
        <Button href="/units" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
