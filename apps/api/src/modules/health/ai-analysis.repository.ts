import { Injectable } from '@nestjs/common';
import { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { AssinaturaRegistrada } from './domain/aceite-da-analise.js';
import type { SaidaDaAnalise } from './domain/saida-da-analise.js';
import type { SnapshotDeAnalise } from './domain/snapshot-de-analise.js';

/**
 * Analises por IA e o aceite que as autoriza (F21).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 */

export interface DadosDaAnalise {
  studentId: string;
  status: 'PUBLISHED' | 'REJECTED' | 'FAILED';
  analysisRef: string;
  snapshot: SnapshotDeAnalise;
  output: SaidaDaAnalise | null;
  rejectionReason: string | null;
  rejectionDetail: string | null;
  promptVersionId: string;
  model: string;
  costMicros: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  requestedByUserId: string;
}

@Injectable()
export class AiAnalysisRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * As assinaturas do aceite da F21 -- as DUAS, do aluno e do profissional.
   *
   * Traz todas, inclusive as substituidas: a regra pura decide qual vale, e
   * filtrar aqui esconderia da regra o historico que ela usa para distinguir
   * "nunca consentiu" de "consentiu e revogou".
   */
  async assinaturasDoAceite(
    contexto: TenantContext,
    studentId: string,
  ): Promise<AssinaturaRegistrada[]> {
    const registros = await this.db.consentRecord.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        document: { type: 'AI_ANALYSIS' },
      },
      include: { document: { select: { retiredAt: true } } },
      orderBy: [{ occurredAt: 'desc' }],
    });

    return registros.map((registro) => ({
      papel: registro.signerRole === 'PROFESSIONAL_ENDORSEMENT' ? 'PROFESSIONAL' : 'STUDENT',
      decisao: registro.decision,
      em: registro.occurredAt,
      substituidaEm: registro.supersededAt,
      documentoAposentadoEm: registro.document.retiredAt,
      // O papel do profissional nao tem sujeito: ele assina sempre por si.
      sujeito:
        registro.signerRole === 'PROFESSIONAL_ENDORSEMENT' ? null : registro.subjectKind,
    }));
  }

  /**
   * Registra uma assinatura, substituindo apenas a do MESMO PAPEL.
   *
   * ⚠️ ESTE E O PONTO QUE DIVERGE DA F8, E A DIVERGENCIA E O DESENHO.
   *
   * `ConsentRepository.registrarDecisao` marca como substituida TODA decisao
   * apagaria o consentimento do aluno -- e a autorizacao ficaria de pe com
   * uma assinatura so, que e exatamente o que o desenho de duas existe para
   * impedir. O `signerRole` no `where` e o que fecha isso.
   */
  async registrarAssinatura(
    contexto: TenantContext,
    dados: {
      studentId: string;
      documentId: string;
      papel: 'STUDENT_CONSENT' | 'PROFESSIONAL_ENDORSEMENT';
      decisao: 'ACCEPTED' | 'REFUSED';
      subjectKind: 'STUDENT' | 'LEGAL_GUARDIAN';
      subjectAgeYears: number;
      actorIp: string | null;
      actorUserAgent: string | null;
    },
    agora: Date,
  ): Promise<{ id: string }> {
    return this.db.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          documentId: dados.documentId,
          // O filtro que a F8 nao tem.
          signerRole: dados.papel,
          supersededAt: null,
        },
        data: { supersededAt: agora },
      });

      return tx.consentRecord.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          documentId: dados.documentId,
          decision: dados.decisao,
          signerRole: dados.papel,
          subjectKind: dados.subjectKind,
          subjectAgeYears: dados.subjectAgeYears,
          actorId: contexto.actorId,
          actorIp: dados.actorIp,
          actorUserAgent: dados.actorUserAgent,
          occurredAt: agora,
        },
        select: { id: true },
      });
    });
  }

  /**
   * A versao vigente do prompt, criando-a se ainda nao existir.
   *
   * `upsert` por nome: o prompt e do produto e nasce com o codigo, nao com um
   * seed que alguem pode esquecer de rodar. Se o texto mudar sem o nome
   * mudar, o `content` NAO e reescrito -- reescrever quebraria a
   * reprodutibilidade de toda analise ja publicada com aquela versao.
   */
  async versaoDePromptVigente(prompt: {
    name: string;
    content: string;
    contentSha256: string;
  }): Promise<string> {
    const versao = await this.db.aiPromptVersion.upsert({
      where: { name: prompt.name },
      create: {
        name: prompt.name,
        content: prompt.content,
        contentSha256: prompt.contentSha256,
      },
      update: {},
      select: { id: true },
    });

    return versao.id;
  }

  async registrar(
    contexto: TenantContext,
    dados: DadosDaAnalise,
  ): Promise<{ id: string }> {
    return this.db.aiAnalysis.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: dados.studentId,
        status: dados.status,
        analysisRef: dados.analysisRef,
        snapshot: dados.snapshot as unknown as Prisma.InputJsonObject,
        // O CAMPO E OMITIDO, e nao preenchido com `Prisma.JsonNull`: os dois
        // sao coisas diferentes no Postgres, e a distincao custou um 500
        // aqui. `JsonNull` grava o valor JSON `null` -- coluna PREENCHIDA com
        // um nulo de JSON --, enquanto a constraint
        // `ai_analyses_saida_so_em_publicada` exige `IS NULL` de COLUNA.
        // Omitir deixa a coluna de fato nula.
        //
        // Spread condicional e nao `: undefined` porque o projeto usa
        // `exactOptionalPropertyTypes`: ali "ausente" e "undefined" tambem
        // sao coisas diferentes, e o compilador recusa a segunda.
        //
        // A constraint pegou o defeito antes de qualquer analise rejeitada
        // conseguir ser gravada, que e exatamente o que ela existe para fazer.
        ...(dados.output
          ? { output: dados.output as unknown as Prisma.InputJsonObject }
          : {}),
        rejectionReason: dados.rejectionReason,
        rejectionDetail: dados.rejectionDetail,
        promptVersionId: dados.promptVersionId,
        model: dados.model,
        costMicros: dados.costMicros,
        latencyMs: dados.latencyMs,
        inputTokens: dados.inputTokens,
        outputTokens: dados.outputTokens,
        requestedByUserId: dados.requestedByUserId,
      },
      select: { id: true },
    });
  }

  /**
   * A ultima analise PUBLICADA -- o que totem e app consomem.
   *
   * Filtra por `PUBLISHED` no `where` e nao no codigo: uma analise rejeitada
   * nunca pode chegar a uma tela, e deixar o filtro para quem consome
   * significa que basta um consumidor esquecer para o texto recusado
   * aparecer.
   */
  async ultimaPublicada(
    contexto: TenantContext,
    studentId: string,
  ): Promise<{
    id: string;
    saida: SaidaDaAnalise;
    geradaEm: Date;
    model: string;
    promptVersion: string;
  } | null> {
    const linha = await this.db.aiAnalysis.findFirst({
      where: { tenantId: contexto.tenantId, studentId, status: 'PUBLISHED' },
      orderBy: { createdAt: 'desc' },
      // `model` e `promptVersion` saem daqui porque a tela do app os EXIGE: o
      // `AIDisclaimerProps` (`packages/ui`) pede as duas versoes ao lado do
      // aviso, e `M3-NFR-006` manda numero na tela ter origem conferivel.
      // Sem eles o app inventaria um rotulo, que e pior que nao mostrar.
      select: {
        id: true,
        output: true,
        createdAt: true,
        model: true,
        promptVersion: { select: { name: true } },
      },
    });

    if (linha === null || linha.output === null) return null;

    return {
      id: linha.id,
      saida: linha.output as unknown as SaidaDaAnalise,
      geradaEm: linha.createdAt,
      model: linha.model,
      promptVersion: linha.promptVersion.name,
    };
  }

  /**
   * Gasto acumulado do tenant no periodo -- o teto do `M3-NFR-005`.
   *
   * Soma TODAS as analises, inclusive rejeitadas e falhas: o provedor cobra
   * pela chamada, nao pelo resultado. Contar so as publicadas faria o teto
   * ser furado justamente quando o modelo esta errando muito.
   */
  async gastoNoPeriodo(
    contexto: TenantContext,
    desde: Date,
    ate: Date,
  ): Promise<number> {
    const soma = await this.db.aiAnalysis.aggregate({
      where: { tenantId: contexto.tenantId, createdAt: { gte: desde, lte: ate } },
      _sum: { costMicros: true },
    });

    return soma._sum.costMicros ?? 0;
  }
}
