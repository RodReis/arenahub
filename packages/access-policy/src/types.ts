/**
 * Contrato do motor de decisao de acesso.
 *
 * Este arquivo e o ponto onde `ALLOW`/`DENY` deixa de ser conversa e vira
 * campo persistido. O `reason` daqui e gravado no `AccessEvent`, que e
 * IMUTAVEL (`M1-BR-009`) -- entao renomear um rotulo depois nao e refactor,
 * e migracao de dado historico. Por isso a lista fechou em ADR antes de a
 * primeira linha do motor existir.
 */

/**
 * Versao da politica.
 *
 * Vai gravada em cada `AccessEvent`. Sem ela, uma decisao de seis meses atras
 * seria relida com as regras de hoje -- e a pergunta "por que este aluno
 * entrou naquele dia?" nao teria resposta verificavel.
 *
 * Mudanca de comportamento observavel exige numero novo, mesmo que o
 * diff pareca pequeno.
 */
export const POLICY_VERSION = '1.0.0';

export type PolicyVersion = typeof POLICY_VERSION;

/**
 * Estados do aluno. Espelha `StudentStatus` do Prisma de proposito.
 *
 * O motor NAO importa o enum do banco: importar arrastaria o client Prisma
 * para dentro de um package que precisa rodar tambem no Edge, onde nao ha
 * PostgreSQL. A duplicacao e o preco da pureza, e o teste
 * `enum-espelhado.spec.ts` na API impede a divergencia silenciosa.
 */
export type StudentStatus =
  | 'LEAD'
  | 'TRIAL'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'ARCHIVED';

/** Estados do direito de acesso. Espelha `EntitlementStatus` do Prisma. */
export type EntitlementStatus =
  | 'SCHEDULED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'REVOKED'
  | 'EXPIRED';

/**
 * Razoes canonicas -- ADR-024.
 *
 * Fechada em 16/08/2026 pelo PI. Antes disso havia tres listas em conflito:
 * `prd/README.md` §8 dava 3 rotulos, o plano da fatia dava 5, e `M1-FR-020`
 * exigia avaliar 5 dimensoes -- sendo que "unidade errada" nao tinha rotulo
 * em nenhuma das duas.
 *
 * `WRONG_UNIT` existe separado de `NO_ENTITLEMENT` porque as duas negativas
 * pedem acoes OPOSTAS na recepcao: "nao tem plano" manda vender, "tem plano
 * de outra unidade" manda conferir se a pessoa errou de porta. Colapsar as
 * duas economiza um rotulo e custa a acao certa.
 *
 * O MVP 2 acrescenta `PAYMENT_OVERDUE` -- acrescenta, nao renomeia: por isso
 * nenhum rotulo aqui carrega numeracao nem posicao.
 */
export const ALLOW_REASON = {
  /** Unico caminho de entrada. Se nao ha direito vigente, nao ha ALLOW. */
  ACTIVE_ENTITLEMENT: 'ACTIVE_ENTITLEMENT',
} as const;

export const DENY_REASON = {
  /** Bloqueio administrativo vigente. Precede tudo (`M1-BR-006`). */
  ADMIN_BLOCK: 'ADMIN_BLOCK',
  /** Aluno `BLOCKED` -- decisao deliberada sobre a pessoa. */
  STUDENT_BLOCKED: 'STUDENT_BLOCKED',
  /** Aluno em qualquer outro estado que nao `ACTIVE`. */
  STUDENT_INACTIVE: 'STUDENT_INACTIVE',
  /** Nenhum direito vigente na data -- inclui expirado, suspenso e revogado. */
  NO_ENTITLEMENT: 'NO_ENTITLEMENT',
  /** Ha direito vigente, mas nao vale para ESTA unidade. */
  WRONG_UNIT: 'WRONG_UNIT',
  /** Ha direito vigente para esta unidade, mas fora da janela de horario. */
  OUTSIDE_SCHEDULE: 'OUTSIDE_SCHEDULE',
} as const;

export type AllowReason = (typeof ALLOW_REASON)[keyof typeof ALLOW_REASON];
export type DenyReason = (typeof DENY_REASON)[keyof typeof DENY_REASON];
export type AccessReason = AllowReason | DenyReason;

/**
 * Janela de horario ja resolvida.
 *
 * Minuto desde a meia-noite LOCAL da unidade, nao UTC. A conversao acontece
 * antes de chamar o motor, e `AccessPolicyInput.localMinuteOfDay` carrega o
 * resultado -- ver a nota em `evaluate-access.ts` sobre por que o fuso nao
 * entra aqui.
 */
export interface AccessWindow {
  /** 0 = domingo ... 6 = sabado. Mesmo eixo do `Date.getDay()`. */
  readonly dayOfWeek: number;
  /** Inclusivo. */
  readonly startMinute: number;
  /** Inclusivo -- ver `dentroDaJanela` para por que nao e exclusivo. */
  readonly endMinute: number;
}

export interface EntitlementInput {
  readonly id: string;
  readonly status: EntitlementStatus;
  /** ISO-8601. Inclusivo. */
  readonly startsAt: string;
  /** ISO-8601. Inclusivo -- o direito vale ATE este instante. */
  readonly endsAt: string;
  /** Unidades onde este direito vale. Vazio = nenhuma, nunca "todas". */
  readonly unitIds: readonly string[];
  /** Vazio = sem restricao de horario dentro do periodo. */
  readonly windows: readonly AccessWindow[];
}

export interface AccessPolicyInput {
  /** Instante da avaliacao, ISO-8601. Injetado -- o motor nao tem relogio. */
  readonly evaluatedAt: string;
  /** Unidade onde a catraca esta. */
  readonly unitId: string;
  /**
   * Minuto do dia na hora LOCAL da unidade (0..1439) e o dia da semana local.
   *
   * Convertidos FORA: fuso horario exige tzdata, e tzdata e I/O. Um motor que
   * resolve fuso internamente nao roda igual na nuvem e no Edge -- que e
   * exatamente a garantia que a Slice 1.5 vai precisar.
   */
  readonly localDayOfWeek: number;
  readonly localMinuteOfDay: number;
  readonly student: { readonly status: StudentStatus };
  readonly entitlements: readonly EntitlementInput[];
  /** Bloqueio administrativo vigente sobre este aluno. */
  readonly adminBlock: { readonly active: boolean };
}

export type AccessPolicyResult =
  | {
      readonly outcome: 'ALLOW';
      readonly reason: AllowReason;
      /** Qual direito autorizou. Rastreabilidade do `M1-FR-021`. */
      readonly entitlementId: string;
      /** Ate quando esta decisao continua valida, ISO-8601. */
      readonly validUntil: string;
      readonly policyVersion: PolicyVersion;
    }
  | {
      readonly outcome: 'DENY';
      readonly reason: DenyReason;
      readonly policyVersion: PolicyVersion;
    };
