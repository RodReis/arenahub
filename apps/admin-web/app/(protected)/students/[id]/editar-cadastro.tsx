'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

/*
  Forma de formulário COMPARTILHADA do painel, não um arranjo local: o
  arquivo existe justamente porque cada tela inventando o próprio
  espaçamento foi como o painel chegou a sete alturas de controle
  diferentes.
*/
import estilos from '../../../formulario.module.css';

import { editarAluno, type EstadoDaEdicao } from '../../../actions/students';

/** Contato como a API o devolve. */
interface Contato {
  type: string;
  value: string;
  isPrimary: boolean;
  label: string | null;
  relationship: string | null;
}

interface Endereco {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: string;
}

interface Props {
  readonly studentId: string;
  readonly version: number;
  readonly fullName: string;
  readonly birthDate: string;
  readonly cpf: string | null;
  readonly rg: string | null;
  readonly registeredSex: string | null;
  readonly contacts: readonly Contato[];
  readonly address: Endereco | null;
}

const ESTADO_INICIAL: EstadoDaEdicao = {};

/**
 * Primeiro contato de um tipo, ou string vazia.
 *
 * A API guarda uma LISTA e a ficha edita um campo por tipo. Pegar o primeiro
 * é o que a tela consegue representar hoje; se um aluno tiver dois telefones,
 * o segundo não aparece aqui — e como `contacts` substitui a lista inteira no
 * PATCH, salvar pela ficha o descartaria. Por isso os campos de contato só
 * são reenviados quando o aluno não tem contato repetido do mesmo tipo (ver
 * `contatosSimplesDemais`).
 */
function primeiroContato(contatos: readonly Contato[], tipo: string): string {
  return contatos.find((contato) => contato.type === tipo)?.value ?? '';
}

function contatoDeEmergencia(contatos: readonly Contato[]): Contato | undefined {
  return contatos.find((contato) => contato.type === 'EMERGENCY');
}

/**
 * A ficha só pode reeditar contatos que ela consegue REPRESENTAR.
 *
 * `contacts` substitui a lista inteira. Um aluno com dois telefones tem o
 * segundo invisível nesta tela — e salvar o apagaria em silêncio, que é o
 * tipo de perda de dado que ninguém percebe até precisar ligar. Quando isso
 * acontece, a edição de contatos fica indisponível e a ficha diz por quê,
 * em vez de oferecer um formulário que destrói dado.
 */
function contatosSimplesDemais(contatos: readonly Contato[]): boolean {
  const porTipo = new Map<string, number>();

  for (const contato of contatos) {
    porTipo.set(contato.type, (porTipo.get(contato.type) ?? 0) + 1);
  }

  return [...porTipo.values()].every((quantidade) => quantidade <= 1);
}

function BotaoDeEdicao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-edicao">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição do cadastro — a metade que faltava da F45.
 *
 * A API tem `PATCH /students/:id` desde aquela fatia; nunca houve tela. O
 * lápis da lista aponta para esta ficha prometendo "Editar cadastro", e até
 * agora entregava só leitura.
 *
 * FECHADO POR PADRÃO, e isso é a decisão central deste componente. A ficha é
 * o hub de consulta da recepção — ela abre para responder "essa pessoa
 * entra agora?", não para corrigir CPF. Dezoito campos abertos empurrariam
 * "Acesso agora" e "Direitos de acesso" para baixo da dobra num monitor de
 * 1280px, que é o que o PRODUCT.md chama de densidade sendo a funcionalidade.
 */
export function EditarCadastro({
  studentId,
  version,
  fullName,
  birthDate,
  cpf,
  rg,
  registeredSex,
  contacts,
  address,
}: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(editarAluno, ESTADO_INICIAL);
  useToastDeErro(estado.erro, 'error', `erro-da-edicao-${studentId}`);

  // Mesma razão de `AlterarSituacao`: depois de salvar, a verdade é a versão
  // que a API devolveu. Sem isto, a segunda correção seguida levaria um
  // conflito de versão sem ninguém mais ter tocado no aluno.
  const versaoVigente = estado.sucesso?.version ?? version;

  const podeEditarContatos = contatosSimplesDemais(contacts);
  const emergencia = contatoDeEmergencia(contacts);

  /**
   * O que o campo mostra: o que a recepção digitou (quando o salvamento
   * falhou) ou o que veio da API. Nunca vazio por erro — a regra de
   * acessibilidade do painel é explícita: formulário nunca limpa dado em
   * erro recuperável.
   */
  const valor = (campo: string, daApi: string): string => estado.valores?.[campo] ?? daApi;

  if (!aberto) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-edicao-${studentId}`}
      >
        Editar cadastro
      </Button>
    );
  }

  return (
    <form className={estilos['formularioDeEdicao']} action={acao}>
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="version" value={versaoVigente} />

      {estado.sucesso ? (
        <p role="status" data-testid="cadastro-salvo">
          Cadastro atualizado.
        </p>
      ) : null}

      <fieldset className={estilos['grupo']}>
        <legend>Identificação</legend>

        <Field
          id={`edicao-nome-${studentId}`}
          name="fullName"
          label="Nome completo"
          defaultValue={valor('fullName', fullName)}
          maxLength={160}
          required
          data-testid="campo-edicao-nome"
        />

        <Field
          id={`edicao-nascimento-${studentId}`}
          name="birthDate"
          type="date"
          label="Data de nascimento"
          // `birthDate` chega ISO completo da API; o input aceita só a data.
          defaultValue={valor('birthDate', birthDate.slice(0, 10))}
          required
          data-testid="campo-edicao-nascimento"
        />

        <Field
          id={`edicao-cpf-${studentId}`}
          name="cpf"
          label="CPF"
          defaultValue={valor('cpf', cpf ?? '')}
          hint="Obrigatório — o antifraude da cobrança por cartão recusa sem ele."
          required
          data-testid="campo-edicao-cpf"
        />

        <Field
          id={`edicao-rg-${studentId}`}
          name="rg"
          label="RG"
          defaultValue={valor('rg', rg ?? '')}
          maxLength={40}
          data-testid="campo-edicao-rg"
        />

        <SelectField
          id={`edicao-sexo-${studentId}`}
          name="registeredSex"
          label="Sexo cadastral"
          defaultValue={valor('registeredSex', registeredSex ?? '')}
          data-testid="campo-edicao-sexo"
        >
          <option value="">Não informado</option>
          <option value="FEMALE">Feminino</option>
          <option value="MALE">Masculino</option>
          <option value="NOT_INFORMED">Prefere não informar</option>
        </SelectField>
      </fieldset>

      {podeEditarContatos ? (
        <fieldset className={estilos['grupo']}>
          <legend>Contato</legend>

          <Field
            id={`edicao-telefone-${studentId}`}
            name="telefone"
            label="Telefone"
            defaultValue={valor('telefone', primeiroContato(contacts, 'PHONE'))}
            maxLength={160}
            data-testid="campo-edicao-telefone"
          />

          <Field
            id={`edicao-whatsapp-${studentId}`}
            name="whatsapp"
            label="WhatsApp"
            defaultValue={valor('whatsapp', primeiroContato(contacts, 'WHATSAPP'))}
            maxLength={160}
            data-testid="campo-edicao-whatsapp"
          />

          <Field
            id={`edicao-email-${studentId}`}
            name="email"
            type="email"
            label="E-mail"
            defaultValue={valor('email', primeiroContato(contacts, 'EMAIL'))}
            maxLength={160}
            data-testid="campo-edicao-email"
          />

          <Field
            id={`edicao-emergencia-nome-${studentId}`}
            name="emergenciaNome"
            label="Contato de emergência — nome"
            defaultValue={valor('emergenciaNome', emergencia?.label ?? '')}
            maxLength={160}
            data-testid="campo-edicao-emergencia-nome"
          />

          <Field
            id={`edicao-emergencia-parentesco-${studentId}`}
            name="emergenciaParentesco"
            label="Parentesco"
            defaultValue={valor('emergenciaParentesco', emergencia?.relationship ?? '')}
            maxLength={80}
            data-testid="campo-edicao-emergencia-parentesco"
          />

          <Field
            id={`edicao-emergencia-telefone-${studentId}`}
            name="emergenciaTelefone"
            label="Telefone de emergência"
            defaultValue={valor('emergenciaTelefone', emergencia?.value ?? '')}
            maxLength={160}
            data-testid="campo-edicao-emergencia-telefone"
          />
        </fieldset>
      ) : (
        /*
          Ausência é a informação certa, como no botão de liberar catraca:
          um formulário que apagaria o segundo telefone é pior que nenhum.
        */
        <p role="note" data-testid="contatos-nao-editaveis">
          Este aluno tem mais de um contato do mesmo tipo, e esta ficha edita um por tipo. Salvar
          aqui apagaria os demais, então a edição de contatos está indisponível para ele.
        </p>
      )}

      <fieldset className={estilos['grupo']}>
        <legend>Endereço</legend>

        <Field
          id={`edicao-cep-${studentId}`}
          name="cep"
          label="CEP"
          defaultValue={valor('cep', address?.postalCode ?? '')}
          data-testid="campo-edicao-cep"
        />

        <Field
          id={`edicao-logradouro-${studentId}`}
          name="logradouro"
          label="Logradouro"
          defaultValue={valor('logradouro', address?.street ?? '')}
          maxLength={200}
          data-testid="campo-edicao-logradouro"
        />

        <Field
          id={`edicao-numero-${studentId}`}
          name="numero"
          label="Número"
          defaultValue={valor('numero', address?.number ?? '')}
          maxLength={20}
          data-testid="campo-edicao-numero"
        />

        <Field
          id={`edicao-complemento-${studentId}`}
          name="complemento"
          label="Complemento"
          defaultValue={valor('complemento', address?.complement ?? '')}
          maxLength={120}
          data-testid="campo-edicao-complemento"
        />

        <Field
          id={`edicao-bairro-${studentId}`}
          name="bairro"
          label="Bairro"
          defaultValue={valor('bairro', address?.district ?? '')}
          maxLength={120}
          data-testid="campo-edicao-bairro"
        />

        <Field
          id={`edicao-cidade-${studentId}`}
          name="cidade"
          label="Cidade"
          defaultValue={valor('cidade', address?.city ?? '')}
          maxLength={120}
          data-testid="campo-edicao-cidade"
        />

        <Field
          id={`edicao-uf-${studentId}`}
          name="uf"
          label="UF"
          defaultValue={valor('uf', address?.state ?? '')}
          maxLength={2}
          data-testid="campo-edicao-uf"
        />

        {/*
          O endereço é tudo-ou-nada na API: CEP, logradouro, cidade e UF
          viajam juntos ou não viajam. Endereço pela metade não localiza
          ninguém, e o aviso aqui evita o 400 que diria "CEP inválido" para
          quem só preencheu a rua.
        */}
        <p role="note" className={estilos['nota']}>
          Para gravar o endereço, preencha ao menos CEP, logradouro, cidade e UF.
        </p>
      </fieldset>

      <div className={estilos['acoes']}>
        <BotaoDeEdicao />
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
