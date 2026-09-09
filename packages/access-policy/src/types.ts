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
 *
 * ## Historico
 *
 * - **1.0.0** (F9) -- versao inicial.
 * - **1.1.0** (F15) -- direito SUSPENSO dentro do periodo passa a devolver
 *   `PAYMENT_OVERDUE` em vez de `NO_ENTITLEMENT`. O desfecho continua `DENY`:
 *   ninguem entra que nao entrava antes, e ninguem deixa de entrar. Mas o
 *   `reason` gravado MUDA, e ele e o campo que responde "por que este aluno
 *   nao passou?" -- reler um evento de 1.0.0 com a regra de hoje diria que a
 *   pessoa estava devendo quando o motor da epoca nao sabia disso.
 *
 *   Minor e nao major porque nenhuma decisao virou de ALLOW para DENY nem o
 *   contrario -- so a explicacao ficou mais especifica.
 * - **2.0.0** (F65, ADR-053) -- gate do CONTRATANTE antes de tudo:
 *   `tenant.gateActive` devolve `TENANT_SUSPENDED`.
 *
 *   MAJOR, ao contrario da 1.1.0: com o gate ativo, entrada que a 1.1.0
 *   concedia vira DENY. E a primeira vez que uma versao do motor MUDA O
 *   DESFECHO, e nao so a explicacao -- reprocessar um evento de 1.1.0 com
 *   esta regra pode negar quem de fato passou. O numero e o que avisa quem
 *   for reconciliar historico de que as duas versoes nao sao intercambiaveis.
 */
export const POLICY_VERSION = '2.0.0';

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
  /** Unico caminho de entrada PELO MOTOR. Sem direito vigente, nao ha ALLOW. */
  ACTIVE_ENTITLEMENT: 'ACTIVE_ENTITLEMENT',
  /**
   * Liberacao financeira excepcional -- F15, Slice 2.4.
   *
   * ⚠️ **O MOTOR TAMBEM NAO PRODUZ ESTE VALOR**, pela mesma razao de
   * `MANUAL_OVERRIDE`: o motor puro nao consulta banco, e a liberacao vive
   * numa tabela. Quem a le e o caso de uso, ANTES de chamar `evaluateAccess`
   * -- e se houver liberacao viva, ele grava direto, sem passar pelo motor.
   *
   * Razao propria e nao `MANUAL_OVERRIDE`: as duas sao liberacoes humanas,
   * mas nascem de decisoes diferentes e prestam contas em relatorios
   * diferentes. "Quantas vezes a recepcao abriu a catraca na mao" e "quantos
   * alunos entraram devendo" sao perguntas distintas, e um rotulo so
   * obrigaria todo relatorio a cruzar com outra tabela para desempatar.
   */
  FINANCIAL_OVERRIDE: 'FINANCIAL_OVERRIDE',
  /**
   * Liberacao manual da recepcao -- ADR-024, emenda de 16/08/2026.
   *
   * ⚠️ **O MOTOR NUNCA PRODUZ ESTE VALOR.** Ele existe no enum porque e
   * gravado no mesmo campo `reason` do `AccessEvent`, e o campo precisa de um
   * rotulo que diga a verdade. Quem o escreve e o caso de uso de override,
   * sempre com `mode: 'OVERRIDE'`.
   *
   * Sem ele, override gravaria `ACTIVE_ENTITLEMENT` -- afirmando um direito
   * ativo que frequentemente NAO existe (a recepcao abre a catraca
   * justamente para quem o motor negou). Todo relatorio de "acessos por
   * direito valido" teria de lembrar de excluir `mode = OVERRIDE`, e quem
   * esquecesse contaria excecao como regra.
   */
  MANUAL_OVERRIDE: 'MANUAL_OVERRIDE',
} as const;

export const DENY_REASON = {
  /** Bloqueio administrativo vigente. Precede tudo (`M1-BR-006`). */
  ADMIN_BLOCK: 'ADMIN_BLOCK',
  /** Aluno `BLOCKED` -- decisao deliberada sobre a pessoa. */
  STUDENT_BLOCKED: 'STUDENT_BLOCKED',
  /** Aluno em qualquer outro estado que nao `ACTIVE`. */
  STUDENT_INACTIVE: 'STUDENT_INACTIVE',
  /**
   * Nenhum direito vigente na data -- inclui expirado e revogado.
   *
   * ⚠️ **Deixou de incluir suspenso por divida na F15.** Suspensao por
   * inadimplencia passou a ter razao propria (`PAYMENT_OVERDUE`) porque as
   * duas situacoes exigem acoes OPOSTAS da recepcao: "nao tem plano" manda
   * vender um; "esta devendo" manda cobrar. Colapsar as duas fazia a tela
   * dizer a mesma coisa nos dois casos.
   */
  NO_ENTITLEMENT: 'NO_ENTITLEMENT',
  /** Ha direito vigente, mas nao vale para ESTA unidade. */
  WRONG_UNIT: 'WRONG_UNIT',
  /** Ha direito vigente para esta unidade, mas fora da janela de horario. */
  OUTSIDE_SCHEDULE: 'OUTSIDE_SCHEDULE',
  /**
   * Direito SUSPENSO por inadimplencia -- F15, Slice 2.4.
   *
   * ACRESCENTADO PELO FIM (ADR-024): o enum e persistido e imutavel, e
   * renomear valor aqui nao e refactor, e reescrever auditoria ja entregue.
   *
   * A REGRA No 1 CONTINUA VALENDO. O motor NAO consulta invoice nem
   * assinatura: ele le `entitlement.status === 'SUSPENDED'`. Quem traduz
   * divida em suspensao e o job de vencimento, do lado do financeiro. Esta
   * razao diz POR QUE o direito esta suspenso, nao cria caminho novo entre
   * pagamento e catraca.
   */
  PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
  /**
   * O TENANT esta suspenso -- F65, ADR-053.
   *
   * ACRESCENTADA PELO FIM, como o ADR-024 exige.
   *
   * NAO E o aluno devendo: e a ACADEMIA devendo ao ArenaHub. Vencida a
   * fatura da plataforma e esgotada a carencia, a catraca nega TODO MUNDO --
   * aluno, funcionario, personal -- e nenhum Entitlement e tocado.
   *
   * A REGRA No 1 CONTINUA DE PE (ADR-053 §3). "Pagamento nao controla
   * acesso" fala do pagamento DO ALUNO; este e o CONTRATANTE, outro ator,
   * outra cadeia. O motor nao passa por `Invoice` nem `Subscription` do
   * aluno para chegar aqui -- ele le um booleano ja derivado.
   *
   * Razao propria e nao reuso de `ADMIN_BLOCK`: as duas negam, mas quem
   * resolve e outra pessoa. `ADMIN_BLOCK` manda a recepcao falar com a
   * gerencia; esta manda o DONO pagar a fatura da plataforma -- e a recepcao
   * nao tem o que fazer com ela.
   */
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
} as const;

export type AllowReason = (typeof ALLOW_REASON)[keyof typeof ALLOW_REASON];
export type DenyReason = (typeof DENY_REASON)[keyof typeof DENY_REASON];

/** Tudo que pode ser gravado no `AccessEvent.reason`. */
export type AccessReason = AllowReason | DenyReason;

/**
 * O que o MOTOR pode devolver -- subconjunto de `AccessReason`.
 *
 * `MANUAL_OVERRIDE` fica de fora: ele e gravado pelo caso de uso de override,
 * nunca calculado a partir de entitlement. A separacao e o que faz o
 * compilador recusar um motor que tente "decidir" uma liberacao manual.
 */
export type EngineAllowReason = typeof ALLOW_REASON.ACTIVE_ENTITLEMENT;

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
  /**
   * Gate do CONTRATANTE -- F65, ADR-053.
   *
   * `gateActive` e DERIVADO, nunca uma coluna propria: na nuvem ele e
   * `tenant.status === 'SUSPENDED'`. Coluna separada seria um segundo lugar
   * onde a verdade mora, e os dois divergiriam no primeiro caminho que
   * escrevesse um sem o outro.
   *
   * Booleano e nao a data da suspensao: o motor e puro e nao tem relogio, e
   * comparar `gateAt <= agora` aqui dentro daria ao Edge com relogio
   * atrasado o poder de reabrir a catraca. Quem resolve a data em booleano e
   * a projecao, na nuvem -- e o snapshot da F10 carregara o `tenantGateAt`
   * para o Edge fazer o mesmo com o proprio relogio.
   */
  readonly tenant: { readonly gateActive: boolean };
  readonly student: { readonly status: StudentStatus };
  readonly entitlements: readonly EntitlementInput[];
  /** Bloqueio administrativo vigente sobre este aluno. */
  readonly adminBlock: { readonly active: boolean };
}

export type AccessPolicyResult =
  | {
      readonly outcome: 'ALLOW';
      readonly reason: EngineAllowReason;
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
