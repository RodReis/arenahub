import { useEffect, useRef, useState } from 'react';

export interface StatusDaTentativa {
  readonly paymentAttemptId: string;
  readonly status: string;
  readonly statusDaFatura: string;
  readonly pagoEm: string | null;
}

/** Status que nao mudam mais sozinhos -- o polling para aqui. */
const STATUS_TERMINAIS = new Set(['SUCCEEDED', 'FAILED']);

/**
 * O LACO do QR aberto -- Slice 4.3, `M4-FR-011`.
 *
 * `M4-BR-001`/INV-081: este hook NUNCA confirma pagamento. Ele so RELE
 * `GET /payment-attempts/:id`, que devolve o que o webhook ja escreveu no
 * backend -- exatamente como `kiosk-pagamento.service.ts` faz do lado da
 * API. Retorno de checkout, fechar/reabrir o app ou qualquer evento local
 * nunca muda este estado; so a proxima resposta do servidor muda.
 *
 * Para SOZINHO ao alcancar um status terminal, e sempre ao desmontar --
 * sem isso, uma tela deixada aberta continuaria consultando o backend
 * depois de confirmado, e o desmonte durante uma consulta em voo aplicaria
 * `setState` num componente que ja saiu.
 */
export function usarStatusDaTentativa(
  paymentAttemptId: string,
  consultar: (paymentAttemptId: string) => Promise<StatusDaTentativa>,
  intervaloEmMs: number,
): StatusDaTentativa | null {
  const [status, setStatus] = useState<StatusDaTentativa | null>(null);
  const consultarRef = useRef(consultar);
  consultarRef.current = consultar;

  useEffect(() => {
    // Tentativa NOVA zera o status da anterior -- App Mobile v2: "Tentar de
    // novo" depois de um FAILED mostraria o FAILED velho ate a primeira
    // consulta da tentativa nova voltar.
    setStatus(null);

    // Sem tentativa ainda (id vazio): nao ha o que consultar. A tela de
    // pagamento chama este hook antes de criar o PIX/checkout.
    if (!paymentAttemptId) return;

    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout> | null = null;

    const consultarUmaVez = async () => {
      const resposta = await consultarRef.current(paymentAttemptId);
      if (!vivo) return;

      setStatus(resposta);

      if (!STATUS_TERMINAIS.has(resposta.status)) {
        temporizador = setTimeout(() => void consultarUmaVez(), intervaloEmMs);
      }
    };

    void consultarUmaVez();

    return () => {
      vivo = false;
      if (temporizador) clearTimeout(temporizador);
    };
  }, [paymentAttemptId, intervaloEmMs]);

  return status;
}
