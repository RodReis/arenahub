/**
 * Um token de uso unico so ativa uma vez, dentro da validade.
 *
 * Funcao PURA: sem banco, sem rede, sem `new Date()` interno. O "agora" entra
 * por parametro porque teste que depende do relogio do processo envelhece
 * sozinho -- fica vermelho no CI meses depois, sem ninguem ter tocado no
 * codigo.
 *
 * A ORDEM DAS CHECAGENS E PARTE DA REGRA, e nao detalhe de implementacao: o
 * ESTADO vem antes da VALIDADE. Um token ja consumido responde "ja usado"
 * hoje e daqui a um ano; se a expiracao viesse primeiro, o mesmo token daria
 * duas respostas diferentes conforme o relogio, e quem chama nao conseguiria
 * distinguir "voce ja ativou" de "o convite venceu".
 */

export type StatusDeToken = 'PENDING' | 'CONSUMED' | 'REVOKED';

export interface EntradaDeConsumo {
  readonly status: StatusDeToken;
  readonly expiresAt: Date;
  readonly studentId: string;
}

export type MotivoDeRecusa = 'TOKEN_EXPIRADO' | 'TOKEN_JA_USADO' | 'TOKEN_REVOGADO';

export type ResultadoDeConsumo =
  | { readonly ok: true }
  | { readonly ok: false; readonly motivo: MotivoDeRecusa };

export function consumirTokenDeUsoUnico(
  entrada: EntradaDeConsumo,
  agora: Date,
): ResultadoDeConsumo {
  if (entrada.status === 'CONSUMED') return { ok: false, motivo: 'TOKEN_JA_USADO' };
  if (entrada.status === 'REVOKED') return { ok: false, motivo: 'TOKEN_REVOGADO' };

  // `<=`, nao `<`: no instante EXATO da expiracao o token ja venceu. Com `<`
  // ele valeria por mais um milissegundo -- irrelevante na pratica, mas e a
  // classe de erro de borda que so aparece quando alguem depende dela.
  if (entrada.expiresAt.getTime() <= agora.getTime()) {
    return { ok: false, motivo: 'TOKEN_EXPIRADO' };
  }

  return { ok: true };
}
