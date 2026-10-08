'use client';

import { useState } from 'react';

import { Button, Icon, SelectField, formatarDinheiro, useToast } from '@arenahub/ui';

import { venderDiaria } from '../../../actions/membership';
import { SeletorDeForma, type FormaDePagamento } from './billing/seletor-de-forma';
import estilos from './vender-diaria.module.css';

export interface PlanoDeDiaria {
  id: string;
  name: string;
  amountMinor: number;
  currency: string;
}

interface Props {
  studentId: string;
  /** Planos `DIARIA` ativos e com preco vigente. Vazio = ninguem cadastrou. */
  planos: readonly PlanoDeDiaria[];
  /** `true` quando a situacao do aluno impede o acesso (INV-033). */
  impedido: boolean;
  /**
   * Plano SUSPENSO por atraso ainda no prazo: a ficha nao o conta como vigente, mas a API
   * conta (assinatura `PAST_DUE`) e recusaria a venda. Explicar aqui evita a recepcao
   * receber o dinheiro para depois ler o erro.
   */
  emAtraso?: boolean;
}

/**
 * Vender a diaria avulsa -- F86, `SPEC-086`.
 *
 * FECHADA POR PADRAO, como `AtribuirPlano`: vender diaria e ato pontual, e a ficha
 * serve antes de tudo para consultar.
 *
 * O botao se bloqueia enquanto envia. A defesa de verdade contra o clique duplo
 * mora no servidor (trava do aluno + 409), mas a tela nao deve disparar duas
 * requisicoes de proposito.
 *
 * O ACESSO NAO NASCE AQUI: a API cria o direito junto do pagamento. Tocar no botao
 * nunca libera nada por si -- so a resposta `ok` do servidor diz que pagou.
 */
export function VenderDiaria({ studentId, planos, impedido, emAtraso = false }: Props) {
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [planoId, setPlanoId] = useState(planos[0]?.id ?? '');
  const [forma, setForma] = useState<FormaDePagamento>('DINHEIRO');
  const { show } = useToast();

  if (impedido) {
    return (
      <p role="note" data-testid="diaria-impedida">
        A situação do aluno impede o acesso. Regularize antes de vender a diária.
      </p>
    );
  }

  if (emAtraso) {
    return (
      <p role="note" data-testid="diaria-em-atraso">
        Este aluno tem plano suspenso por atraso. Regularize em Financeiro: diária é só para quem
        está sem plano.
      </p>
    );
  }

  if (planos.length === 0) {
    return (
      <p role="note" data-testid="sem-plano-de-diaria">
        Nenhum plano de diária ativo com preço. Cadastre em Planos, com a modalidade “Diária”.
      </p>
    );
  }

  if (!aberto) {
    return (
      <Button type="button" data-testid="abrir-venda-de-diaria" onClick={() => setAberto(true)}>
        <Icon name="banknote" />
        Vender diária
      </Button>
    );
  }

  const plano = planos.find((p) => p.id === planoId) ?? planos[0]!;

  async function confirmar(): Promise<void> {
    if (enviando) return;
    setEnviando(true);

    // `try/finally`: se a action LANCAR (500, rede), sem isto o botao ficava preso
    // em "Vendendo…" e a recepcao nao saberia se o dinheiro entrou.
    try {
      const resultado = await venderDiaria({
        studentId,
        planId: plano.id,
        channel: forma,
        expectedTotalMinor: plano.amountMinor,
      });

      if (resultado.ok) {
        show('info', 'Diária paga. O acesso vale até 23:59.', 'diaria-vendida');
        setAberto(false);
      } else {
        show('warn', resultado.error, 'erro-diaria');
      }
    } catch {
      show(
        'error',
        'Não foi possível vender a diária. Confira a ficha antes de tentar de novo.',
        'erro-diaria',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className={estilos['painel']} data-testid="venda-de-diaria">
      {planos.length > 1 ? (
        <SelectField
          id="diaria-plano"
          name="planId"
          label="Plano de diária"
          value={planoId}
          onChange={(evento) => setPlanoId(evento.target.value)}
          data-testid="diaria-plano"
        >
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatarDinheiro(p.amountMinor, p.currency)}
            </option>
          ))}
        </SelectField>
      ) : null}

      <div className={estilos['resumo']}>
        {planos.length === 1 ? <p className={estilos['plano']}>{plano.name}</p> : null}
        <p className={estilos['valor']} data-testid="diaria-valor">
          {formatarDinheiro(plano.amountMinor, plano.currency)}
        </p>
      </div>

      <SeletorDeForma onEscolher={setForma} escolhida={forma} />

      <div className={estilos['acoes']}>
        <Button
          type="button"
          variant="solid"
          disabled={enviando}
          data-testid="confirmar-diaria"
          onClick={() => void confirmar()}
        >
          {enviando ? 'Recebendo…' : `Receber ${formatarDinheiro(plano.amountMinor, plano.currency)}`}
        </Button>
        <Button type="button" variant="outline" disabled={enviando} onClick={() => setAberto(false)}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
