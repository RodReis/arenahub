'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { atribuirPlano, type EstadoDaAssinatura } from '../../../actions/membership';

interface Plano {
  id: string;
  name: string;
  isActive: boolean;
}

/**
 * A assinatura vigente do aluno, quando existe.
 *
 * `version` é o que torna a TROCA possível: `POST /subscriptions/:id/actions`
 * exige a versão para cancelar, e sem ela o painel só sabia criar — nunca
 * substituir.
 */
export interface AssinaturaVigente {
  subscriptionId: string;
  version: number;
  planName: string | null;
}

interface Props {
  studentId: string;
  planos: Plano[];
  /** `true` quando a situação do aluno impede o acesso (INV-033). */
  impedido: boolean;
  /**
   * Assinatura a substituir. Ausente = o aluno não tem plano, e o formulário
   * é o de atribuição de sempre.
   */
  vigente?: AssinaturaVigente | undefined;
}

const ESTADO_INICIAL: EstadoDaAssinatura = {};

/**
 * Botão que sabe quando está enviando.
 *
 * ESTA É A ÚNICA DEFESA contra o clique duplo aqui: a rota de assinatura não é
 * idempotente (decisão registrada na issue #7, aval do PI em 15/08/2026), e
 * duas submissões criam duas assinaturas e dois direitos de acesso para o
 * mesmo aluno. Quando o `Idempotency-Key` transversal chegar (INV-087), a
 * garantia passa para o servidor, onde deveria estar.
 */
function BotaoDeAtribuicao({ troca }: { troca: boolean }) {
  const { pending } = useFormStatus();

  const rotulo = troca ? 'Alterar plano' : 'Atribuir plano';

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-atribuicao">
      {pending ? (troca ? 'Alterando…' : 'Atribuindo…') : rotulo}
    </Button>
  );
}

/**
 * Atribuição manual de plano — `M1-AC-003`, Slice 1.2.
 *
 * Materializa o ADR-003: o direito de acesso nasce aqui, de uma decisão
 * humana registrada, e não de um pagamento. No MVP 2 a mesma cadeia passa a
 * ser alimentada por invoice — mas a catraca continua lendo só o entitlement.
 */
export function AtribuirPlano({ studentId, planos, impedido, vigente }: Props) {
  /*
   * FECHADO POR PADRÃO (decisão do PI, 24/08/2026).
   *
   * A aba Plano existe para RESPONDER "qual acesso este aluno tem" -- e o
   * formulário de cinco campos ocupava mais espaço que a resposta, empurrando
   * os direitos de acesso para cima da dobra. Trocar plano é ato pontual;
   * consultar é o que se faz o tempo todo.
   *
   * Fica aberto quando há erro de validação: `estado.valores` só existe
   * depois de uma tentativa, e fechar o formulário nesse caso esconderia da
   * recepção o que ela acabou de digitar.
   */
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(atribuirPlano, ESTADO_INICIAL);
  // Erro vira TOAST -- CLAUDE.md: "sempre usar Toast para: Info, Warn e
  // error". O toast ja carrega `role="alert"`, entao o anuncio ao leitor de
  // tela nao regride com a saida do `<p role="alert">`.
  useToastDeErro(estado.erro, 'error', 'erro-da-atribuicao');


  const ativos = planos.filter((plano) => plano.isActive);

  if (ativos.length === 0) {
    return (
      <p data-testid="sem-planos">
        Nenhum plano ativo cadastrado. <a href="/plans">Cadastre um plano</a> antes de atribuir
        acesso.
      </p>
    );
  }

  const troca = vigente !== undefined;

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="plano-atribuido">
        <p>
          {troca
            ? 'Plano alterado. O plano anterior foi encerrado e o novo direito de acesso já vale a partir do início da vigência.'
            : 'Plano atribuído. O direito de acesso foi criado e já vale a partir do início da vigência.'}
        </p>
        <p>
          <a href={`/students/${studentId}`}>Atualizar a ficha</a>
        </p>
      </div>
    );
  }

  /*
   * O formulário só aparece quando pedido -- ou quando a tentativa falhou e
   * há preenchimento a preservar (ver `aberto`, no topo).
   */
  if (!aberto && !estado.valores) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`abrir-plano-${studentId}`}
      >
        {troca ? 'Alterar plano' : 'Atribuir plano'}
      </Button>
    );
  }

  return (
    <form className={estilos['formulario']} action={acao}>

      {/*
        Aviso ANTES da tentativa. A API recusaria com `STUDENT_NOT_ELIGIBLE`,
        mas descobrir isso depois de preencher vigência e motivo é trabalho
        jogado fora.
      */}
      {impedido ? (
        <p role="alert" data-testid="aviso-de-inelegibilidade">
          A situação atual deste aluno impede o acesso. Atribuir um plano agora não vai liberar a
          catraca — regularize a situação primeiro.
        </p>
      ) : null}

      {/*
        TROCA: a recepção precisa saber que o plano atual TERMINA, e não que
        um segundo se soma ao primeiro. Sem esta frase, "alterar plano" e
        "adicionar plano" são a mesma tela para quem opera.
      */}
      {troca ? (
        <p role="note" className={estilos['nota']} data-testid="aviso-de-troca">
          O plano{vigente.planName ? ` ${vigente.planName}` : ''} será encerrado e o direito de
          acesso dele, revogado. O acesso passa a valer pelo plano novo.
        </p>
      ) : null}

      <input type="hidden" name="studentId" value={studentId} />

      {/*
        Id e versão da assinatura a cancelar. Vão JUNTOS -- a Server Action
        recusa um sem o outro, porque cancelar sem versão não é possível e
        seguir sem cancelar deixaria dois planos ativos.
      */}
      {troca ? (
        <>
          <input type="hidden" name="substituiSubscriptionId" value={vigente.subscriptionId} />
          <input type="hidden" name="substituiVersion" value={vigente.version} />
        </>
      ) : null}

      <SelectField
        id="plano"
        name="planId"
        label="Plano"
        defaultValue={estado.valores?.planId ?? ''}
        required
      >
        <option value="">Selecione…</option>
        {ativos.map((plano) => (
          <option key={plano.id} value={plano.id}>
            {plano.name}
          </option>
        ))}
      </SelectField>

      {/* Início e fim lado a lado: são a mesma decisão, lida de uma vez. */}
      <div className={estilos['par']}>
        <Field
          id="inicio"
          name="startsAt"
          label="Início da vigência"
          type="datetime-local"
          defaultValue={estado.valores?.startsAt ?? ''}
          required
          data-testid="campo-inicio"
        />

        <Field
          id="fim"
          name="endsAt"
          label="Fim da vigência"
          type="datetime-local"
          defaultValue={estado.valores?.endsAt ?? ''}
          required
          data-testid="campo-fim"
        />
      </div>

      <TextareaField
        id="motivo-atribuicao"
        name="reason"
        label="Motivo"
        defaultValue={estado.valores?.reason ?? ''}
        rows={2}
        maxLength={300}
        required
        data-testid="campo-motivo-atribuicao"
        hint="Registrado na auditoria. Ex.: “matrícula presencial, pagamento em dinheiro, recibo 481”."
      />

      <div className={estilos['acoes']}>
        <BotaoDeAtribuicao troca={troca} />
        <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
