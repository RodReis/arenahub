'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Money, useToastDeErro } from '@arenahub/ui';

import estilos from '../../../formulario.module.css';

import {
  aderirARecorrencia,
  cancelarRecorrencia,
  type EstadoDaRecorrencia,
} from '../../../actions/recorrencia';

interface Props {
  subscriptionId: string;
  /** Modalidade do plano da assinatura vigente. */
  billingMode: 'AVULSO' | 'ASSINATURA';
  /** Já existe recorrência instalada no provedor? */
  ativa: boolean;
  /** Preço vigente do plano, em centavos. Nulo quando o plano perdeu a vigência. */
  amountMinor: number | null;
  currency: string;
  /** Dia do mês do vencimento, da configuração da academia. */
  dueDay: number | null;
}

const ESTADO_INICIAL: EstadoDaRecorrencia = {};

function BotaoDeEnvio({ children, disabled, ...resto }: React.ComponentProps<typeof Button>) {
  const { pending } = useFormStatus();

  /*
   * `disabled` DESESTRUTURADO e combinado com OU -- espalhar `...resto` por
   * cima de `disabled={pending}` deixaria o `disabled` de quem chama VENCER,
   * e o botao reabilitaria no meio do envio. Duplo clique numa adesao chama o
   * provedor duas vezes; a segunda perde no `updateMany` condicionado, mas a
   * defesa da tela nao deveria depender disso.
   */
  return (
    <Button type="submit" disabled={pending || disabled === true} {...resto}>
      {pending ? 'Enviando…' : children}
    </Button>
  );
}

/**
 * Cobrança recorrente do aluno — F56, `SPEC-056` §2.2 e §2.4.
 *
 * A TELA MOSTRA VALOR, DIA E COMO CANCELAR **antes** do aceite. Não é
 * enfeite: sem isso é débito surpresa, que é o que gera contestação. O aceite
 * também é exigido pela API, então a garantia não depende deste componente —
 * mas quem lê a tela precisa saber o que está autorizando.
 */
export function CobrancaRecorrente({
  subscriptionId,
  billingMode,
  ativa,
  amountMinor,
  currency,
  dueDay,
}: Props) {
  const [estadoDaAdesao, aderir] = useActionState(aderirARecorrencia, ESTADO_INICIAL);
  const [estadoDoCancelamento, cancelar] = useActionState(cancelarRecorrencia, ESTADO_INICIAL);
  const [aceitou, setAceitou] = useState(false);

  useToastDeErro(estadoDaAdesao.erro, 'error', 'erro-da-adesao');
  useToastDeErro(estadoDoCancelamento.erro, 'error', 'erro-do-cancelamento-de-recorrencia');
  useToastDeErro(estadoDaAdesao.sucesso?.mensagem, 'info', 'sucesso-da-adesao');
  useToastDeErro(estadoDoCancelamento.sucesso?.mensagem, 'info', 'sucesso-do-cancelamento');

  /*
   * Plano avulso não tem o que ativar. Dizer isso é mais útil que esconder o
   * bloco: quem procura a cobrança automática e não a encontra abre um chamado.
   */
  if (billingMode !== 'ASSINATURA') {
    return (
      <p data-testid="plano-nao-e-assinatura">
        Este plano é <strong>avulso</strong>: o sistema gera a fatura do mês e alguém precisa
        cobrar. Para cobrança automática, atribua um plano na modalidade assinatura.
      </p>
    );
  }

  if (ativa) {
    return (
      <div data-testid="recorrencia-ativa">
        <p>
          <strong>Cobrança recorrente ativa.</strong> A fatura do mês é cobrada no cartão salvo do
          aluno, sem ninguém precisar agir.
        </p>

        {/*
          ENCERRAR É UMA AÇÃO VISÍVEL, não um link escondido (`SPEC-056` §2.4):
          cancelamento com fricção é o que faz o aluno ligar para o banco em vez
          de falar com a academia.
        */}
        <form action={cancelar} className={estilos['formulario']}>
          <input type="hidden" name="subscriptionId" value={subscriptionId} />

          <p role="note">
            Encerrar a cobrança <strong>não tira o acesso já pago</strong>: ele vale até o fim do
            período.
          </p>

          <BotaoDeEnvio variant="outline" data-testid="encerrar-recorrencia">
            Encerrar cobrança recorrente
          </BotaoDeEnvio>
        </form>
      </div>
    );
  }

  /*
   * Sem preço vigente não há valor a mostrar, e mostrar o aceite sem o valor
   * seria pedir autorização em branco. A API também recusa, com
   * `PLAN_WITHOUT_ACTIVE_PRICE`.
   */
  if (amountMinor === null) {
    return (
      <p data-testid="plano-sem-preco-vigente">
        O plano está sem preço vigente. Defina o preço em <a href="/plans">Planos</a> antes de
        ativar a cobrança recorrente.
      </p>
    );
  }

  return (
    <form action={aderir} className={estilos['formulario']} data-testid="form-de-adesao">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />

      {/*
        OS TRÊS FATOS ANTES DO ACEITE: quanto, quando e como sair.
      */}
      <p>
        Serão cobrados <Money cents={amountMinor} currency={currency} /> por mês no cartão salvo
        {dueDay === null ? '' : `, com vencimento no dia ${dueDay}`}. O aluno pode encerrar a
        qualquer momento, aqui mesmo — e o acesso já pago continua valendo até o fim do período.
      </p>

      <label className={estilos['marcador']}>
        <input
          type="checkbox"
          name="aceitouRecorrencia"
          checked={aceitou}
          onChange={(evento) => setAceitou(evento.target.checked)}
          data-testid="aceite-da-recorrencia"
        />
        O aluno autorizou a cobrança automática mensal
      </label>

      {/*
        O botão só habilita com o aceite marcado. A API recusa de qualquer
        forma (`RECURRENCE_CONSENT_REQUIRED`) -- isto aqui é para o operador
        não descobrir a exigência depois de enviar.
      */}
      <BotaoDeEnvio disabled={!aceitou} data-testid="ativar-recorrencia">
        Ativar cobrança recorrente
      </BotaoDeEnvio>
    </form>
  );
}
