'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { cadastrarUnidade, type EstadoDaUnidade } from '../../../actions/units';

const ESTADO_INICIAL: EstadoDaUnidade = {};

/**
 * Os fusos do Brasil, e só eles.
 *
 * LISTA FECHADA e não campo livre: o ADR-019 faz o bloqueio por
 * inadimplência depender do fuso da unidade, **sem fallback** -- um
 * `America/Sao Paulo` digitado com espaço em vez de sublinhado passaria pela
 * checagem de "campo preenchido" e viraria decisão de acesso errada meses
 * depois. A API valida contra a base IANA e recusaria, mas descobrir isso
 * depois de preencher o cadastro é trabalho jogado fora.
 *
 * São os cinco fusos oficiais do país (UTC−2 a UTC−5). Academia fora do
 * Brasil é caso que não existe hoje; quando existir, a lista cresce aqui e a
 * API já aceita qualquer IANA válido.
 */
const FUSOS = [
  { valor: 'America/Sao_Paulo', rotulo: 'Brasília (UTC−3) — SP, RJ, MG, PR, SC, RS, GO, DF, BA…' },
  { valor: 'America/Manaus', rotulo: 'Amazonas (UTC−4) — AM, MT, MS, RO, RR' },
  { valor: 'America/Rio_Branco', rotulo: 'Acre (UTC−5) — AC e sudoeste do AM' },
  { valor: 'America/Belem', rotulo: 'Pará (UTC−3) — PA, AP, MA, TO' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha (UTC−2)' },
] as const;

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
