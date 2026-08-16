'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { cadastrarAluno, type EstadoDoCadastro } from '../../../actions/students';

const ESTADO_INICIAL: EstadoDoCadastro = {};

const MOTIVO_DA_DUPLICATA: Record<string, string> = {
  CPF: 'mesmo CPF',
  EMAIL: 'mesmo e-mail',
  PHONE: 'mesmo telefone',
  NAME_AND_BIRTH_DATE: 'mesmo nome e data de nascimento',
};

/**
 * Botão que sabe quando está enviando.
 *
 * `useFormStatus` desabilita durante o envio. O cadastro não tem chave de
 * idempotência no servidor, então o segundo clique criaria um segundo aluno
 * com outra matrícula — e desfazer isso é trabalho manual na recepção.
 */
function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending} data-testid="confirmar-cadastro">
      {pending ? 'Cadastrando…' : 'Cadastrar aluno'}
    </button>
  );
}

/**
 * Cadastro de aluno — `M1-AC-002`, Slice 1.2.
 *
 * A MATRÍCULA NÃO DEPENDE DE CPF (INV-009/011): quem chega sem documento é
 * cadastrado do mesmo jeito e recebe matrícula própria, gerada pelo servidor.
 * Por isso o campo de CPF é opcional e está longe do topo do formulário —
 * posição comunica obrigatoriedade tanto quanto um asterisco.
 */
export function FormularioDeCadastro() {
  const [estado, acao] = useActionState(cadastrarAluno, ESTADO_INICIAL);

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="aluno-cadastrado">
        <h2>Aluno cadastrado</h2>

        <p>
          Matrícula: <strong data-testid="matricula-gerada">{estado.sucesso.membershipNumber}</strong>
        </p>

        {/*
          Duplicata AVISA, não bloqueia (INV-014). Quem decide se são a mesma
          pessoa é a recepção, que tem o contexto que o servidor não tem --
          homônimos existem, e recusar o cadastro deixaria um aluno real de
          fora por causa de uma coincidência de nome.
        */}
        {estado.sucesso.duplicatas.length > 0 ? (
          <section aria-labelledby="titulo-duplicatas" data-testid="possiveis-duplicatas">
            <h3 id="titulo-duplicatas">Cadastros parecidos já existentes</h3>

            <p>
              O aluno foi cadastrado. Confira se não é a mesma pessoa — se for, arquive um dos
              cadastros para não dividir o histórico.
            </p>

            <ul>
              {estado.sucesso.duplicatas.map((duplicata) => (
                <li key={duplicata.studentId} data-testid={`duplicata-${duplicata.studentId}`}>
                  <a href={`/students/${duplicata.studentId}`}>{duplicata.fullName}</a> (
                  {duplicata.membershipNumber}) — {MOTIVO_DA_DUPLICATA[duplicata.motivo] ?? duplicata.motivo}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p>
          <a href={`/students/${estado.sucesso.studentId}`} data-testid="abrir-ficha">
            Abrir a ficha e atribuir um plano
          </a>
        </p>

        <p>
          <a href="/students/novo">Cadastrar outro aluno</a>
        </p>
      </div>
    );
  }

  return (
    <form action={acao}>
      {estado.erro ? (
        <p role="alert" data-testid="erro-do-cadastro">
          {estado.erro}
        </p>
      ) : null}

      <p>
        <label htmlFor="nome">Nome completo</label>
        <input
          id="nome"
          name="fullName"
          defaultValue={estado.valores?.fullName ?? ''}
          maxLength={160}
          required
          data-testid="campo-nome"
        />
      </p>

      <p>
        <label htmlFor="nascimento">Data de nascimento</label>
        <input
          type="date"
          id="nascimento"
          name="birthDate"
          defaultValue={estado.valores?.birthDate ?? ''}
          required
          data-testid="campo-nascimento"
        />
      </p>

      <fieldset>
        <legend>Contato</legend>

        <p>
          <label htmlFor="contatoTipo">Tipo</label>
          <select
            id="contatoTipo"
            name="contatoTipo"
            defaultValue={estado.valores?.contatoTipo ?? 'PHONE'}
          >
            <option value="PHONE">Telefone</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">E-mail</option>
          </select>
        </p>

        <p>
          <label htmlFor="contatoValor">Contato</label>
          <input
            id="contatoValor"
            name="contatoValor"
            defaultValue={estado.valores?.contatoValor ?? ''}
            maxLength={160}
            data-testid="campo-contato"
          />
        </p>
      </fieldset>

      <p>
        <label htmlFor="cpf">CPF (opcional)</label>
        <input
          id="cpf"
          name="cpf"
          defaultValue={estado.valores?.cpf ?? ''}
          inputMode="numeric"
          data-testid="campo-cpf"
        />
        <small>
          A matrícula não depende do CPF. Quem chega sem documento é cadastrado normalmente.
          Quando informado, o CPF é guardado cifrado e nunca aparece por inteiro nas telas.
        </small>
      </p>

      <BotaoDeCadastro />
    </form>
  );
}
