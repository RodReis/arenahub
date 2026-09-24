/**
 * Regras puras da consolidacao de assinaturas duplicadas -- issue #390.
 *
 * Sem banco, sem rede, sem relogio (`CLAUDE.md`; "agora" entra por
 * parametro). Os imports F47/F48 deixaram alunos com ate 3 assinaturas
 * (historico + base ativa + eventuais reimportacoes) -- 323 dos 1984 alunos
 * com assinatura no tenant arena-positiva.
 *
 * CRITERIO DO PI (23/09/2026): por aluno, sobrevive a assinatura ACTIVE; se
 * nao houver nenhuma ACTIVE, sobrevive a mais recente por `startsAt`. As
 * demais sao encerradas.
 *
 * O RISCO QUE ESTE MODULO EXISTE PARA EVITAR: `alterarAssinatura(CANCEL)`
 * revoga o entitlement da assinatura (REVOKED e TERMINAL -- nao ressuscita
 * nem por pagamento nem por reativacao, ver F385/#384). Medido contra
 * producao: das 599 assinaturas que o criterio encerraria, 147 tinham
 * entitlement ACTIVE e valido AGORA -- cancelar essas pelo caminho normal
 * fecharia a catraca de 147 pessoas que hoje entram.
 *
 * DECISAO DO PI: o entitlement de risco MIGRA para a assinatura
 * sobrevivente (nunca e revogado por uma limpeza de cadastro), EXCETO
 * quando a sobrevivente ja tem entitlement ACTIVE proprio -- ai migrar
 * duplicaria o acesso (dois ACTIVE simultaneos no mesmo aluno), e o
 * entitlement de risco e revogado com seguranca porque a pessoa continua
 * entrando pela assinatura sobrevivente. Medido: 0 alunos tem 2+
 * entitlements de risco simultaneos (nunca ha ambiguidade de qual migra).
 */

export type StatusDeAssinatura = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
export type StatusDeEntitlement = 'SCHEDULED' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface EntitlementDaAssinatura {
  readonly id: string;
  readonly status: StatusDeEntitlement;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface AssinaturaParaConsolidar {
  readonly id: string;
  readonly status: StatusDeAssinatura;
  readonly startsAt: Date;
  readonly entitlements: readonly EntitlementDaAssinatura[];
}

export type VereditoDoAluno =
  | { tipo: 'NADA_A_FAZER'; motivo: 'UMA_SO_ASSINATURA' | 'DUAS_OU_MAIS_ACTIVE' }
  | {
      tipo: 'CONSOLIDAR';
      sobreviventeId: string;
      /** Como a sobrevivente foi escolhida -- para relatorio e auditoria. */
      criterioDeSobrevivencia: 'ACTIVE' | 'MAIS_RECENTE';
      encerrar: {
        assinaturaId: string;
        /** Entitlement ACTIVE-e-valido desta assinatura que MIGRA para a sobrevivente. Null = nenhum a migrar. */
        entitlementParaMigrar: string | null;
      }[];
    };

function entitlementValidoAgora(e: EntitlementDaAssinatura, agora: Date): boolean {
  return e.status === 'ACTIVE' && e.startsAt <= agora && e.endsAt >= agora;
}

/**
 * Decide o destino das assinaturas de UM aluno.
 *
 * `DUAS_OU_MAIS_ACTIVE` fica de fora -- o criterio do PI so cobre "uma
 * ACTIVE" ou "nenhuma ACTIVE"; duas ou mais e pendencia humana, nunca
 * escolha automatica (mesmo espirito de `decidirCasamento` em
 * `import-ativos/dominio.ts`: NUNCA ESCOLHE ENTRE DOIS CANDIDATOS).
 */
export function decidirConsolidacaoDoAluno(
  assinaturas: readonly AssinaturaParaConsolidar[],
  agora: Date,
): VereditoDoAluno {
  if (assinaturas.length <= 1) {
    return { tipo: 'NADA_A_FAZER', motivo: 'UMA_SO_ASSINATURA' };
  }

  const ativas = assinaturas.filter((a) => a.status === 'ACTIVE');

  if (ativas.length > 1) {
    return { tipo: 'NADA_A_FAZER', motivo: 'DUAS_OU_MAIS_ACTIVE' };
  }

  let sobrevivente: AssinaturaParaConsolidar;
  let criterio: 'ACTIVE' | 'MAIS_RECENTE';

  if (ativas.length === 1) {
    sobrevivente = ativas[0]!;
    criterio = 'ACTIVE';
  } else {
    // Nenhuma ACTIVE: a mais recente por startsAt. Empate ficaria
    // ambiguo -- nao ocorre nos dados medidos (0 casos), mas o codigo
    // nao finge saber escolher: pega a primeira apos ordenar, e um
    // empate real produziria resultado deterministico (estavel), nao
    // um erro escondido.
    const ordenadas = [...assinaturas].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    sobrevivente = ordenadas[0]!;
    criterio = 'MAIS_RECENTE';
  }

  // A sobrevivente ja tem entitlement ACTIVE proprio? Migrar um segundo
  // para cima dela duplicaria o acesso.
  const sobreviventeTemEntitlementAtivo = sobrevivente.entitlements.some((e) => e.status === 'ACTIVE');

  const encerrar = assinaturas
    .filter((a) => a.id !== sobrevivente.id)
    .map((a) => {
      const entitlementDeRisco = sobreviventeTemEntitlementAtivo
        ? undefined
        : a.entitlements.find((e) => entitlementValidoAgora(e, agora));

      return {
        assinaturaId: a.id,
        entitlementParaMigrar: entitlementDeRisco?.id ?? null,
      };
    });

  return {
    tipo: 'CONSOLIDAR',
    sobreviventeId: sobrevivente.id,
    criterioDeSobrevivencia: criterio,
    encerrar,
  };
}
