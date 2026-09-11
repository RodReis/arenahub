'use client';

import { useState } from 'react';

import { Button, ConfirmDialog, RowMenu, useToastDeErro } from '@arenahub/ui';

import {
  ativarContrato,
  descartarContrato,
  encerrarContrato,
  type EstadoSimplesDaAcao,
} from '../../../../actions/contratos';

interface Props {
  readonly contratoId: string;
  readonly tenantId: string;
  readonly status: 'DRAFT' | 'ACTIVE' | 'TERMINATED';
  readonly temDocumento: boolean;
}

/** Qual ato o menu está confirmando. `null` é diálogo fechado. */
type Confirmacao = 'fechar' | 'encerrar' | 'descartar';

/**
 * O que se pode fazer com um contrato, conforme o estado dele.
 *
 * TRÊS ESTADOS, TRÊS CONJUNTOS DE AÇÃO, e nenhum botão desabilitado: mostrar
 * "Fechar contrato" apagado num contrato já vigente convida ao clique e explica
 * nada. O que não cabe no estado simplesmente não aparece.
 *
 * O PDF só existe a partir do fechamento (ADR-052 §8) — em rascunho não há link
 * porque não há documento, e um link quebrado seria pior que a ausência dele.
 *
 * OS TRÊS ATOS CONFIRMAM na F68, e não é burocracia: fechar gera o PDF e torna
 * o contrato imutável, encerrar deixa o cliente sem contrato vigente, e
 * descartar apaga o rascunho. Nenhum dos três tem desfazer, e todos ficavam a
 * um clique de distância dentro de uma linha de tabela — onde o mouse já está
 * em movimento.
 *
 * RASCUNHO NÃO SE EDITA, e é decisão de desenho, não lacuna: o contrato é
 * documento, e a API não tem `PATCH`. Corrigir um valor é descartar e abrir
 * outro — o formulário abaixo da tabela continua ali, com os campos prontos.
 */
export function AcoesDoContrato({ contratoId, tenantId, status, temDocumento }: Props) {
  const [confirmando, setConfirmando] = useState<Confirmacao | null>(null);
  const [estado, setEstado] = useState<EstadoSimplesDaAcao>({});

  useToastDeErro(estado.erro, 'error', 'erro-do-contrato');

  /** Hoje em `AAAA-MM-DD`, para o encerramento nascer com data preenchida. */
  const hoje = new Date().toISOString().slice(0, 10);

  const executar = (ato: Confirmacao, motivo: string): void => {
    const dados = new FormData();

    dados.set('id', contratoId);
    dados.set('tenantId', tenantId);

    setConfirmando(null);

    if (ato === 'fechar') {
      void ativarContrato({}, dados).then(setEstado);

      return;
    }

    if (ato === 'descartar') {
      /*
        SÓ O DESCARTE LEVA O MOTIVO ADIANTE, e a assimetria é a da API: apagar
        o rascunho não deixa linha nenhuma para trás, então o motivo vai para a
        auditoria porque ela é o único registro que sobra. Fechar e encerrar
        preservam a linha do contrato, com data e PDF — a auditoria deles já
        aponta para um registro que continua existindo.
      */
      dados.set('reason', motivo);
      void descartarContrato({}, dados).then(setEstado);

      return;
    }

    dados.set('encerradoEm', hoje);
    void encerrarContrato({}, dados).then(setEstado);
  };

  const textos: Record<Confirmacao, { verb: string; summary: string }> = {
    fechar: {
      verb: 'Fechar contrato',
      summary:
        'O PDF é gerado agora e os valores ficam congelados. Contrato fechado não volta a rascunho — alterar depois exige encerrar este e abrir outro.',
    },
    encerrar: {
      verb: 'Encerrar contrato',
      summary:
        'O cliente fica sem contrato vigente e deixa de ser faturado até que outro seja fechado. O contrato encerrado permanece no histórico, com o PDF.',
    },
    descartar: {
      verb: 'Descartar rascunho',
      summary:
        'O rascunho é apagado e os valores digitados se perdem. Nada foi cobrado com ele — nenhum PDF foi gerado e nenhuma fatura o referencia.',
    },
  };

  return (
    <>
      {/*
        O PDF FICA FORA DO MENU, como botão visível: é a única ação de LEITURA
        da linha, e é a mais frequente num contrato vigente. Esconder um
        download atrás de dois cliques cobraria o preço do menu justamente de
        quem não corre risco nenhum.

        LINK e não botão: o PDF é um recurso, e abrir em nova aba, copiar o
        endereço e o anúncio de "link" do leitor de tela não se recuperam com
        JavaScript. O download vem do `Content-Disposition` da API.

        O endereço é o do PAINEL, não o da API: `API_INTERNAL_URL` é visto de
        dentro da rede e o navegador não o alcança. O route handler em
        `/contratos/[id]/documento` repassa a chamada com o cookie de acesso.
      */}
      {temDocumento ? (
        <Button
          href={`/contratos/${encodeURIComponent(contratoId)}/documento`}
          variant="ghost"
          data-testid="baixar-contrato"
        >
          Baixar PDF
        </Button>
      ) : null}

      {/*
        CONTRATO ENCERRADO NÃO TEM MENU: o histórico não se altera, e o único
        que resta dele é o PDF, que já está ao lado como botão. Um gatilho que
        abre uma lista inerte é pior que gatilho nenhum — ele promete ação onde
        não há.
      */}
      {status === 'TERMINATED' ? null : (
      <RowMenu
        label="Ações do contrato"
        testId="acoes-do-contrato"
        itens={[
          ...(status === 'DRAFT'
            ? [
                {
                  id: 'fechar',
                  label: 'Fechar contrato',
                  icon: 'check-circle' as const,
                  onSelect: () => setConfirmando('fechar'),
                },
                {
                  id: 'descartar',
                  label: 'Descartar rascunho',
                  icon: 'trash' as const,
                  onSelect: () => setConfirmando('descartar'),
                  perigo: true,
                },
              ]
            : []),
          ...(status === 'ACTIVE'
            ? [
                {
                  id: 'encerrar',
                  label: 'Encerrar contrato',
                  icon: 'calendar-x' as const,
                  onSelect: () => setConfirmando('encerrar'),
                  perigo: true,
                },
              ]
            : []),
        ]}
      />
      )}

      {confirmando !== null ? (
        <ConfirmDialog
          open
          verb={textos[confirmando].verb}
          summary={textos[confirmando].summary}
          onConfirm={(motivo) => executar(confirmando, motivo)}
          onCancel={() => setConfirmando(null)}
          testId="confirmar-acao-do-contrato"
        />
      ) : null}
    </>
  );
}
