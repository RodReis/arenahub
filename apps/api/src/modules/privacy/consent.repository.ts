import { Injectable } from '@nestjs/common';
import { Prisma, type ConsentDocument, type ConsentRecord } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { DecisaoRegistrada, SujeitoDoConsentimento } from './domain/consentimento.js';

export interface DadosDeDecisao {
  studentId: string;
  documentId: string;
  decision: 'ACCEPTED' | 'REFUSED';
  subjectKind: SujeitoDoConsentimento;
  guardianName?: string | undefined;
  guardianRelation?: string | undefined;
  subjectAgeYears: number;
  actorIp?: string | undefined;
  actorUserAgent?: string | undefined;
  evidence?: Record<string, unknown> | undefined;
}

/** Decisao vigente somada ao estado do documento que ela aponta. */
export type DecisaoVigente = DecisaoRegistrada & { id: string; documentVersion: number };

/**
 * Acesso a consentimento.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 */
@Injectable()
export class ConsentRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Versao vigente do termo para o tenant, na data de referencia.
   *
   * Cai para o documento GLOBAL (`tenantId = null`) quando a academia nao
   * publicou o proprio: o ArenaHub fornece o termo padrao, e a academia
   * controladora pode substitui-lo.
   */
  async encontrarDocumentoVigente(
    contexto: TenantContext,
    tipo: 'BIOMETRIC',
    agora: Date,
  ): Promise<ConsentDocument | null> {
    const candidatos = await this.db.consentDocument.findMany({
      where: {
        type: tipo,
        effectiveFrom: { lte: agora },
        retiredAt: null,
        OR: [{ tenantId: contexto.tenantId }, { tenantId: null }],
      },
      orderBy: [{ version: 'desc' }],
    });

    // O do tenant vence o global, mesmo com versao menor: e o termo que
    // aquela academia decidiu usar.
    return (
      candidatos.find((doc: ConsentDocument) => doc.tenantId === contexto.tenantId) ??
      candidatos[0] ??
      null
    );
  }

  /**
   * Decisao mais recente do aluno para o tipo, junto do estado do documento.
   *
   * Le a decisao e o `retiredAt` do documento numa consulta so: a regra pura
   * precisa dos dois para decidir, e duas idas ao banco abririam janela para
   * o documento ser aposentado no meio.
   */
  async encontrarDecisaoVigente(
    contexto: TenantContext,
    studentId: string,
    tipo: 'BIOMETRIC',
  ): Promise<DecisaoVigente | null> {
    const registro = await this.db.consentRecord.findFirst({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        document: { type: tipo },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      include: { document: { select: { retiredAt: true, version: true } } },
    });

    if (!registro) return null;

    return {
      id: registro.id,
      decision: registro.decision,
      subjectKind: registro.subjectKind,
      subjectAgeYears: registro.subjectAgeYears,
      supersededAt: registro.supersededAt,
      documentRetiredAt: registro.document.retiredAt,
      documentVersion: registro.document.version,
    };
  }

  /**
   * Registra a decisao e marca a anterior como substituida, NUMA TRANSACAO.
   *
   * A decisao anterior nao e reescrita -- ganha `supersededAt`. Apagar ou
   * alterar a decisao passada destruiria a prova de que houve consentimento
   * no periodo em que a biometria funcionou (INV-021).
   */
  async registrarDecisao(
    contexto: TenantContext,
    dados: DadosDeDecisao,
    correlationId: string,
    agora: Date,
  ): Promise<ConsentRecord> {
    return this.db.$transaction(async (tx) => {
      await tx.consentRecord.updateMany({
        where: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          documentId: dados.documentId,
          supersededAt: null,
        },
        data: { supersededAt: agora },
      });

      const registro = await tx.consentRecord.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          documentId: dados.documentId,
          decision: dados.decision,
          subjectKind: dados.subjectKind,
          guardianName: dados.guardianName ?? null,
          guardianRelation: dados.guardianRelation ?? null,
          subjectAgeYears: dados.subjectAgeYears,
          actorId: contexto.actorId,
          actorIp: dados.actorIp ?? null,
          actorUserAgent: dados.actorUserAgent ?? null,
          // `JsonNull`, e nao `null` cru: a coluna e `Json?`, e o Prisma
          // distingue "campo ausente" de "JSON nulo gravado".
          evidence: dados.evidence ? (dados.evidence as object) : Prisma.JsonNull,
          occurredAt: agora,
        },
      });

      await tx.studentTimelineEvent.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: dados.studentId,
          type:
            dados.decision === 'ACCEPTED'
              ? 'BIOMETRIC_CONSENT_ACCEPTED'
              : 'BIOMETRIC_CONSENT_REFUSED',
          actorType: 'USER',
          actorId: contexto.actorId,
          correlationId,
          // Sem PII: nem nome do responsavel, nem evidencia.
          payload: { decision: dados.decision, subjectKind: dados.subjectKind },
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action:
            dados.decision === 'ACCEPTED' ? 'consent.accepted' : 'consent.refused',
          target: 'consent_record',
          targetId: registro.id,
          correlationId,
          metadata: { subjectKind: dados.subjectKind },
        },
      });

      return registro;
    });
  }

  /**
   * Publica versao nova do termo e aposenta a anterior, NUMA TRANSACAO.
   *
   * Aposentar em vez de apagar: ha consentimento vivo apontando para a versao
   * antiga, e a prova precisa continuar legivel.
   */
  async publicarDocumento(
    contexto: TenantContext,
    dados: {
      type: 'BIOMETRIC';
      version: number;
      purpose: string;
      content: string;
      contentSha256: string;
      effectiveFrom: Date;
    },
    correlationId: string,
    agora: Date,
  ): Promise<ConsentDocument> {
    return this.db.$transaction(async (tx) => {
      await tx.consentDocument.updateMany({
        where: { tenantId: contexto.tenantId, type: dados.type, retiredAt: null },
        data: { retiredAt: agora },
      });

      const documento = await tx.consentDocument.create({
        data: { tenantId: contexto.tenantId, ...dados },
      });

      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'consent.document_published',
          target: 'consent_document',
          targetId: documento.id,
          correlationId,
          metadata: { type: dados.type, version: dados.version },
        },
      });

      return documento;
    });
  }

  /** Politica de privacidade do tenant, com os padroes quando nao ha linha. */
  async lerPolitica(
    contexto: TenantContext,
  ): Promise<{ purgeAfterDays: number; accessLogRetentionDays: number }> {
    const politica = await this.db.tenantPrivacySettings.findUnique({
      where: { tenantId: contexto.tenantId },
    });

    // Padroes do INV-142 quando a academia nao configurou: 30 dias de
    // expurgo, 5 anos de log.
    return {
      purgeAfterDays: politica?.purgeAfterDays ?? 30,
      accessLogRetentionDays: politica?.accessLogRetentionDays ?? 1825,
    };
  }
}
