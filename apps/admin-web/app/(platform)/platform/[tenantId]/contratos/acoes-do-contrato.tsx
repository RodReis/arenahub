'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, useToastDeErro } from '@arenahub/ui';

import {
  ativarContrato,
  encerrarContrato,
  type EstadoSimplesDaAcao,
} from '../../../../actions/contratos';

const ESTADO_INICIAL: EstadoSimplesDaAcao = {};

interface Props {
  readonly contratoId: string;
  readonly tenantId: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'TERMINATED';
  readonly temDocumento: boolean;
}

function BotaoDeFechar() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="fechar-contrato">
      {pending ? 'Fechando…' : 'Fechar contrato'}
    </Button>
  );
}

function BotaoDeEncerrar() {
  const { pending } = useFormStatus();

  return (
    /*
      `destructive` porque encerrar é irreversível: o contrato não volta de
      `TERMINATED`, e a academia fica sem contrato vigente até alguém fechar
      outro.
    */
    <Button type="submit" variant="destructive" disabled={pending} data-testid="encerrar-contrato">
      {pending ? 'Encerrando…' : 'Encerrar'}
    </Button>
  );
}

/**
 * O que se pode fazer com um contrato, conforme o estado dele.
 *
 * TRÊS ESTADOS, TRÊS CONJUNTOS DE AÇÃO, e nenhum botão desabilitado: mostrar
 * "Fechar contrato" apagado num contrato já vigente convida ao clique e explica
 * nada. O que não cabe no estado simplesmente não aparece.
 *
 * O PDF só existe a partir do fechamento (ADR-052 §8) — em rascunho não há link
 * porque não há documento, e um link quebrado seria pior que a ausência dele.
 */
export function AcoesDoContrato({ contratoId, tenantId, status, temDocumento }: Props) {
  const [estadoDeFechar, acaoDeFechar] = useActionState(ativarContrato, ESTADO_INICIAL);
  const [estadoDeEncerrar, acaoDeEncerrar] = useActionState(encerrarContrato, ESTADO_INICIAL);

  useToastDeErro(estadoDeFechar.erro, 'error', 'erro-ao-fechar');
  useToastDeErro(estadoDeEncerrar.erro, 'error', 'erro-ao-encerrar');

  /** Hoje em `AAAA-MM-DD`, para o encerramento nascer com data preenchida. */
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <>
      {temDocumento ? (
        /*
          LINK e não botão: o PDF é um recurso, e abrir em nova aba, copiar o
          endereço e o anúncio de "link" do leitor de tela não se recuperam com
          JavaScript. O download vem do `Content-Disposition` da API.

          O endereço é o do PAINEL, não o da API: `API_INTERNAL_URL` é visto de
          dentro da rede e o navegador não o alcança. O route handler em
          `/contratos/[id]/documento` repassa a chamada com o cookie de acesso.
        */
        <a
          href={`/contratos/${encodeURIComponent(contratoId)}/documento`}
          data-testid="baixar-contrato"
        >
          Baixar PDF
        </a>
      ) : null}

      {status === 'DRAFT' ? (
        <form action={acaoDeFechar}>
          <input type="hidden" name="id" value={contratoId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <BotaoDeFechar />
        </form>
      ) : null}

      {status === 'ACTIVE' ? (
        <form action={acaoDeEncerrar}>
          <input type="hidden" name="id" value={contratoId} />
          <input type="hidden" name="tenantId" value={tenantId} />
          <input type="hidden" name="encerradoEm" value={hoje} />
          <BotaoDeEncerrar />
        </form>
      ) : null}
    </>
  );
}
