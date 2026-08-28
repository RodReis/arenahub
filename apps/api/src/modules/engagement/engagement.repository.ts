import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AliasRejectionReason, type StudentStatus } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';
import type { DecisaoDeEngajamento, FinalidadeDeEngajamento } from './domain/participacao.js';
import type { IdentidadeEscolhida, StatusDoPerfilPublico } from './domain/exposicao.js';
import type {
  AssuntoDaContestacao,
  DesfechoDaContestacao,
  StatusDaContestacao,
} from './domain/contestacao.js';

/** Nome do indice parcial que garante alias unico entre os aprovados. */
const INDICE_ALIAS_APROVADO_UNICO = 'public_profiles_alias_aprovado_unico';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_ENGAJAMENTO = Symbol('PortaDeEngajamento');

/** O que a camada de service precisa saber sobre o aluno para expor. */
export interface AlunoParaExposicao {
  id: string;
  tenantId: string;
  fullName: string;
  status: StudentStatus;
  birthDate: Date;
}

/** Perfil publico, na forma que o service e o dublê expoem. */
export interface PerfilPublicoDoAluno {
  id: string;
  identityChoice: IdentidadeEscolhida;
  alias: string | null;
  status: StatusDoPerfilPublico;
  screeningSignals: readonly string[];
  rejectionReason: AliasRejectionReason | null;
  version: number;
}

/**
 * Perfil publico com o nome do aluno anexado -- so para a fila de moderacao.
 *
 * NAO e o formato de `perfilDoAluno`/`salvarPerfil`: aquele alimenta
 * `obterPreferencias`, que o TOTEM consome (`PreferenciasDoAluno.perfil`), e
 * o totem fala com o proprio aluno -- nao precisa do nome dele de volta.
 * Vazar `alunoNome` ali inchava um tipo compartilhado por um consumidor que
 * nao pediu. O moderador, ao contrario, julga um perfil de outra pessoa e
 * precisa do NOME COMPLETO para distinguir alunos com o mesmo primeiro nome
 * -- diferente da tela do totem, que mostra so o primeiro nome para o
 * proprio aluno.
 */
export interface PerfilParaModeracao extends PerfilPublicoDoAluno {
  alunoNome: string;
}

export interface EntradaDeRegistro {
  tenantId: string;
  actorId: string;
  studentId: string;
  finalidade: FinalidadeDeEngajamento;
  decision: 'ACCEPTED' | 'REFUSED';
  subjectAgeYears: number;
  idempotencyKey?: string | undefined;
}

export interface EntradaDeSalvamento {
  tenantId: string;
  studentId: string;
  identityChoice: IdentidadeEscolhida;
  alias: string | null;
  aliasNormalized: string | null;
  screeningSignals: readonly string[];
  /** `null` = criacao. Presente = compare-and-swap contra a versao lida. */
  version: number | null;
}

export interface EntradaDeModeracaoNoBanco {
  tenantId: string;
  actorId: string;
  perfilId: string;
  status: 'APPROVED' | 'REJECTED' | 'HIDDEN';
  rejectionReason: AliasRejectionReason | null;
}

/**
 * Le e escreve consentimento de ENGAJAMENTO e perfil publico.
 *
 * `ConsentRecord` e a mesma tabela da biometria, e isso e deliberado
 * (ADR-046): append-only, revogacao por linha nova, ator e IP ja modelados.
 * O que muda e o REGIME de leitura -- ver `domain/participacao.ts`.
 */
export interface PortaDeEngajamento {
  buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null>;
  decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null>;
  registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void>;
  perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null>;
  perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null>;
  salvarPerfil(entrada: EntradaDeSalvamento, agora: Date): Promise<PerfilPublicoDoAluno>;
  moderarPerfil(entrada: EntradaDeModeracaoNoBanco, agora: Date): Promise<PerfilPublicoDoAluno>;
  listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilParaModeracao[]>;

  // --- F35: contestacoes -------------------------------------------------
  criarContestacao(entrada: EntradaDeContestacao, agora: Date): Promise<ContestacaoGravada>;
  contestacaoPorId(
    tenantId: string,
    id: string,
    escopo: EscopoDeUnidade,
  ): Promise<ContestacaoGravada | null>;
  gravarResolucao(entrada: EntradaDeResolucaoNoBanco, agora: Date): Promise<ContestacaoGravada>;
  listarContestacoes(
    tenantId: string,
    status: StatusDaContestacao,
    limite: number,
    /** Unidades que o ator pode ver. `'ALL'` = tenant inteiro. */
    escopo: EscopoDeUnidade,
  ): Promise<ContestacaoParaFila[]>;
  contestacoesDoAluno(tenantId: string, studentId: string): Promise<ContestacaoGravada[]>;

  // --- F35: configuracao de engajamento do tenant ------------------------
  indicadores(tenantId: string): Promise<IndicadoresDeEngajamento>;
  obterConfiguracao(tenantId: string): Promise<ConfiguracaoDeEngajamento>;
  salvarConfiguracao(
    tenantId: string,
    entrada: Partial<ConfiguracaoDeEngajamento>,
  ): Promise<ConfiguracaoDeEngajamento>;
}

/**
 * O que o painel de operacao mostra (`M5-FR-018`, F35).
 *
 * Numeros DERIVADOS na leitura, sem tabela de metrica: o volume e de uma
 * academia, nao de um data warehouse, e materializar criaria uma projecao com
 * rebuild proprio capaz de divergir do que as telas mostram -- exatamente o
 * que a F32 evitou ao derivar o streak.
 */
export interface IndicadoresDeEngajamento {
  alunosAtivos: number;
  participandoDoRanking: number;
  optOut: number;
  apelidosPendentes: number;
  apelidosOcultos: number;
  contestacoesAbertas: number;
}

/**
 * Flags e teto por tenant (ADR-049, Decisoes 2 e 3).
 *
 * Desligar NAO apaga nada: o ledger continua, o snapshot continua, o aluno so
 * para de ver. Religar devolve tudo, porque nada foi destruido.
 */
export interface ConfiguracaoDeEngajamento {
  rankingEnabled: boolean;
  challengesEnabled: boolean;
  achievementsEnabled: boolean;
  /** Teto da correcao manual em pontos absolutos. `null` = sem teto. */
  correctionLimitPoints: number | null;
}

/**
 * Unidades sobre as quais o ator pode agir -- espelha `TenantContext.allowedUnitIds`.
 *
 * A contestacao NAO tem `gymUnitId` proprio: a unidade e a do ALUNO, entao o
 * filtro atravessa a relacao. Mesmo padrao de `ajustarXp` (F31), que barra
 * gerente restrito a uma unidade de mexer em aluno de outra.
 */
export type EscopoDeUnidade = 'ALL' | ReadonlySet<string>;

/** O que o service pede para abrir uma contestacao. */
export interface EntradaDeContestacao {
  tenantId: string;
  studentId: string;
  subject: AssuntoDaContestacao;
  descricao: string;
}

/** O que o service pede para resolver -- ator e instante entram aqui. */
export interface EntradaDeResolucaoNoBanco {
  tenantId: string;
  id: string;
  status: DesfechoDaContestacao;
  resolucao: string;
  resolvedBy: string;
  /** O movimento de XP que corrigiu, quando houve. Aponta, nao copia. */
  correctionEntryId: string | null;
}

/** Uma contestacao como o service a consome. */
export interface ContestacaoGravada {
  id: string;
  studentId: string;
  subject: AssuntoDaContestacao;
  descricao: string;
  status: StatusDaContestacao;
  resolucao: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

/** A linha da fila do painel -- a contestacao mais o nome do aluno. */
export interface ContestacaoParaFila extends ContestacaoGravada {
  /** Nome COMPLETO: quem modera precisa saber de quem e, e a fila e interna. */
  alunoNome: string;
}

/** Converte a linha do Prisma para a forma que o service consome. */
function paraPerfilPublico(linha: {
  id: string;
  identityChoice: string;
  alias: string | null;
  status: string;
  screeningSignals: string[];
  rejectionReason: AliasRejectionReason | null;
  version: number;
}): PerfilPublicoDoAluno {
  return {
    id: linha.id,
    identityChoice: linha.identityChoice as IdentidadeEscolhida,
    alias: linha.alias,
    status: linha.status as StatusDoPerfilPublico,
    screeningSignals: linha.screeningSignals,
    rejectionReason: linha.rejectionReason,
    version: linha.version,
  };
}

@Injectable()
export class EngagementRepository implements PortaDeEngajamento {
  constructor(private readonly db: PrismaService) {}

  async buscarAluno(tenantId: string, studentId: string): Promise<AlunoParaExposicao | null> {
    const aluno = await this.db.student.findFirst({
      where: { id: studentId, tenantId },
      select: { id: true, tenantId: true, fullName: true, status: true, birthDate: true },
    });

    return aluno;
  }

  async decisaoVigente(
    tenantId: string,
    studentId: string,
    finalidade: FinalidadeDeEngajamento,
  ): Promise<DecisaoDeEngajamento | null> {
    // orderBy obrigatorio: sem ele a ordem fisica do Postgres decide qual
    // decisao vale (memoria sort-estavel-decide-consentimento).
    const registro = await this.db.consentRecord.findFirst({
      where: {
        tenantId,
        studentId,
        supersededAt: null,
        document: { type: finalidade },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { decision: true, supersededAt: true },
    });

    if (!registro) return null;

    return { decision: registro.decision, supersededAt: registro.supersededAt };
  }

  async registrarDecisao(entrada: EntradaDeRegistro, agora: Date): Promise<void> {
    // Idempotencia por evidence.idempotencyKey: procura decisao com a mesma
    // chave nas ultimas 24h e nao grava de novo se ja existir.
    if (entrada.idempotencyKey) {
      const desde = new Date(agora.getTime() - 24 * 60 * 60 * 1000);
      const existente = await this.db.consentRecord.findFirst({
        where: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          document: { type: entrada.finalidade },
          occurredAt: { gte: desde },
          evidence: { path: ['idempotencyKey'], equals: entrada.idempotencyKey },
        },
      });

      if (existente) return;
    }

    // Documento vigente do TENANT (nunca global/null): so o seed publica
    // estes quatro, um por tenant -- ver `packages/database/prisma/seed.ts`.
    // orderBy obrigatorio pelo mesmo motivo de `decisaoVigente`.
    const documento = await this.db.consentDocument.findFirst({
      where: { tenantId: entrada.tenantId, type: entrada.finalidade, retiredAt: null },
      orderBy: [{ version: 'desc' }],
      select: { id: true },
    });

    if (!documento) {
      throw new NotFoundException({
        code: 'DOCUMENTO_DE_ENGAJAMENTO_AUSENTE',
        message: `Nenhum documento de consentimento publicado para ${entrada.finalidade}`,
      });
    }

    await this.db.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          documentId: documento.id,
          supersededAt: null,
        },
        data: { supersededAt: agora },
      });

      await tx.consentRecord.create({
        data: {
          tenantId: entrada.tenantId,
          studentId: entrada.studentId,
          documentId: documento.id,
          decision: entrada.decision,
          subjectKind: 'STUDENT',
          subjectAgeYears: entrada.subjectAgeYears,
          actorId: entrada.actorId,
          evidence: entrada.idempotencyKey
            ? { idempotencyKey: entrada.idempotencyKey }
            : Prisma.JsonNull,
          occurredAt: agora,
        },
      });
    });
  }

  async perfilDoAluno(tenantId: string, studentId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = await this.db.publicProfile.findFirst({
      where: { tenantId, studentId },
    });

    return perfil ? paraPerfilPublico(perfil) : null;
  }

  async perfilPorId(tenantId: string, perfilId: string): Promise<PerfilPublicoDoAluno | null> {
    const perfil = await this.db.publicProfile.findFirst({
      where: { id: perfilId, tenantId },
    });

    return perfil ? paraPerfilPublico(perfil) : null;
  }

  async salvarPerfil(entrada: EntradaDeSalvamento, _agora: Date): Promise<PerfilPublicoDoAluno> {
    try {
      if (entrada.version === null) {
        const criado = await this.db.publicProfile.upsert({
          where: { tenantId_studentId: { tenantId: entrada.tenantId, studentId: entrada.studentId } },
          create: {
            tenantId: entrada.tenantId,
            studentId: entrada.studentId,
            identityChoice: entrada.identityChoice,
            alias: entrada.alias,
            aliasNormalized: entrada.aliasNormalized,
            screeningSignals: [...entrada.screeningSignals],
            status: 'PENDING',
            version: 1,
          },
          update: {
            identityChoice: entrada.identityChoice,
            alias: entrada.alias,
            aliasNormalized: entrada.aliasNormalized,
            screeningSignals: [...entrada.screeningSignals],
            status: 'PENDING',
            rejectionReason: null,
            moderatedBy: null,
            moderatedAt: null,
            version: { increment: 1 },
          },
        });

        return paraPerfilPublico(criado);
      }

      // Compare-and-swap: so atualiza se a versao ainda for a lida.
      const resultado = await this.db.publicProfile.updateMany({
        where: { tenantId: entrada.tenantId, studentId: entrada.studentId, version: entrada.version },
        data: {
          identityChoice: entrada.identityChoice,
          alias: entrada.alias,
          aliasNormalized: entrada.aliasNormalized,
          screeningSignals: [...entrada.screeningSignals],
          status: 'PENDING',
          rejectionReason: null,
          moderatedBy: null,
          moderatedAt: null,
          version: { increment: 1 },
        },
      });

      if (resultado.count === 0) {
        throw new ConflictException({
          code: 'PERFIL_PUBLICO_VERSAO_CONFLITANTE',
          message: 'Perfil publico foi alterado por outra edicao',
        });
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { tenantId: entrada.tenantId, studentId: entrada.studentId },
      });

      if (!atualizado) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      return paraPerfilPublico(atualizado);
    } catch (erro) {
      throw traduzirErroDeColisao(erro);
    }
  }

  async moderarPerfil(
    entrada: EntradaDeModeracaoNoBanco,
    agora: Date,
  ): Promise<PerfilPublicoDoAluno> {
    try {
      const resultado = await this.db.publicProfile.updateMany({
        // tenantId no where, nunca so o id: e o que barra o moderador de
        // outro tenant.
        where: { id: entrada.perfilId, tenantId: entrada.tenantId },
        data: {
          status: entrada.status,
          rejectionReason: entrada.rejectionReason,
          moderatedBy: entrada.actorId,
          moderatedAt: agora,
        },
      });

      if (resultado.count === 0) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      const atualizado = await this.db.publicProfile.findFirst({
        where: { id: entrada.perfilId, tenantId: entrada.tenantId },
      });

      if (!atualizado) {
        throw new NotFoundException({
          code: 'PERFIL_PUBLICO_NAO_ENCONTRADO',
          message: 'Perfil publico nao encontrado',
        });
      }

      return paraPerfilPublico(atualizado);
    } catch (erro) {
      throw traduzirErroDeColisao(erro);
    }
  }

  async listarPorStatus(
    tenantId: string,
    status: StatusDoPerfilPublico,
    limite: number,
  ): Promise<PerfilParaModeracao[]> {
    const perfis = await this.db.publicProfile.findMany({
      where: { tenantId, status },
      orderBy: [{ createdAt: 'asc' }],
      take: limite,
      include: { student: { select: { fullName: true } } },
    });

    return perfis.map((perfil) => ({
      ...paraPerfilPublico(perfil),
      alunoNome: perfil.student.fullName,
    }));
  }

  // --- F35: contestacoes ---------------------------------------------------

  async criarContestacao(
    entrada: EntradaDeContestacao,
    agora: Date,
  ): Promise<ContestacaoGravada> {
    const criada = await this.db.engagementDispute.create({
      data: {
        tenantId: entrada.tenantId,
        studentId: entrada.studentId,
        subject: entrada.subject,
        descricao: entrada.descricao,
        status: 'ABERTA',
        createdAt: agora,
      },
    });

    return paraContestacao(criada);
  }

  async contestacaoPorId(
    tenantId: string,
    id: string,
    escopo: EscopoDeUnidade,
  ): Promise<ContestacaoGravada | null> {
    const linha = await this.db.engagementDispute.findFirst({
      where: { id, tenantId, ...filtroDeUnidade(escopo) },
    });
    return linha ? paraContestacao(linha) : null;
  }

  /**
   * Grava o desfecho.
   *
   * `status: 'ABERTA'` NO WHERE, e nao so o id: duas abas do painel abertas na
   * mesma contestacao resolveriam as duas, e a segunda sobrescreveria ator e
   * instante da primeira. A checagem de estado no dominio nao basta -- ela le
   * antes de escrever, e quem le antes de escrever perde a corrida.
   *
   * O `tenantId` no where e o que separa as academias: sem ele um moderador
   * do tenant A fecharia contestacao de aluno do tenant B, com resposta 200.
   */
  async gravarResolucao(
    entrada: EntradaDeResolucaoNoBanco,
    agora: Date,
  ): Promise<ContestacaoGravada> {
    const resultado = await this.db.engagementDispute.updateMany({
      where: { id: entrada.id, tenantId: entrada.tenantId, status: 'ABERTA' },
      data: {
        status: entrada.status,
        resolucao: entrada.resolucao,
        resolvedBy: entrada.resolvedBy,
        resolvedAt: agora,
        correctionEntryId: entrada.correctionEntryId,
      },
    });

    if (resultado.count === 0) {
      // Nao existe, e de outro tenant, ou ja foi resolvida. O service ja
      // distinguiu os dois primeiros casos lendo antes; aqui so resta a
      // corrida perdida.
      throw new ConflictException({
        code: 'CONTESTACAO_JA_RESOLVIDA',
        message: 'CONTESTACAO_JA_RESOLVIDA',
      });
    }

    const atualizada = await this.db.engagementDispute.findFirstOrThrow({
      where: { id: entrada.id, tenantId: entrada.tenantId },
    });

    return paraContestacao(atualizada);
  }

  async listarContestacoes(
    tenantId: string,
    status: StatusDaContestacao,
    limite: number,
    escopo: EscopoDeUnidade,
  ): Promise<ContestacaoParaFila[]> {
    const linhas = await this.db.engagementDispute.findMany({
      where: { tenantId, status, ...filtroDeUnidade(escopo) },
      orderBy: [{ createdAt: 'asc' }],
      take: limite,
      include: { student: { select: { fullName: true } } },
    });

    return linhas.map((linha) => ({
      ...paraContestacao(linha),
      alunoNome: linha.student.fullName,
    }));
  }

  async contestacoesDoAluno(tenantId: string, studentId: string): Promise<ContestacaoGravada[]> {
    const linhas = await this.db.engagementDispute.findMany({
      where: { tenantId, studentId },
      orderBy: [{ createdAt: 'desc' }],
    });

    return linhas.map(paraContestacao);
  }

  // --- F35: configuracao de engajamento do tenant --------------------------


  /**
   * Indicadores do painel (`M5-FR-018`).
   *
   * `participandoDoRanking` e uma SUBTRACAO, nao uma contagem de linhas
   * ACCEPTED: no engajamento a ausencia de `ConsentRecord` significa que o
   * aluno PARTICIPA (INV-154, regime opt-out do ADR-046). Contar linhas
   * daria quase zero numa academia inteira -- o oposto da verdade.
   */
  async indicadores(tenantId: string): Promise<IndicadoresDeEngajamento> {
    const [alunosAtivos, optOut, apelidosPendentes, apelidosOcultos, contestacoesAbertas] =
      await Promise.all([
        this.db.student.count({ where: { tenantId, status: 'ACTIVE' } }),
        // So conta o opt-out de quem esta ATIVO: aluno inativo ja nao aparece
        // em exposicao nenhuma (INV-155), e conta-lo aqui faria a soma de
        // participantes + opt-out passar do total de ativos.
        this.db.consentRecord.count({
          where: {
            tenantId,
            document: { type: 'RANKING' },
            decision: 'REFUSED',
            supersededAt: null,
            student: { status: 'ACTIVE' },
          },
        }),
        this.db.publicProfile.count({ where: { tenantId, status: 'PENDING' } }),
        this.db.publicProfile.count({ where: { tenantId, status: 'HIDDEN' } }),
        this.db.engagementDispute.count({ where: { tenantId, status: 'ABERTA' } }),
      ]);

    return {
      alunosAtivos,
      participandoDoRanking: alunosAtivos - optOut,
      optOut,
      apelidosPendentes,
      apelidosOcultos,
      contestacoesAbertas,
    };
  }

  async obterConfiguracao(tenantId: string): Promise<ConfiguracaoDeEngajamento> {
    const tenant = await this.db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        engagementRankingEnabled: true,
        engagementChallengesEnabled: true,
        engagementAchievementsEnabled: true,
        engagementCorrectionLimitPoints: true,
      },
    });

    return {
      rankingEnabled: tenant.engagementRankingEnabled,
      challengesEnabled: tenant.engagementChallengesEnabled,
      achievementsEnabled: tenant.engagementAchievementsEnabled,
      correctionLimitPoints: tenant.engagementCorrectionLimitPoints,
    };
  }

  /**
   * Grava so o que veio.
   *
   * Parcial de proposito: a tela envia a flag que o operador mexeu, e mandar
   * o objeto inteiro faria duas abas abertas sobrescreverem uma a decisao da
   * outra em campos que nenhuma das duas tocou.
   */
  async salvarConfiguracao(
    tenantId: string,
    entrada: Partial<ConfiguracaoDeEngajamento>,
  ): Promise<ConfiguracaoDeEngajamento> {
    await this.db.tenant.update({
      where: { id: tenantId },
      data: {
        ...(entrada.rankingEnabled !== undefined
          ? { engagementRankingEnabled: entrada.rankingEnabled }
          : {}),
        ...(entrada.challengesEnabled !== undefined
          ? { engagementChallengesEnabled: entrada.challengesEnabled }
          : {}),
        ...(entrada.achievementsEnabled !== undefined
          ? { engagementAchievementsEnabled: entrada.achievementsEnabled }
          : {}),
        // `!== undefined` e nao truthy: `null` (sem teto) e `0` (ninguem
        // corrige) sao valores legitimos e distintos entre si.
        ...(entrada.correctionLimitPoints !== undefined
          ? { engagementCorrectionLimitPoints: entrada.correctionLimitPoints }
          : {}),
      },
    });

    return this.obterConfiguracao(tenantId);
  }
}

/** Converte a linha do Prisma para a forma que o service consome. */
function paraContestacao(linha: {
  id: string;
  studentId: string;
  subject: string;
  descricao: string;
  status: string;
  resolucao: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
}): ContestacaoGravada {
  return {
    id: linha.id,
    studentId: linha.studentId,
    subject: linha.subject as AssuntoDaContestacao,
    descricao: linha.descricao,
    status: linha.status as StatusDaContestacao,
    resolucao: linha.resolucao,
    resolvedAt: linha.resolvedAt,
    createdAt: linha.createdAt,
  };
}

/**
 * O nome do indice esta em `erro.meta.driverAdapterError.cause.originalMessage`
 * (texto livre do Postgres), confirmado contra Postgres real -- mesmo
 * caminho documentado em `assessment.repository.ts` (`violaIndiceDeOrigem`).
 * `erro.message` (o texto formatado pelo Prisma) e fallback: `create`/`upsert`
 * citam o NOME do indice ali, mas `updateMany` (usado em `moderarPerfil`)
 * cita os CAMPOS em vez do nome -- o wording muda conforme a operacao, entao
 * o fallback casa os dois formatos.
 */
function mensagemOriginalDoDriver(erro: Prisma.PrismaClientKnownRequestError): string | null {
  const meta: unknown = erro.meta;
  if (meta === null || typeof meta !== 'object') return null;

  const driverError: unknown = (meta as Record<string, unknown>)['driverAdapterError'];
  if (driverError === null || typeof driverError !== 'object') return null;

  const cause: unknown = (driverError as Record<string, unknown>)['cause'];
  if (cause === null || typeof cause !== 'object') return null;

  const mensagem: unknown = (cause as Record<string, unknown>)['originalMessage'];
  return typeof mensagem === 'string' ? mensagem : null;
}

/** Campos do indice parcial, na forma como `updateMany` relata a colisao no
 * `erro.message` formatado (entre crases, separados por virgula) -- so usado
 * no fallback, quando `meta` estruturado nao trouxer o nome do indice. */
const CAMPOS_DO_INDICE_ALIAS_APROVADO = '`tenant_id`, `alias_normalized`';

/**
 * Colisao de alias aprovado dispara erro do Postgres no indice parcial.
 *
 * Prisma 7 + adapter-pg NAO popula `error.meta.target` como versoes
 * anteriores documentavam (memoria prisma7-adapter-pg-sem-meta-target) --
 * mas populam `error.meta.driverAdapterError.cause.originalMessage`, que
 * carrega o nome do indice em texto livre. Tenta esse caminho primeiro;
 * so cai para casar `erro.message` se `meta` nao trouxer nada usavel.
 */
function traduzirErroDeColisao(erro: unknown): unknown {
  if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
    const doMeta = mensagemOriginalDoDriver(erro);
    const mensagem = doMeta ?? String(erro.message ?? '');

    if (
      mensagem.includes(INDICE_ALIAS_APROVADO_UNICO) ||
      mensagem.includes(CAMPOS_DO_INDICE_ALIAS_APROVADO)
    ) {
      return new ConflictException({
        code: 'ALIAS_JA_APROVADO_PARA_OUTRO_ALUNO',
        message: 'Este apelido ja foi aprovado para outro aluno',
      });
    }
  }

  return erro;
}

/**
 * Filtro de unidade, atravessando a relacao com o aluno.
 *
 * `'ALL'` devolve objeto vazio -- espalhar `{}` num `where` do Prisma nao
 * acrescenta condicao, entao quem tem o tenant inteiro ve tudo sem ramo
 * especial no chamador.
 */
function filtroDeUnidade(escopo: EscopoDeUnidade) {
  if (escopo === 'ALL') return {};

  return { student: { gymUnitId: { in: [...escopo] } } };
}
