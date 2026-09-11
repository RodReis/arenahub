'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  Button,
  Field,
  MaskedField,
  SectionCard,
  SelectField,
  useToastDeErro,
} from '@arenahub/ui';

import { mascararCnpj } from '@/lib/mascaras';

import estilos from '../../../formulario.module.css';
import proprios from './novo-cliente.module.css';

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
      {pending ? 'Cadastrando…' : 'Cadastrar cliente'}
    </Button>
  );
}

/**
 * Cadastro de cliente pelo dono do SaaS — F61, reformado na F68.
 *
 * O tenant nasce inteiro numa transação da API: cliente, primeira unidade,
 * papel OWNER e o convite do responsável. Por isso a tela pede a unidade junto
 * -- cliente sem unidade não libera catraca nenhuma, e cadastrar as duas em
 * telas separadas deixaria a primeira metade inútil no meio do caminho.
 *
 * TRÊS CARDS E NÃO UM SCROLL, e não um assistente de passos: os nove campos
 * são de três assuntos (a empresa, quem responde por ela, onde ela opera), e
 * dar a cada um a própria moldura resolve o que a rolagem não resolvia --
 * saber onde se está. Passos seriam pior: a transação é única, então dividir a
 * entrada em telas criaria a impressão de que dá para parar no meio, e o
 * primeiro passo não guardaria nada.
 *
 * O FORMULÁRIO É UM SÓ por cima dos três cards. Um `<form>` por card daria
 * três envios para uma criação que é atômica no servidor.
 */
export function FormularioDeTenant() {
  const [estado, acao] = useActionState(criarTenant, ESTADO_INICIAL);

  useToastDeErro(estado.erro, 'error', 'erro-da-academia');

  if (estado.sucesso) {
    return (
      <SectionCard
        title="Cliente cadastrado"
        icon="check-circle"
        summary={`${estado.sucesso.displayName} já existe na plataforma.`}
        testId="academia-criada"
      >
        <div role="status" className={proprios['desfecho']}>
          {/*
            O CONVITE PRECISA APARECER, e nos dois sentidos.

            O Resend responde erro com HTTP 200 -- por isso a API devolve
            `emailEnviado` em vez de deixar a falha sumir. Omitir o caso negativo
            faria a tela afirmar um convite que não saiu, e o responsável
            ficaria esperando um e-mail que nunca chega, sem ninguém saber.
          */}
          {estado.sucesso.emailEnviado ? (
            <p data-testid="convite-enviado">
              O convite de acesso foi enviado ao responsável. Ele cria a própria senha pelo link e
              assume o cliente.
            </p>
          ) : (
            <p className={proprios['alerta']} data-testid="convite-nao-enviado">
              <strong>O convite não foi enviado.</strong> O cliente está criado, mas o responsável
              não recebeu o e-mail de acesso — reenvie o convite pela tela de usuários do cliente.
            </p>
          )}

          <div className={estilos['acoes']}>
            <Button href="/platform">Ver a lista de clientes</Button>
            <Button href="/platform/novo" variant="ghost">
              Cadastrar outro
            </Button>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <form className={proprios['formulario']} action={acao}>
      <SectionCard
        title="Dados do cliente"
        icon="building"
        summary="A empresa que assina o contrato com o ArenaHub."
      >
        <div className={estilos['formulario']}>
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
            <MaskedField
              id="cnpj-da-academia"
              name="cnpj"
              label="CNPJ"
              mascara={mascararCnpj}
              defaultValue={estado.valores?.cnpj ?? ''}
              required
              inputMode="numeric"
              placeholder="00.000.000/0000-00"
              hint="14 dígitos."
              data-testid="campo-cnpj-da-academia"
            />

            <Field
              id="slug-da-academia"
              name="slug"
              label="Identificador"
              defaultValue={estado.valores?.slug ?? ''}
              maxLength={48}
              required
              placeholder="arena-positiva"
              /*
                O IDENTIFICADOR NÃO SE TROCA depois: ele é a chave pública do
                cliente e vai aparecer em URL. O aviso desceu para a dica do
                próprio campo -- como nota solta ele ficava abaixo da linha
                seguinte, longe do campo que governa.
              */
              hint="Permanente e público. Minúsculas, números e hífen."
              data-testid="campo-slug-da-academia"
            />
          </div>

          <SelectField
            id="fuso-da-academia"
            name="timezone"
            label="Fuso horário"
            defaultValue={estado.valores?.timezone ?? 'America/Sao_Paulo'}
            required
            hint="Decide o vencimento da cobrança e o horário da catraca."
            data-testid="campo-fuso-da-academia"
          >
            {FUSOS.map((fuso) => (
              <option key={fuso.valor} value={fuso.valor}>
                {fuso.rotulo}
              </option>
            ))}
          </SelectField>
        </div>
      </SectionCard>

      <SectionCard
        title="Responsável"
        icon="user-check"
        summary="Recebe o convite para criar a senha e assume o cliente como proprietário."
      >
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
            placeholder="nome@exemplo.com.br"
            data-testid="campo-email-do-responsavel"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Primeira unidade"
        icon="dumbbell"
        /*
          A unidade herda o fuso do cliente: pedir os dois separados no cadastro
          seria oferecer uma divergência que ninguém quer, e a unidade pode ser
          corrigida depois em `/units`.
        */
        summary="Nasce com o fuso escolhido acima. As próximas entram pelo painel do próprio cliente."
      >
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
      </SectionCard>

      {/*
        A BARRA DE AÇÕES GRUDA NO PÉ da janela: com três cards a página rola, e
        um botão no fim do documento obriga a rolar de volta depois de conferir
        qualquer campo acima. `position: sticky` mantém o ato ao alcance sem
        tirá-lo do fluxo -- e sem virar barra flutuante que tampa conteúdo.
      */}
      <div className={proprios['rodape']}>
        <BotaoDeCadastro />
        <Button href="/platform" variant="ghost">
          Cancelar
        </Button>
      </div>
    </form>
  );
}
