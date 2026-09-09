import {
  ALLOW_REASON,
  DENY_REASON,
  POLICY_VERSION,
  type AccessPolicyInput,
  type AccessPolicyResult,
  type AccessWindow,
  type EntitlementInput,
} from './types.js';

/**
 * O Access Decision Engine -- `M1-FR-020`, `M1-FR-021`.
 *
 * FUNCAO PURA. Sem banco, sem rede, sem relogio, sem locale. O "agora" entra
 * por `evaluatedAt` e o fuso ja vem resolvido em `localDayOfWeek` /
 * `localMinuteOfDay`.
 *
 * Isso nao e preferencia de estilo. E o que permite a Slice 1.5 rodar ESTE
 * MESMO codigo no Edge, offline, e obter bit a bit a mesma decisao que a
 * nuvem obteria. Um motor que le relogio global decide diferente em duas
 * maquinas com NTP desalinhado, e a reconciliacao vira ficcao.
 *
 * REGRA DE ARQUITETURA no 1 (CLAUDE.md): este motor NUNCA olha assinatura
 * nem invoice. A cadeia e `Pagamento -> Invoice -> Subscription ->
 * Entitlement -> aqui`. O que chega e o entitlement ja derivado; se a
 * assinatura vencer, quem muda o entitlement e outro caso de uso, nao este.
 */
export function evaluateAccess(input: AccessPolicyInput): AccessPolicyResult {
  // `M1-BR-006`: politica mais restritiva prevalece. A ordem abaixo E essa
  // regra -- cada `return` antecipado e uma restricao que nenhuma checagem
  // posterior pode afrouxar.

  // 0. GATE DO CONTRATANTE -- F65, ADR-053. Precede ate o bloqueio
  //    administrativo, e a ordem e a regra: o gate nega a academia inteira,
  //    entao perguntar antes por esta pessoa em particular seria responder
  //    "o aluno X esta bloqueado" quando a resposta verdadeira e "a
  //    academia esta suspensa". A recepcao agiria sobre o aluno errado.
  //
  //    NAO E a regra no 1 caindo. Ela fala do pagamento DO ALUNO, e a
  //    cadeia dele continua intacta: `gateActive` nao passa por `Invoice`
  //    nem `Subscription` de ninguem, e nenhum `Entitlement` e tocado aqui
  //    nem em lugar nenhum (ADR-053 §2). Regularizou, o gate cai e todo
  //    mundo volta a entrar sem ser recadastrado.
  if (input.tenant.gateActive) {
    return { outcome: 'DENY', reason: DENY_REASON.TENANT_SUSPENDED, policyVersion: POLICY_VERSION };
  }

  // 1. Bloqueio administrativo. Precede ate o estado do aluno: e a alavanca
  //    que a operacao puxa quando precisa barrar ALGUEM AGORA, sem esperar
  //    processo de cadastro.
  if (input.adminBlock.active) {
    return { outcome: 'DENY', reason: DENY_REASON.ADMIN_BLOCK, policyVersion: POLICY_VERSION };
  }

  // 2. `BLOCKED` tem rotulo proprio porque e decisao deliberada sobre a
  //    pessoa -- diferente de `ARCHIVED`, que e consequencia administrativa.
  //    A recepcao trata os dois casos de forma diferente (`M1-BR-002`).
  if (input.student.status === 'BLOCKED') {
    return { outcome: 'DENY', reason: DENY_REASON.STUDENT_BLOCKED, policyVersion: POLICY_VERSION };
  }

  // 3. Qualquer estado que nao seja `ACTIVE`. Lista de permissao, nao de
  //    negacao: um `StudentStatus` novo nasce NEGANDO acesso ate alguem
  //    decidir o contrario. O contrario -- negar so o que esta listado --
  //    faria um enum novo liberar catraca por esquecimento.
  if (input.student.status !== 'ACTIVE') {
    return { outcome: 'DENY', reason: DENY_REASON.STUDENT_INACTIVE, policyVersion: POLICY_VERSION };
  }

  const avaliadoEm = Date.parse(input.evaluatedAt);

  // Data invalida nunca vira ALLOW. `Date.parse` devolve NaN em silencio, e
  // toda comparacao com NaN e `false` -- entao um `evaluatedAt` corrompido
  // passaria pelas checagens de periodo sem disparar nenhuma delas.
  if (!Number.isFinite(avaliadoEm)) {
    return { outcome: 'DENY', reason: DENY_REASON.NO_ENTITLEMENT, policyVersion: POLICY_VERSION };
  }

  // 4. Direitos vigentes na DATA, sem olhar unidade nem horario ainda.
  //    A separacao em tres passos e o que permite distinguir "nao tem plano"
  //    de "tem plano de outra unidade" de "tem plano, mas nao a esta hora".
  const vigentes = input.entitlements.filter((e) => estaVigente(e, avaliadoEm));

  if (vigentes.length === 0) {
    /**
     * SUSPENSO POR DIVIDA NAO E O MESMO QUE SEM PLANO -- F15.
     *
     * As duas situacoes exigem acoes OPOSTAS de quem esta no balcao: "nao tem
     * plano" manda vender um; "esta devendo" manda cobrar. Ate a F15 as duas
     * saiam como `NO_ENTITLEMENT`, e a tela dizia a mesma coisa nos dois
     * casos.
     *
     * O MOTOR CONTINUA SEM SABER O QUE E UMA INVOICE (regra de arquitetura no
     * 1). Ele le `status === 'SUSPENDED'` e a janela de datas -- nada mais.
     * Quem traduziu divida em suspensao foi o job de vencimento, do lado do
     * financeiro, muito antes desta funcao rodar.
     *
     * A janela de DATAS importa: um direito suspenso cujo periodo ja acabou
     * nao e um inadimplente, e um plano vencido. Dizer "pague para liberar" a
     * quem nao tem mais plano mandaria a recepcao cobrar uma divida que nao
     * existe.
     */
    const suspensoNoPeriodo = input.entitlements.some(
      (e) => e.status === 'SUSPENDED' && dentroDoPeriodo(e, avaliadoEm),
    );

    return {
      outcome: 'DENY',
      reason: suspensoNoPeriodo ? DENY_REASON.PAYMENT_OVERDUE : DENY_REASON.NO_ENTITLEMENT,
      policyVersion: POLICY_VERSION,
    };
  }

  // 5. Dos vigentes, os que valem NESTA unidade.
  const daUnidade = vigentes.filter((e) => e.unitIds.includes(input.unitId));

  if (daUnidade.length === 0) {
    return { outcome: 'DENY', reason: DENY_REASON.WRONG_UNIT, policyVersion: POLICY_VERSION };
  }

  // 6. Dos desta unidade, os que valem NESTE horario.
  const naJanela = daUnidade.filter((e) =>
    dentroDeAlgumaJanela(e.windows, input.localDayOfWeek, input.localMinuteOfDay),
  );

  if (naJanela.length === 0) {
    return { outcome: 'DENY', reason: DENY_REASON.OUTSIDE_SCHEDULE, policyVersion: POLICY_VERSION };
  }

  // Sobrepostos: vence o que EXPIRA PRIMEIRO.
  //
  // Escolher o de maior validade seria mais generoso e errado: o Edge cacheia
  // `validUntil` para decidir offline (Slice 1.5), e um prazo emprestado de
  // um direito que a pessoa talvez perca antes deixaria a catraca liberando
  // com base em permissao que ja acabou. O menor prazo e o unico que nao
  // promete mais do que o conjunto garante.
  const escolhido = naJanela.reduce((menor, atual) =>
    Date.parse(atual.endsAt) < Date.parse(menor.endsAt) ? atual : menor,
  );

  return {
    outcome: 'ALLOW',
    reason: ALLOW_REASON.ACTIVE_ENTITLEMENT,
    entitlementId: escolhido.id,
    validUntil: new Date(Date.parse(escolhido.endsAt)).toISOString(),
    policyVersion: POLICY_VERSION,
  };
}

/**
 * Vigente = status `ACTIVE` E dentro do periodo.
 *
 * `SCHEDULED` nao entra: direito que comeca amanha nao abre a catraca hoje,
 * mesmo que a data ja tenha virado em outro fuso. `SUSPENDED` e `REVOKED`
 * tambem nao -- e `EXPIRED` e redundante com a checagem de data, mas o
 * status pode ter sido escrito antes de o job de expiracao rodar, entao os
 * dois filtros existem.
 */
function estaVigente(entitlement: EntitlementInput, avaliadoEm: number): boolean {
  if (entitlement.status !== 'ACTIVE') return false;

  return dentroDoPeriodo(entitlement, avaliadoEm);
}

/**
 * O instante cai dentro da janela do direito? So a DATA -- status nao entra.
 *
 * Extraida de `estaVigente` na F15, porque a razao `PAYMENT_OVERDUE` precisa
 * da mesma pergunta sobre um direito que NAO esta ativo: um suspenso cujo
 * periodo ja acabou e plano vencido, nao inadimplencia.
 */
function dentroDoPeriodo(entitlement: EntitlementInput, avaliadoEm: number): boolean {
  const inicio = Date.parse(entitlement.startsAt);
  const fim = Date.parse(entitlement.endsAt);

  // Direito com data corrompida e direito que nao vale. Sem este guarda,
  // `avaliadoEm >= NaN` seria `false` e o entitlement sairia do filtro por
  // acidente -- resultado certo por motivo errado, que deixa de valer assim
  // que a comparacao mudar de sinal.
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return false;

  return avaliadoEm >= inicio && avaliadoEm <= fim;
}

/**
 * Sem janela = sem restricao de horario.
 *
 * Um entitlement sem janela vale o periodo inteiro. A alternativa -- lista
 * vazia significando "nenhum horario" -- transformaria plano sem restricao
 * em plano que nunca abre, e o `EntitlementUnitWindow` so ganha linha quando
 * o plano REALMENTE restringe.
 */
function dentroDeAlgumaJanela(
  janelas: readonly AccessWindow[],
  diaLocal: number,
  minutoLocal: number,
): boolean {
  if (janelas.length === 0) return true;

  return janelas.some(
    (j) =>
      j.dayOfWeek === diaLocal &&
      // Ambos INCLUSIVOS. A academia que fecha as 22:00 quer que quem chega
      // 21:59:30 entre; o minuto 1320 e o ultimo minuto valido, nao o
      // primeiro invalido. Exclusivo no fim criaria um minuto morto por dia
      // que ninguem consegue explicar na recepcao.
      minutoLocal >= j.startMinute &&
      minutoLocal <= j.endMinute,
  );
}
