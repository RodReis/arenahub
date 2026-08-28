import { ConflictException, NotFoundException } from '@nestjs/common';
import type { StudentStatus } from '@arenahub/database';

import type { DecisaoDeEngajamento, FinalidadeDeEngajamento } from './domain/participacao.js';
import type { StatusDoPerfilPublico } from './domain/exposicao.js';
import type { StatusDaContestacao } from './domain/contestacao.js';
import type {
  AlunoParaExposicao,
  ConfiguracaoDeEngajamento,
  EscopoDeUnidade,
  IndicadoresDeEngajamento,
  ContestacaoGravada,
  ContestacaoParaFila,
  EntradaDeContestacao,
  EntradaDeModeracaoNoBanco,
  EntradaDeResolucaoNoBanco,
  EntradaDeRegistro,
  EntradaDeSalvamento,
  PerfilParaModeracao,
  PerfilPublicoDoAluno,
  PortaDeEngajamento,
} from './engagement.repository.js';

/** Os defaults do schema: tudo LIGADO, sem teto. */
const PADRAO_DA_CONFIGURACAO: ConfiguracaoDeEngajamento = {
  rankingEnabled: true,
  challengesEnabled: true,
  achievementsEnabled: true,
  correctionLimitPoints: null,
};

/** Aluno como o dublê aceita cadastrar -- so o que os testes precisam. */
export interface AlunoDeTeste {
  id: string;
  tenantId: string;
  name: string;
  status: StudentStatus;
  /** Unidade de matricula -- o que o filtro de escopo atravessa (F35). */
  gymUnitId?: string;
}

/** Linha de decisao guardada em memoria, no formato de ConsentRecord. */
interface DecisaoGuardada {
  id: string;
  tenantId: string;
  studentId: string;
  finalidade: FinalidadeDeEngajamento;
  decision: 'ACCEPTED' | 'REFUSED';
  occurredAt: Date;
  supersededAt: Date | null;
  idempotencyKey: string | undefined;
}

/**
 * Dublê de `PortaDeEngajamento` em memoria.
 *
 * Vive no boundary (docs/TESTING.md §3), nunca dentro do dominio. Guarda
 * alunos, decisoes e perfis em Map. `decisoesDe` e auxiliar SO do dublê,
 * para o teste inspecionar o historico.
 */
export class RepositorioEmMemoria implements PortaDeEngajamento {
  private readonly alunos = new Map<string, AlunoDeTeste>();
  private readonly decisoes: DecisaoGuardada[] = [];
  private readonly perfis = new Map<
    string,
    PerfilPublicoDoAluno & { tenantId: string; studentId: string; aliasNormalized: string | null }
  >();
  /** Documentos "publicados" -- espelha o que o seed grava no banco real. */
  private readonly documentosPublicados = new Set<string>();
  /** Contestacoes da F35, com o tenant junto para o filtro de escopo. */
  private readonly contestacoes: (ContestacaoGravada & { tenantId: string })[] = [];
  /** Configuracao por tenant. Ausencia = os defaults do schema. */
  private readonly configuracoes = new Map<string, ConfiguracaoDeEngajamento>();
  private proximoId = 1;
  private proximaContestacao = 1;

  cadastrarAluno(aluno: AlunoDeTeste): void {
    this.alunos.set(aluno.id, aluno);
  }

  /** So do dublê: registra o documento de uma finalidade como publicado
   * para o tenant, espelhando o seed real -- sem isso `registrarDecisao`
   * recusa com `NotFoundException`. */
  publicarDocumento(tenantId: string, finalidade: FinalidadeDeEngajamento): void {
    this.documentosPublicados.add(`${tenantId}:${finalidade}`);
  }

  /** So do dublê: historico ordenado por occurredAt crescente, em copia. */
  decisoesDe(studentId: string, finalidade: FinalidadeDeEngajamento): DecisaoGuardada[] {
    return this.decisoes
      .filter((d) => d.studentId === studentId && d.finalidade === finalidade)
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
      .map((d) => ({ ...d }));
  }

  buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null> {
    const aluno = this.alunos.get(studentId);
    if (!aluno || aluno.tenantId !== tenantId) return Promise.resolve(null);

    return Promise.resolve({
      id: aluno.id,
      tenantId: aluno.tenantId,
      fullName: aluno.name,
      status: aluno.status,
      // Sem uso de idade nesta fatia no dublê -- data arbitraria, adulta.
      birthDate: new Date('2000-01-01T00:00:00.000Z'),
    });
  }

  decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null> {
    const vigentes = this.decisoes
      .filter(
        (d) =>
          d.tenantId === tenantId &&
          d.studentId === studentId &&
          d.finalidade === finalidade &&
          d.supersededAt === null,
      )
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

    const vigente = vigentes[0];
    if (!vigente) return Promise.resolve(null);

    return Promise.resolve({ decision: vigente.decision, supersededAt: vigente.supersededAt });
  }

  registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void> {
    if (!this.documentosPublicados.has(`${entrada.tenantId}:${entrada.finalidade}`)) {
      throw new NotFoundException({
        code: 'DOCUMENTO_DE_ENGAJAMENTO_AUSENTE',
        message: `Nenhum documento de consentimento publicado para ${entrada.finalidade}`,
      });
    }

    if (entrada.idempotencyKey) {
      const desde = agora.getTime() - 24 * 60 * 60 * 1000;
      const existente = this.decisoes.find(
        (d) =>
          d.tenantId === entrada.tenantId &&
          d.studentId === entrada.studentId &&
          d.finalidade === entrada.finalidade &&
          d.idempotencyKey === entrada.idempotencyKey &&
          d.occurredAt.getTime() >= desde,
      );

      if (existente) return Promise.resolve();
    }

    for (const decisao of this.decisoes) {
      if (
        decisao.tenantId === entrada.tenantId &&
        decisao.studentId === entrada.studentId &&
        decisao.finalidade === entrada.finalidade &&
        decisao.supersededAt === null
      ) {
        decisao.supersededAt = agora;
      }
    }

    this.decisoes.push({
      id: `dec-${this.proximoId++}`,
      tenantId: entrada.tenantId,
      studentId: entrada.studentId,
      finalidade: entrada.finalidade,
      decision: entrada.decision,
      occurredAt: agora,
      supersededAt: null,
      idempotencyKey: entrada.idempotencyKey,
    });

    return Promise.resolve();
  }

  perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null> {
    for (const perfil of this.perfis.values()) {
      if (perfil.tenantId === tenantId && perfil.studentId === studentId) {
        return Promise.resolve(semTenantEAluno(perfil));
      }
    }

    return Promise.resolve(null);
  }

  perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = this.perfis.get(perfilId);
    if (!perfil || perfil.tenantId !== tenantId) return Promise.resolve(null);

    return Promise.resolve(semTenantEAluno(perfil));
  }

  salvarPerfil(entrada: EntradaDeSalvamento, _agora: Date): Promise<PerfilPublicoDoAluno> {
    let existente:
      | (PerfilPublicoDoAluno & { tenantId: string; studentId: string; aliasNormalized: string | null })
      | undefined;
    for (const perfil of this.perfis.values()) {
      if (perfil.tenantId === entrada.tenantId && perfil.studentId === entrada.studentId) {
        existente = perfil;
        break;
      }
    }

    if (entrada.version !== null) {
      if (!existente || existente.version !== entrada.version) {
        throw new ConflictException({
          code: 'PERFIL_PUBLICO_VERSAO_CONFLITANTE',
          message: 'Perfil publico foi alterado por outra edicao',
        });
      }
    }

    const id = existente?.id ?? `perfil-${this.proximoId++}`;
    const novaVersao = existente ? existente.version + 1 : 1;

    const salvo: PerfilPublicoDoAluno & {
      tenantId: string;
      studentId: string;
      aliasNormalized: string | null;
    } = {
      id,
      tenantId: entrada.tenantId,
      studentId: entrada.studentId,
      identityChoice: entrada.identityChoice,
      alias: entrada.alias,
      aliasNormalized: entrada.aliasNormalized,
      status: 'PENDING',
      screeningSignals: [...entrada.screeningSignals],
      rejectionReason: null,
      version: novaVersao,
    };

    this.perfis.set(id, salvo);

    return Promise.resolve(semTenantEAluno(salvo));
  }

  moderarPerfil(entrada: EntradaDeModeracaoNoBanco, _agora: Date): Promise<PerfilPublicoDoAluno> {
    const perfil = this.perfis.get(entrada.perfilId);
    if (!perfil || perfil.tenantId !== entrada.tenantId) {
      throw new NotFoundException({
        code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
        message: 'Perfil publico nao encontrado',
      });
    }

    if (entrada.status === 'APPROVED') {
      this.verificarColisaoDeAliasAprovado(entrada.tenantId, perfil.id, perfil.aliasNormalized);
    }

    const atualizado = { ...perfil, status: entrada.status, rejectionReason: entrada.rejectionReason };
    this.perfis.set(perfil.id, atualizado);

    return Promise.resolve(semTenantEAluno(atualizado));
  }

  listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilParaModeracao[]> {
    // Espelha o `include: { student: { select: { fullName } } }` do
    // repositorio real -- mesma junção, feita a mao contra o Map de alunos.
    const resultado = [...this.perfis.values()]
      .filter((p) => p.tenantId === tenantId && p.status === status)
      .slice(0, limite)
      .map((perfil) => ({
        ...semTenantEAluno(perfil),
        alunoNome: this.alunos.get(perfil.studentId)?.name ?? '',
      }));

    return Promise.resolve(resultado);
  }

  // --- F35: contestacoes ---------------------------------------------------

  criarContestacao(entrada: EntradaDeContestacao, agora: Date): Promise<ContestacaoGravada> {
    const criada: ContestacaoGravada & { tenantId: string } = {
      id: `contestacao-${this.proximaContestacao++}`,
      tenantId: entrada.tenantId,
      studentId: entrada.studentId,
      subject: entrada.subject,
      descricao: entrada.descricao,
      status: 'ABERTA',
      resolucao: null,
      resolvedAt: null,
      createdAt: agora,
    };

    this.contestacoes.push(criada);
    return Promise.resolve({ ...criada });
  }

  contestacaoPorId(
    tenantId: string,
    id: string,
    escopo: EscopoDeUnidade = 'ALL',
  ): Promise<ContestacaoGravada | null> {
    const achada = this.contestacoes.find(
      (c) => c.id === id && c.tenantId === tenantId && this.dentroDoEscopo(c.studentId, escopo),
    );
    return Promise.resolve(achada ? { ...achada } : null);
  }

  /** Espelha `filtroDeUnidade` do repositorio real: a unidade e a do ALUNO. */
  private dentroDoEscopo(studentId: string, escopo: EscopoDeUnidade): boolean {
    if (escopo === 'ALL') return true;

    const unidade = this.alunos.get(studentId)?.gymUnitId;
    return unidade !== undefined && escopo.has(unidade);
  }

  gravarResolucao(entrada: EntradaDeResolucaoNoBanco, agora: Date): Promise<ContestacaoGravada> {
    // Espelha o `where` do repositorio real: id + tenant + status ABERTA. A
    // corrida so e recusada porque o ESTADO entra no criterio da escrita --
    // guarda que le antes de escrever perde a corrida por construcao.
    const alvo = this.contestacoes.find(
      (c) => c.id === entrada.id && c.tenantId === entrada.tenantId && c.status === 'ABERTA',
    );

    if (!alvo) {
      return Promise.reject(
        new ConflictException({
          code: 'CONTESTACAO_JA_RESOLVIDA',
          message: 'CONTESTACAO_JA_RESOLVIDA',
        }),
      );
    }

    alvo.status = entrada.status;
    alvo.resolucao = entrada.resolucao;
    alvo.resolvedAt = agora;

    return Promise.resolve({ ...alvo });
  }

  listarContestacoes(
    tenantId: string,
    status: StatusDaContestacao,
    limite: number,
    escopo: EscopoDeUnidade = 'ALL',
  ): Promise<ContestacaoParaFila[]> {
    const filtradas = this.contestacoes
      .filter(
        (c) =>
          c.tenantId === tenantId &&
          c.status === status &&
          this.dentroDoEscopo(c.studentId, escopo),
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limite);

    return Promise.resolve(
      filtradas.map((c) => ({
        ...c,
        alunoNome: this.alunos.get(c.studentId)?.name ?? '',
      })),
    );
  }

  contestacoesDoAluno(tenantId: string, studentId: string): Promise<ContestacaoGravada[]> {
    return Promise.resolve(
      this.contestacoes
        .filter((c) => c.tenantId === tenantId && c.studentId === studentId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({ ...c })),
    );
  }

  indicadores(tenantId: string): Promise<IndicadoresDeEngajamento> {
    const ativos = [...this.alunos.values()].filter(
      (a) => a.tenantId === tenantId && a.status === 'ACTIVE',
    );
    const idsAtivos = new Set(ativos.map((a) => a.id));

    // Espelha o repositorio real: opt-out VIGENTE de quem esta ATIVO, e
    // participando e a SUBTRACAO -- ausencia de linha significa participa.
    const optOut = this.decisoes.filter(
      (d) =>
        d.tenantId === tenantId &&
        d.finalidade === 'RANKING' &&
        d.decision === 'REFUSED' &&
        d.supersededAt === null &&
        idsAtivos.has(d.studentId),
    ).length;

    const perfis = [...this.perfis.values()].filter((p) => p.tenantId === tenantId);

    return Promise.resolve({
      alunosAtivos: ativos.length,
      participandoDoRanking: ativos.length - optOut,
      optOut,
      apelidosPendentes: perfis.filter((p) => p.status === 'PENDING').length,
      apelidosOcultos: perfis.filter((p) => p.status === 'HIDDEN').length,
      contestacoesAbertas: this.contestacoes.filter(
        (c) => c.tenantId === tenantId && c.status === 'ABERTA',
      ).length,
    });
  }

  // --- F35: configuracao de engajamento do tenant --------------------------

  obterConfiguracao(tenantId: string): Promise<ConfiguracaoDeEngajamento> {
    // Ausencia de linha = os defaults do schema, tudo LIGADO e sem teto.
    return Promise.resolve({ ...PADRAO_DA_CONFIGURACAO, ...this.configuracoes.get(tenantId) });
  }

  salvarConfiguracao(
    tenantId: string,
    entrada: Partial<ConfiguracaoDeEngajamento>,
  ): Promise<ConfiguracaoDeEngajamento> {
    const atual = { ...PADRAO_DA_CONFIGURACAO, ...this.configuracoes.get(tenantId) };

    // Espelha o `!== undefined` do repositorio real: `null` e `0` sao valores
    // legitimos e nao podem ser tratados como "nao veio".
    const nova: ConfiguracaoDeEngajamento = {
      rankingEnabled: entrada.rankingEnabled ?? atual.rankingEnabled,
      challengesEnabled: entrada.challengesEnabled ?? atual.challengesEnabled,
      achievementsEnabled: entrada.achievementsEnabled ?? atual.achievementsEnabled,
      correctionLimitPoints:
        entrada.correctionLimitPoints !== undefined
          ? entrada.correctionLimitPoints
          : atual.correctionLimitPoints,
    };

    this.configuracoes.set(tenantId, nova);
    return Promise.resolve({ ...nova });
  }

  /**
   * Espelha o indice parcial: alias unico so entre APPROVED, ao aprovar.
   *
   * Compara `aliasNormalized`, nao o `alias` cru -- o indice real
   * (`public_profiles_alias_aprovado_unico`) e sobre `alias_normalized`
   * (NFKC + minuscula + espaco colapsado, saida de `triarAlias`). Comparar o
   * texto cru deixava "Tigre" e "TIGRE" coexistirem aqui e colidirem so no
   * Postgres -- um dublê mais permissivo que o indice que ele deveria
   * espelhar.
   */
  private verificarColisaoDeAliasAprovado(
    tenantId: string,
    ignorarId: string,
    aliasNormalized: string | null,
  ): void {
    if (!aliasNormalized) return;

    for (const perfil of this.perfis.values()) {
      if (perfil.id === ignorarId) continue;
      if (perfil.tenantId !== tenantId) continue;
      if (perfil.status !== 'APPROVED') continue;
      if (perfil.aliasNormalized === aliasNormalized) {
        throw new ConflictException({
          code: 'ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO',
          message: 'Este apelido ja foi aprovado para outro aluno',
        });
      }
    }
  }
}

function semTenantEAluno(
  perfil: PerfilPublicoDoAluno & { tenantId: string; studentId: string },
): PerfilPublicoDoAluno {
  return {
    id: perfil.id,
    identityChoice: perfil.identityChoice,
    alias: perfil.alias,
    status: perfil.status,
    screeningSignals: perfil.screeningSignals,
    rejectionReason: perfil.rejectionReason,
    version: perfil.version,
  };
}
