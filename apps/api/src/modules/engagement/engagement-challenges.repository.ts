import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { LimiteDoTemplate, StatusDaParticipacao, StatusDoDesafio } from './domain/desafio.js';

/** Token de injecao da porta -- o modulo Nest liga isto ao repositorio Prisma. */
export const PORTA_DE_DESAFIOS = Symbol('PortaDeDesafios');

/** Uma versao vigente de template, com o teto que o `M5-BR-011` exige. */
export interface TemplateVigente {
  id: string;
  code: string;
  version: number;
  name: string;
  metric: 'SESSOES_NA_JANELA';
  limite: LimiteDoTemplate;
}

/** O que o service precisa saber de um desafio para decidir. */
export interface DesafioPersistido {
  id: string;
  status: StatusDoDesafio;
  /** `AAAA-MM-DD` no fuso da unidade. */
  startsOn: string;
  endsOn: string;
  targetValue: number;
  title: string;
  gymUnitId: string | null;
}

export interface ParticipacaoPersistida {
  id: string;
  status: StatusDaParticipacao;
}

export interface DesafioParaCriar {
  templateVersionId: string;
  gymUnitId: string | null;
  title: string;
  targetValue: number;
  startsOn: string;
  endsOn: string;
}

/** Aviso a gravar -- idempotente pela unique `(desafio, aluno, tipo)`. */
export interface AvisoParaGravar {
  challengeId: string;
  studentId: string;
  kind: 'DISPONIVEL' | 'CONCLUIDO' | 'ENCERRADO_SEM_META';
}

export interface AvisoDoAluno {
  id: string;
  challengeId: string;
  challengeTitle: string;
  kind: 'DISPONIVEL' | 'CONCLUIDO' | 'ENCERRADO_SEM_META';
  createdAt: Date;
  readAt: Date | null;
}

/**
 * Porta de desafios.
 *
 * Toda operacao recebe `TenantContext` -- Regra de arquitetura 2: o tenant vem
 * da identidade autenticada, nunca do corpo da requisicao.
 */
export interface PortaDeDesafios {
  templateVigentePorId(ctx: TenantContext, id: string): Promise<TemplateVigente | null>;
  templatesVigentes(ctx: TenantContext, agora: Date): Promise<TemplateVigente[]>;

  criarDesafio(ctx: TenantContext, dados: DesafioParaCriar): Promise<DesafioPersistido>;
  desafioPorId(ctx: TenantContext, id: string): Promise<DesafioPersistido | null>;
  ativarDesafio(ctx: TenantContext, id: string): Promise<void>;

  /** Desafios abertos a inscricao para a unidade do aluno (ou do tenant inteiro). */
  desafiosAbertos(
    ctx: TenantContext,
    gymUnitId: string | null,
    hoje: string,
  ): Promise<DesafioPersistido[]>;

  participacao(
    ctx: TenantContext,
    challengeId: string,
    studentId: string,
  ): Promise<ParticipacaoPersistida | null>;

  /**
   * Inscreve o aluno. Reusa a linha de quem tinha saido (`LEFT` -> `JOINED`)
   * em vez de criar a segunda -- a unique `(challenge, student)` proibe duas.
   */
  inscrever(ctx: TenantContext, challengeId: string, studentId: string): Promise<void>;
  sair(ctx: TenantContext, challengeId: string, studentId: string): Promise<void>;

  /**
   * Dias locais em que o aluno treinou dentro da janela.
   *
   * Le `StudentAttendanceSession` (F24) -- a mesma projecao que o XP usa. Nao
   * ha tabela de progresso: materializa-la criaria segunda fonte de verdade
   * com rebuild proprio, capaz de divergir. Mesma decisao da F32.
   */
  diasTreinadosNaJanela(
    ctx: TenantContext,
    studentId: string,
    janela: { inicio: string; fim: string; gymUnitId: string | null },
  ): Promise<string[]>;

  participantesEmCurso(
    ctx: TenantContext,
    challengeId: string,
  ): Promise<{ studentId: string; participantId: string }[]>;

  /**
   * Desafios AINDA `ACTIVE` cuja janela ja fechou e em que ESTE aluno segue
   * `JOINED` -- o que a apuracao sob demanda do totem precisa encerrar.
   *
   * Filtra pelo aluno de proposito: varrer o tenant inteiro a cada abertura
   * de totem faria o custo crescer com o numero de desafios da academia.
   */
  desafiosVencidosDoAluno(
    ctx: TenantContext,
    studentId: string,
    hoje: string,
  ): Promise<{ id: string }[]>;

  concluirParticipacao(ctx: TenantContext, participantId: string, quando: Date): Promise<void>;
  reprovarParticipacao(ctx: TenantContext, participantId: string): Promise<void>;
  fecharDesafio(ctx: TenantContext, challengeId: string, quando: Date): Promise<void>;

  /** Idempotente: replay do encerramento nao duplica aviso. */
  gravarAvisos(ctx: TenantContext, avisos: AvisoParaGravar[]): Promise<void>;

  avisosDoAluno(ctx: TenantContext, studentId: string): Promise<AvisoDoAluno[]>;
  marcarAvisosComoLidos(ctx: TenantContext, studentId: string, ids: string[]): Promise<void>;
}

/** `AAAA-MM-DD` a partir de um `@db.Date`, sem reconverter fuso. */
function paraDiaLocal(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * `AAAA-MM-DD` -> `Date` na meia-noite UTC.
 *
 * A coluna e `@db.Date`: o Postgres guarda o dia, sem instante. Fixar UTC na
 * ida e fatiar o ISO na volta mantem o par simetrico -- usar o fuso do
 * processo aqui faria o dia gravado depender de onde a API roda.
 */
function paraDataDoBanco(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

@Injectable()
export class EngagementChallengesRepository implements PortaDeDesafios {
  constructor(private readonly prisma: PrismaService) {}

  async templateVigentePorId(ctx: TenantContext, id: string): Promise<TemplateVigente | null> {
    const linha = await this.prisma.challengeTemplateVersion.findFirst({
      where: { id, tenantId: ctx.tenantId, effectiveTo: null },
    });

    return linha
      ? {
          id: linha.id,
          code: linha.code,
          version: linha.version,
          name: linha.name,
          metric: linha.metric,
          limite: {
            maxSessoesPorSemana: linha.maxSessionsPerWeek,
            maxJanelaEmDias: linha.maxWindowDays,
          },
        }
      : null;
  }

  async templatesVigentes(ctx: TenantContext, agora: Date): Promise<TemplateVigente[]> {
    const linhas = await this.prisma.challengeTemplateVersion.findMany({
      where: { tenantId: ctx.tenantId, effectiveFrom: { lte: agora }, effectiveTo: null },
      orderBy: [{ code: 'asc' }, { version: 'desc' }],
    });

    return linhas.map((l) => ({
      id: l.id,
      code: l.code,
      version: l.version,
      name: l.name,
      metric: l.metric,
      limite: { maxSessoesPorSemana: l.maxSessionsPerWeek, maxJanelaEmDias: l.maxWindowDays },
    }));
  }

  async criarDesafio(ctx: TenantContext, dados: DesafioParaCriar): Promise<DesafioPersistido> {
    const linha = await this.prisma.challenge.create({
      data: {
        tenantId: ctx.tenantId,
        templateVersionId: dados.templateVersionId,
        gymUnitId: dados.gymUnitId,
        title: dados.title,
        targetValue: dados.targetValue,
        startsOn: paraDataDoBanco(dados.startsOn),
        endsOn: paraDataDoBanco(dados.endsOn),
      },
    });

    return this.paraDesafio(linha);
  }

  async desafioPorId(ctx: TenantContext, id: string): Promise<DesafioPersistido | null> {
    const linha = await this.prisma.challenge.findFirst({
      where: { id, tenantId: ctx.tenantId },
    });

    return linha ? this.paraDesafio(linha) : null;
  }

  async ativarDesafio(ctx: TenantContext, id: string): Promise<void> {
    await this.prisma.challenge.updateMany({
      where: { id, tenantId: ctx.tenantId, status: 'DRAFT' },
      data: { status: 'ACTIVE' },
    });
  }

  async desafiosAbertos(
    ctx: TenantContext,
    gymUnitId: string | null,
    hoje: string,
  ): Promise<DesafioPersistido[]> {
    const dia = paraDataDoBanco(hoje);

    const linhas = await this.prisma.challenge.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        startsOn: { lte: dia },
        endsOn: { gte: dia },
        // `null` no desafio = vale para o tenant inteiro, entao entra sempre.
        OR: [{ gymUnitId: null }, ...(gymUnitId ? [{ gymUnitId }] : [])],
      },
      orderBy: [{ endsOn: 'asc' }, { id: 'asc' }],
    });

    return linhas.map((l) => this.paraDesafio(l));
  }

  async participacao(
    ctx: TenantContext,
    challengeId: string,
    studentId: string,
  ): Promise<ParticipacaoPersistida | null> {
    const linha = await this.prisma.challengeParticipant.findFirst({
      where: { tenantId: ctx.tenantId, challengeId, studentId },
    });

    return linha ? { id: linha.id, status: linha.status } : null;
  }

  async inscrever(ctx: TenantContext, challengeId: string, studentId: string): Promise<void> {
    /*
     * `upsert` na unique `(challenge, student)`, nao `create`.
     *
     * Quem saiu volta na MESMA linha (`LEFT` -> `JOINED`): a unique proibe a
     * segunda, e um `create` cego quebraria a reinscricao com erro de
     * constraint. Idempotencia em INDICE, nao em `if` que le antes de
     * escrever -- essa guarda perde a corrida por construcao.
     */
    await this.prisma.challengeParticipant.upsert({
      where: { challengeId_studentId: { challengeId, studentId } },
      create: { tenantId: ctx.tenantId, challengeId, studentId, status: 'JOINED' },
      update: { status: 'JOINED', leftAt: null },
    });
  }

  async sair(ctx: TenantContext, challengeId: string, studentId: string): Promise<void> {
    // A linha NAO e apagada: `M5-FR-014` manda manter o historico.
    await this.prisma.challengeParticipant.updateMany({
      where: { tenantId: ctx.tenantId, challengeId, studentId, status: 'JOINED' },
      data: { status: 'LEFT', leftAt: new Date() },
    });
  }

  async diasTreinadosNaJanela(
    ctx: TenantContext,
    studentId: string,
    janela: { inicio: string; fim: string; gymUnitId: string | null },
  ): Promise<string[]> {
    const linhas = await this.prisma.studentAttendanceSession.findMany({
      where: {
        tenantId: ctx.tenantId,
        studentId,
        sessionDate: { gte: paraDataDoBanco(janela.inicio), lte: paraDataDoBanco(janela.fim) },
        ...(janela.gymUnitId ? { gymUnitId: janela.gymUnitId } : {}),
      },
      select: { sessionDate: true },
    });

    return linhas.map((l) => paraDiaLocal(l.sessionDate));
  }

  async participantesEmCurso(
    ctx: TenantContext,
    challengeId: string,
  ): Promise<{ studentId: string; participantId: string }[]> {
    const linhas = await this.prisma.challengeParticipant.findMany({
      where: { tenantId: ctx.tenantId, challengeId, status: 'JOINED' },
      select: { id: true, studentId: true },
      orderBy: { id: 'asc' },
    });

    return linhas.map((l) => ({ studentId: l.studentId, participantId: l.id }));
  }

  async desafiosVencidosDoAluno(
    ctx: TenantContext,
    studentId: string,
    hoje: string,
  ): Promise<{ id: string }[]> {
    const linhas = await this.prisma.challenge.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'ACTIVE',
        endsOn: { lt: paraDataDoBanco(hoje) },
        participants: { some: { studentId, status: 'JOINED' } },
      },
      select: { id: true },
    });

    return linhas;
  }

  async concluirParticipacao(
    ctx: TenantContext,
    participantId: string,
    quando: Date,
  ): Promise<void> {
    await this.prisma.challengeParticipant.updateMany({
      where: { id: participantId, tenantId: ctx.tenantId, status: 'JOINED' },
      data: { status: 'COMPLETED', completedAt: quando },
    });
  }

  async reprovarParticipacao(ctx: TenantContext, participantId: string): Promise<void> {
    await this.prisma.challengeParticipant.updateMany({
      where: { id: participantId, tenantId: ctx.tenantId, status: 'JOINED' },
      data: { status: 'FAILED' },
    });
  }

  async fecharDesafio(ctx: TenantContext, challengeId: string, quando: Date): Promise<void> {
    await this.prisma.challenge.updateMany({
      where: { id: challengeId, tenantId: ctx.tenantId, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: quando },
    });
  }

  async gravarAvisos(ctx: TenantContext, avisos: AvisoParaGravar[]): Promise<void> {
    if (avisos.length === 0) return;

    /*
     * `skipDuplicates`: a unique `(challenge, student, kind)` e quem garante
     * um aviso por tipo. Reprocessar o encerramento nao pode fazer o aluno
     * abrir o totem com a mesma mensagem N vezes.
     */
    await this.prisma.challengeNotice.createMany({
      data: avisos.map((a) => ({
        tenantId: ctx.tenantId,
        challengeId: a.challengeId,
        studentId: a.studentId,
        kind: a.kind,
      })),
      skipDuplicates: true,
    });
  }

  async avisosDoAluno(ctx: TenantContext, studentId: string): Promise<AvisoDoAluno[]> {
    const linhas = await this.prisma.challengeNotice.findMany({
      where: { tenantId: ctx.tenantId, studentId },
      include: { challenge: { select: { title: true } } },
      // `id` desempata: `createdAt` de dois avisos do mesmo lote colide, e
      // ordem instavel faria a lista embaralhar entre dois carregamentos.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return linhas.map((l) => ({
      id: l.id,
      challengeId: l.challengeId,
      challengeTitle: l.challenge.title,
      kind: l.kind,
      createdAt: l.createdAt,
      readAt: l.readAt,
    }));
  }

  async marcarAvisosComoLidos(
    ctx: TenantContext,
    studentId: string,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) return;

    await this.prisma.challengeNotice.updateMany({
      where: { tenantId: ctx.tenantId, studentId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
  }

  private paraDesafio(linha: {
    id: string;
    status: StatusDoDesafio;
    startsOn: Date;
    endsOn: Date;
    targetValue: number;
    title: string;
    gymUnitId: string | null;
  }): DesafioPersistido {
    return {
      id: linha.id,
      status: linha.status,
      startsOn: paraDiaLocal(linha.startsOn),
      endsOn: paraDiaLocal(linha.endsOn),
      targetValue: linha.targetValue,
      title: linha.title,
      gymUnitId: linha.gymUnitId,
    };
  }
}
