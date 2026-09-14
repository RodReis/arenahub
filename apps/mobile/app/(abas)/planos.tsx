import { useCallback, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';

import { usarRecurso } from '@/api/usar-recurso';
import { useSessao } from '@/auth/sessao';
import {
  usarStatusDaTentativa,
  type StatusDaTentativa,
} from '@/features/financeiro/usar-status-da-tentativa';
import type { DadosDaCobranca, DadosDoFinanceiro, DadosDoPlano } from '@/features/planos/tipos';
import { Planos } from '@/features/planos/planos';
import { Carregando, Tela } from '@/ui/Tela';

const INTERVALO_DO_POLLING_MS = 5_000;

/**
 * Aba Planos -- App Mobile v2, costurando as Slices 4.2 (plano) e 4.3
 * (financeiro) que antes eram tres telas.
 *
 * A COBRANCA EM CURSO MORA AQUI, e nao no componente: e ela que alimenta o
 * polling do `usarStatusDaTentativa`, a UNICA fonte de confirmacao
 * (`M4-BR-001`/INV-081). Guardada mais fundo, trocar PIX por Cartao
 * desmontaria o laco no meio de uma confirmacao.
 */
export default function TelaDePlanos() {
  const { cliente } = useSessao();
  const plano = usarRecurso<DadosDoPlano>('/api/v1/mobile/plano');
  const financeiro = usarRecurso<DadosDoFinanceiro>('/api/v1/mobile/invoices');
  const [cobranca, setCobranca] = useState<DadosDaCobranca | null>(null);

  const consultarStatus = useCallback(
    (paymentAttemptId: string) =>
      cliente.get(`/api/v1/mobile/payment-attempts/${paymentAttemptId}`) as Promise<StatusDaTentativa>,
    [cliente],
  );

  const status = usarStatusDaTentativa(cobranca?.paymentAttemptId ?? '', consultarStatus, INTERVALO_DO_POLLING_MS);

  const atualizar = useCallback(async () => {
    await Promise.all([plano.recarregar(), financeiro.recarregar()]);
  }, [plano, financeiro]);

  if (plano.estado.tipo === 'CARREGANDO' || financeiro.estado.tipo === 'CARREGANDO') {
    return (
      <Tela>
        <Carregando />
      </Tela>
    );
  }

  return (
    <Tela onAtualizar={atualizar} testID="tela-planos">
      <Planos
        plano={plano.estado.tipo === 'PRONTO' ? plano.estado.dados : null}
        financeiro={financeiro.estado.tipo === 'PRONTO' ? financeiro.estado.dados : null}
        cobranca={cobranca}
        statusDaTentativa={cobranca ? status : null}
        pagamento={{
          iniciar: (invoiceId, metodo) =>
            cliente.post(`/api/v1/mobile/invoices/${invoiceId}/${metodo}`) as Promise<DadosDaCobranca>,
          onCopiar: (copiaECola) => void Clipboard.setStringAsync(copiaECola),
          onAbrirCheckout: (url) => void Linking.openURL(url),
        }}
        onCobranca={setCobranca}
        onPagamentoConcluido={() => {
          setCobranca(null);
          void atualizar();
        }}
        testID="planos"
      />
    </Tela>
  );
}
