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
  /** `temFoto`: a ficha tem foto, servida por `/fotos-de-aluno/:id`. */
  student: { id: string; fullName: string; temFoto?: boolean } | null;
  externalUserId: string | null;
}

export interface RespostaDoFeed {
  eventos: EventoDoFeed[];
  /** Preenchido quando a leitura falhou — a tela mostra o que já tinha. */
  erro?: string;
}

/**
 * Quantos eventos o feed traz: o TETO da rota. Era 10 -- pedido do PI,
 * 02/10/2026: a recepção quer ver todo mundo que entrou no dia, com rolagem no
 * cartão. A lista continua SUBSTITUÍDA a cada ciclo (não acumula), então a
 * memória da aba não cresce com o turno.
 */
const LIMITE_DO_FEED = 200;

/**
 * Os últimos acessos da unidade.
 *
 * `limit` sem cursor, substituindo a lista inteira a cada ciclo: o feed
 * mostra "o que está acontecendo agora", não um histórico que cresce. Paginar
 * aqui acumularia memória numa aba que fica aberta o turno inteiro.
 */
export async function lerFeedDeAcessos(
  gymUnitId: string,
  /**
   * Início do dia da unidade (o `desde` do dashboard). Sem ele a rota usa as
   * últimas 24 h, e o feed misturaria a noite anterior com o dia de hoje.
   */
  desde?: string,
): Promise<RespostaDoFeed> {
  if (gymUnitId === '') return { eventos: [], erro: 'Unidade não informada.' };

  const consulta = new URLSearchParams({ gymUnitId, limit: String(LIMITE_DO_FEED) });

  if (desde) consulta.set('from', desde);

  const resposta = await chamarApi<{ eventos: EventoDoFeed[] }>(
    `/api/v1/access-events?${consulta.toString()}`,
  );

  if (!resposta.ok || !resposta.dados) {
    return { eventos: [], erro: 'Não foi possível atualizar o feed.' };
  }

  return { eventos: resposta.dados.eventos };
}
