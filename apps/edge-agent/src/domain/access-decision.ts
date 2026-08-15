import { type ExternalEnrollId } from './facial-device.js';

/**
 * Decisao local de acesso -- `M0-FR-005`.
 *
 * FUNCAO PURA: sem banco, sem rede, sem relogio. O "agora" entra por
 * parametro (CLAUDE.md -> Convencoes). Isso nao e preferencia de estilo --
 * e o que torna possivel testar as 24h do dia, a virada de dia e o
 * vencimento no segundo exato, sem relogio falso.
 *
 * ATENCAO AO ESCOPO. Isto e o MVP 0: decisao LOCAL, na bancada, para provar
 * que a cadeia fisica funciona. **Nao e o Access Decision Engine.** O motor
 * de verdade vive na nuvem (ADR-004, regra de arquitetura no 1: a catraca
 * nunca consulta assinatura nem invoice). O que roda aqui e o minimo para
 * a POC medir latencia e passagem -- e vai ser substituido em F9.
 */

/**
 * Razoes de negativa.
 *
 * `M0-FR-005` exige RAZAO ESTAVEL: o codigo nao muda quando o texto muda.
 * Sem isso, correlacionar log de bancada com log de nuvem vira arqueologia,
 * e a lista canonica de razoes de DENY (pendencia do DESIGN-UI §17 item 2)
 * nasceria de string solta.
 *
 * A lista aqui e a MINIMA da POC. A canonica e decisao de produto, aberta.
 */
export const RAZAO_DENY = {
  /** O dispositivo reconheceu alguem que nao esta na nossa base. */
  DESCONHECIDO: 'DESCONHECIDO',
  /** Conhecido, mas sem permissao vigente na bancada. */
  SEM_PERMISSAO: 'SEM_PERMISSAO',
  /** Permissao existe mas venceu. */
  PERMISSAO_EXPIRADA: 'PERMISSAO_EXPIRADA',
  /** Passou de novo dentro da janela anti-repique. */
  REPETICAO: 'REPETICAO',
} as const;

export type RazaoDeny = (typeof RAZAO_DENY)[keyof typeof RAZAO_DENY];

export type DecisaoAcesso =
  | { resultado: 'ALLOW' }
  | { resultado: 'DENY'; razao: RazaoDeny };

/** O que a bancada sabe sobre uma pessoa. Fatia mínima da POC. */
export type PermissaoLocal = {
  externalEnrollId: ExternalEnrollId;
  /** Ausente = sem prazo. Presente = vale ATE este instante, inclusive. */
  validaAte?: Date;
  /** Ultima passagem concedida, para a janela anti-repique. */
  ultimoAllowEm?: Date;
};

/**
 * Janela anti-repique.
 *
 * O leitor facial dispara varios reconhecimentos enquanto a pessoa esta na
 * frente dele. Sem esta janela, uma unica passagem viraria N decisoes ALLOW
 * e N comandos de liberacao -- que e exatamente o que o `M0-AC-003` proibe.
 *
 * 5 s cobre o tempo de alguem atravessar a catraca. Valor de POC: a medicao
 * da bancada pode mostrar que e curto ou longo demais, e ai vira decisao
 * registrada.
 */
export const JANELA_ANTI_REPIQUE_MS = 5_000;

/**
 * Decide. Determinística: a mesma entrada devolve sempre a mesma saida.
 *
 * `permissao` ausente significa que o dispositivo reconheceu alguem que a
 * bancada nao conhece -- caso real quando o software de fabrica cadastrou
 * pessoas que o ArenaHub nao importou.
 */
export function decidirAcesso(
  permissao: PermissaoLocal | null,
  agora: Date,
  janelaMs: number = JANELA_ANTI_REPIQUE_MS,
): DecisaoAcesso {
  if (!permissao) {
    return { resultado: 'DENY', razao: RAZAO_DENY.DESCONHECIDO };
  }

  if (permissao.validaAte !== undefined && agora.getTime() > permissao.validaAte.getTime()) {
    return { resultado: 'DENY', razao: RAZAO_DENY.PERMISSAO_EXPIRADA };
  }

  if (
    permissao.ultimoAllowEm !== undefined &&
    agora.getTime() - permissao.ultimoAllowEm.getTime() < janelaMs
  ) {
    return { resultado: 'DENY', razao: RAZAO_DENY.REPETICAO };
  }

  return { resultado: 'ALLOW' };
}
