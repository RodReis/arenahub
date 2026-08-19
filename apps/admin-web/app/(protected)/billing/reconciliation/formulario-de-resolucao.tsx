'use client';

import { useActionState, useState, useTransition } from 'react';

import { Button, SensitiveAction, useToastDeErro } from '@arenahub/ui';

import { resolverDivergencia, type EstadoDaResolucao } from '../../../actions/conciliacao';
import { COMANDOS_DA_TELA, ROTULO_DO_COMANDO } from '../../../../src/billing/conciliacao';
import type { ItemDeConciliacao } from './page';

const ESTADO_INICIAL: EstadoDaResolucao = {};

const RESUMO: Readonly<Record<string, string>> = {
  REPROCESS_PROVIDER_EVENT:
    'O evento guardado do provedor será reprocessado pelo mesmo caminho do webhook. Reprocessar é seguro: se ele já tiver sido aplicado, nada muda.',
  ACCEPT_DOCUMENTED_DIFFERENCE:
    'A divergência será fechada como diferença conhecida e aceita. Nenhum valor é alterado e nenhum lançamento é criado — fica registrado quem decidiu e por quê.',
};

/**
 * Resolução de uma divergência de conciliação — F16, `M2-AC-010`.
 *
 * NÃO HÁ CAMPO DE VALOR, e a ausência é o ponto: o aceite da fatia é
 * "resolve sem editar banco". Um formulário que deixasse corrigir o número
 * seria o `UPDATE` manual de volta, só que com botão e parecendo seguro.
 *
 * A única parte cliente da tela. O resto é Server Component — a fila chega
 * pronta do servidor.
 */
export function FormularioDeResolucao({ item }: { item: ItemDeConciliacao }) {
  const [estado, acao] = useActionState(resolverDivergencia, ESTADO_INICIAL);
  const [comandoAberto, setComandoAberto] = useState<string | null>(null);
  /**
   * `startTransition` porque o `SensitiveAction` confirma por CALLBACK, nao
   * por submit de formulario -- e chamar a acao do `useActionState` fora de
   * uma transicao deixa `isPending` sem atualizar.
   *
   * VISTO NO NAVEGADOR, nao deduzido: o React reclamou em console e a
   * consequencia era real -- o botao nao desabilitava durante o envio, entao
   * dava para clicar duas vezes numa acao que fecha pendencia financeira.
   */
  const [enviando, iniciarEnvio] = useTransition();

  useToastDeErro(estado.erro, 'error', 'erro-da-resolucao');

  const comandos = COMANDOS_DA_TELA[item.status] ?? [];

  if (comandos.length === 0) {
    // Nada a fazer: já conferido ou já resolvido. Um botão desabilitado
    // convidaria ao clique e não explicaria nada.
    return null;
  }

  if (comandoAberto) {
    return (
      <form action={acao}>
        <input type="hidden" name="itemId" value={item.id} />
        <input type="hidden" name="comando" value={comandoAberto} />
        {/*
          `SensitiveAction` pede o motivo e mostra o efeito por extenso antes
          de confirmar — DS-PAINEL.md §8.3, o mesmo padrão do override manual
          e do estorno. O motivo não é burocracia: é o que transforma a
          decisão em registro auditável (`M2-FR-020`).
        */}
        <SensitiveAction
          verb={ROTULO_DO_COMANDO[comandoAberto] ?? 'Resolver'}
          summary={RESUMO[comandoAberto] ?? ''}
          onConfirm={(motivo) => {
            const formulario = new FormData();
            formulario.set('itemId', item.id);
            formulario.set('comando', comandoAberto);
            formulario.set('reason', motivo);
            iniciarEnvio(() => {
              acao(formulario);
            });
            setComandoAberto(null);
          }}
          onCancel={() => setComandoAberto(null)}
        />
      </form>
    );
  }

  return (
    <>
      {comandos.map((comando) => (
        <Button
          key={comando}
          type="button"
          variant="outline"
          // Sem isto, a linha aceita um segundo clique enquanto o primeiro
          // ainda esta em voo -- e o servidor recusa com 409, mas a operadora
          // ve um erro onde na verdade deu certo.
          disabled={enviando}
          onClick={() => setComandoAberto(comando)}
          data-testid={`resolver-${comando}`}
        >
          {ROTULO_DO_COMANDO[comando] ?? comando}
        </Button>
      ))}
    </>
  );
}
