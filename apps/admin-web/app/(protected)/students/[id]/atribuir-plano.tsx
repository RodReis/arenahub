'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, TextareaField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import { atribuirPlano, type EstadoDaAssinatura } from '../../../actions/membership';

interface Plano {
  id: string;
  name: string;
  isActive: boolean;
}

interface Props {
  studentId: string;
  planos: Plano[];
  /** `true` quando a situação do aluno impede o acesso (INV-033). */
  impedido: boolean;
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
function BotaoDeAtribuicao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-atribuicao">
      {pending ? 'Atribuindo…' : 'Atribuir plano'}
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
export function AtribuirPlano({ studentId, planos, impedido }: Props) {
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

  if (estado.sucesso) {
    return (
      <div role="status" data-testid="plano-atribuido">
        <p>
          Plano atribuído. O direito de acesso foi criado e já vale a partir do início da
          vigência.
        </p>
        <p>
          <a href={`/students/${studentId}`}>Atualizar a ficha</a>
        </p>
      </div>
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

      <input type="hidden" name="studentId" value={studentId} />

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

      <BotaoDeAtribuicao />
    </form>
  );
}
