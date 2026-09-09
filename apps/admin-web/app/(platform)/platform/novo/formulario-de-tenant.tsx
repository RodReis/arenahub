'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { criarTenant, type EstadoDoTenant } from '../../../actions/platform';
/*
 * A MESMA lista de `/units`, e não uma cópia: o ADR-019 faz o bloqueio por
 * inadimplência depender do fuso sem fallback, e duas listas divergiriam no
 * primeiro fuso novo -- a academia criada aqui não poderia ser editada lá.
 */
import { FUSOS } from '../../../(protected)/units/fusos';

const ESTADO_INICIAL: EstadoDoTenant = {};

function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-academia">
      {pending ? 'Cadastrando…' : 'Cadastrar academia'}
    </Button>
  );
}

/**
 * Cadastro de academia pelo dono do SaaS — F61.
 *
 * O tenant nasce inteiro numa transação da API: academia, primeira unidade,
 * papel OWNER e o convite do responsável. Por isso a tela pede a unidade junto
 * -- academia sem unidade não libera catraca nenhuma, e cadastrar as duas em
 * telas separadas deixaria a primeira metade inútil no meio do caminho.
 */
export function FormularioDeTenant() {
  const [estado, acao] = useActionState(criarTenant, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-academia');

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="academia-criada">
        <p>
          Academia <strong>{estado.sucesso.displayName}</strong> criada.
        </p>

        {/*
          O CONVITE PRECISA APARECER, e nos dois sentidos.

          O Resend responde erro com HTTP 200 -- por isso a API devolve
          `emailEnviado` em vez de deixar a falha sumir. Omitir o caso negativo
          faria a tela afirmar um convite que não saiu, e o dono da academia
          ficaria esperando um e-mail que nunca chega, sem ninguém saber.
        */}
        {estado.sucesso.emailEnviado ? (
          <p data-testid="convite-enviado">
            O convite de acesso foi enviado ao responsável.
          </p>
        ) : (
          <p data-testid="convite-nao-enviado">
            <strong>O convite não foi enviado.</strong> A academia está criada, mas o responsável
            não recebeu o e-mail de acesso — reenvie o convite pela tela de usuários da academia.
          </p>
        )}

        <p>
          <a href="/platform">Ver a lista de academias</a>
        </p>
      </div>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>
      <Field
        id="nome-da-academia"
        name="displayName"
        label="Nome fantasia"
        defaultValue={estado.valores?.displayName ?? ''}
        maxLength={120}
        required
        hint="É o nome que aparece no painel, no totem e no aplicativo do aluno."
        data-testid="campo-nome-da-academia"
      />

      <Field
        id="razao-da-academia"
        name="legalName"
        label="Razão social"
        defaultValue={estado.valores?.legalName ?? ''}
        maxLength={200}
        required
        data-testid="campo-razao-da-academia"
      />

      <div className={estilos['par']}>
        <Field
          id="cnpj-da-academia"
          name="cnpj"
          label="CNPJ"
          defaultValue={estado.valores?.cnpj ?? ''}
          required
          inputMode="numeric"
          hint="14 dígitos. Pode digitar com pontuação."
          data-testid="campo-cnpj-da-academia"
        />

        <Field
          id="slug-da-academia"
          name="slug"
          label="Identificador"
          defaultValue={estado.valores?.slug ?? ''}
          maxLength={48}
          required
          hint="Minúsculas, números e hífen. Ex.: arena-positiva."
          data-testid="campo-slug-da-academia"
        />
      </div>

      {/*
        O IDENTIFICADOR NÃO SE TROCA depois: ele é a chave pública da academia
        e vai aparecer em URL. Avisar aqui é mais barato que descobrir na hora
        de corrigir.
      */}
      <p role="note" className={estilos['nota']}>
        O identificador é permanente e público — escolha algo curto e estável.
      </p>

      <SelectField
        id="fuso-da-academia"
        name="timezone"
        label="Fuso horário"
        defaultValue={estado.valores?.timezone ?? 'America/Sao_Paulo'}
        required
        data-testid="campo-fuso-da-academia"
      >
        {FUSOS.map((fuso) => (
          <option key={fuso.valor} value={fuso.valor}>
            {fuso.rotulo}
          </option>
        ))}
      </SelectField>

      <fieldset className={estilos['grupo']}>
        <legend>Responsável</legend>

        <div className={estilos['par']}>
          <Field
            id="nome-do-responsavel"
            name="responsavelNome"
            label="Nome"
            defaultValue={estado.valores?.responsavelNome ?? ''}
            maxLength={120}
            required
            data-testid="campo-nome-do-responsavel"
          />

          <Field
            id="email-do-responsavel"
            name="responsavelEmail"
            label="E-mail"
            type="email"
            defaultValue={estado.valores?.responsavelEmail ?? ''}
            required
            hint="Recebe o convite para criar a senha e assumir a academia."
            data-testid="campo-email-do-responsavel"
          />
        </div>
      </fieldset>

      <fieldset className={estilos['grupo']}>
        <legend>Primeira unidade</legend>

        <div className={estilos['par']}>
          <Field
            id="codigo-da-unidade"
            name="unidadeCode"
            label="Código"
            defaultValue={estado.valores?.unidadeCode ?? 'MATRIZ'}
            maxLength={32}
            required
            hint="Curto e estável. Ex.: MATRIZ, ZONA-SUL."
            data-testid="campo-codigo-da-unidade"
          />

          <Field
            id="nome-da-unidade"
            name="unidadeName"
            label="Nome"
            defaultValue={estado.valores?.unidadeName ?? 'Matriz'}
            maxLength={120}
            required
            data-testid="campo-nome-da-unidade"
          />
        </div>

        {/*
          A unidade herda o fuso da academia: pedir os dois separados no
          cadastro seria oferecer uma divergência que ninguém quer, e a unidade
          pode ser corrigida depois em `/units`.
        */}
        <p role="note" className={estilos['nota']}>
          A unidade nasce com o fuso escolhido acima. Outras unidades entram depois, pelo painel da
          própria academia.
        </p>
      </fieldset>

      <div className={estilos['acoes']}>
        <BotaoDeCadastro />
        <Button href="/platform" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
