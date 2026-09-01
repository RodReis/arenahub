'use server';

import { chamarApi } from '../../lib/api/server-client';

/**
 * Leituras do dashboard operacional — F57.
 *
 * O feed em tempo real (bloco 3) é a única parte da tela que o navegador
 * busca: os outros seis blocos chegam prontos do Server Component. Ele passa
 * por Server Action, e não por `fetch` direto do navegador, porque a sessão
 * mora num cookie `httpOnly` que o cliente não lê — e não deveria ler.
 *
 * Este arquivo só exporta função `async`: `'use server'` obriga (a guarda
 * `check-use-server` faz valer, porque `pnpm build` não pega isso).
 */

export interface EventoDoFeed {
  id: string;
  occurredAt: string;
  outcome: string;
  reason: string;
  method: string;
  student: { fullName: string } | null;
  externalUserId: string | null;
}

export interface RespostaDoFeed {
  eventos: EventoDoFeed[];
  /** Preenchido quando a leitura falhou — a tela mostra o que já tinha. */
  erro?: string;
}

/** Quantos eventos o feed mostra. Dez cabem sem rolagem no cartão. */
const LIMITE_DO_FEED = 10;

/**
 * Os últimos acessos da unidade.
 *
 * `limit` sem cursor, substituindo a lista inteira a cada ciclo: o feed
 * mostra "o que está acontecendo agora", não um histórico que cresce. Paginar
 * aqui acumularia memória numa aba que fica aberta o turno inteiro.
 */
export async function lerFeedDeAcessos(gymUnitId: string): Promise<RespostaDoFeed> {
  if (gymUnitId === '') return { eventos: [], erro: 'Unidade não informada.' };

  const consulta = new URLSearchParams({ gymUnitId, limit: String(LIMITE_DO_FEED) });

  const resposta = await chamarApi<{ eventos: EventoDoFeed[] }>(
    `/api/v1/access-events?${consulta.toString()}`,
  );

  if (!resposta.ok || !resposta.dados) {
    return { eventos: [], erro: 'Não foi possível atualizar o feed.' };
  }

  return { eventos: resposta.dados.eventos };
}
