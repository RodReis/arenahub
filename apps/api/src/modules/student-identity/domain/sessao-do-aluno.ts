/**
 * O que fazer quando chega um refresh token do app do aluno.
 *
 * Funcao PURA -- o "agora" entra por parametro, mesma razao do
 * `token-de-uso-unico.ts`.
 *
 * O MODELO E DE FAMILIA, herdado do `auth/` do painel: cada rotacao cria um
 * elo novo com o mesmo `familyId` e marca o anterior como `ROTATED`. Isso
 * existe para responder o que o token sozinho nao responde -- "este refresh e
 * o atual, ou uma copia de um que ja foi usado?".
 *
 * A ORDEM DAS CHECAGENS E A REGRA, e ela e contraintuitiva: REPLAY vem antes
 * de EXPIRACAO. Um elo ja rotacionado que reaparece e copia, e continua sendo
 * copia depois de vencer. Se a expiracao viesse primeiro, o replay tardio
 * sairia como "expirado" -- recusa banal, sem revogar a familia e sem
 * registrar que houve copia. O atacante paciente so precisaria esperar.
 */

export type StatusDeSessao = 'ACTIVE' | 'ROTATED' | 'REVOKED';

export interface SessaoParaRotacao {
  readonly status: StatusDeSessao;
  readonly expiresAt: Date;
  readonly familyId: string;
}

export type DecisaoDeRotacao =
  | { readonly acao: 'ROTACIONAR' }
  | { readonly acao: 'REVOGAR_FAMILIA'; readonly motivo: 'REFRESH_REPLAY' }
  | { readonly acao: 'RECUSAR'; readonly motivo: 'SESSAO_REVOGADA' | 'SESSAO_EXPIRADA' };

export function decidirRotacao(sessao: SessaoParaRotacao, agora: Date): DecisaoDeRotacao {
  if (sessao.status === 'ROTATED') {
    return { acao: 'REVOGAR_FAMILIA', motivo: 'REFRESH_REPLAY' };
  }

  if (sessao.status === 'REVOKED') {
    return { acao: 'RECUSAR', motivo: 'SESSAO_REVOGADA' };
  }

  if (sessao.expiresAt.getTime() <= agora.getTime()) {
    return { acao: 'RECUSAR', motivo: 'SESSAO_EXPIRADA' };
  }

  return { acao: 'ROTACIONAR' };
}
