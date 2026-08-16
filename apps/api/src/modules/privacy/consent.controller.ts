import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { StudentRepository } from '../students/student.repository.js';
import { ConsentRepository } from './consent.repository.js';
import {
  avaliarConsentimento,
  calcularIdadeEmAnos,
  sujeitoExigido,
} from './domain/consentimento.js';

const esquemaDeDecisao = z
  .object({
    decision: z.enum(['ACCEPTED', 'REFUSED']),
    /**
     * Dados do responsavel legal. Obrigatorios quando o aluno e menor
     * (INV-143) -- a validacao cruzada acontece no controller, porque so ali
     * se sabe a idade do aluno.
     */
    guardianName: z.string().min(2).max(160).optional(),
    guardianRelation: z.string().min(2).max(40).optional(),
    /** Canal e comprovante. NUNCA imagem ou template. */
    evidence: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const esquemaDeDocumento = z
  .object({
    version: z.number().int().positive(),
    purpose: z.string().min(10).max(500),
    content: z.string().min(50),
  })
  .strict();

interface DocumentoDto {
  id: string;
  version: number;
  purpose: string;
  content: string;
  contentSha256: string;
  effectiveFrom: string;
}

interface DecisaoDto {
  id: string;
  decision: string;
  subjectKind: string;
  documentVersion: number;
  /** A biometria pode ser cadastrada agora? */
  allowsBiometricEnrollment: boolean;
  /** Codigo estavel quando nao permite. */
  blockedReason: string | null;
}

@Controller('api/v1')
export class ConsentController {
  constructor(
    private readonly consentimentos: ConsentRepository,
    private readonly alunos: StudentRepository,
    private readonly contexto: TenantContextService,
  ) {}

  /** Termo vigente, para a tela exibir antes de pedir a decisao. */
  @Get('consent-documents/biometric/current')
  @RequirePermissions('consent.read')
  async documentoVigente(): Promise<DocumentoDto> {
    const documento = await this.consentimentos.encontrarDocumentoVigente(
      this.contexto.require(),
      'BIOMETRIC',
      new Date(),
    );

    if (!documento) throw new NotFoundException({ code: 'CONSENT_DOCUMENT_NOT_FOUND' });

    return {
      id: documento.id,
      version: documento.version,
      purpose: documento.purpose,
      content: documento.content,
      contentSha256: documento.contentSha256,
      effectiveFrom: documento.effectiveFrom.toISOString(),
    };
  }

  /**
   * Publica versao nova do termo.
   *
   * O SHA-256 e calculado AQUI, sobre o texto recebido -- aceitar o hash do
   * cliente deixaria a prova valer o que o cliente disser que ela vale.
   */
  @Post('consent-documents/biometric')
  @RequirePermissions('consent.manage')
  async publicarDocumento(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<DocumentoDto> {
    const dados = esquemaDeDocumento.parse(corpo);
    const agora = new Date();

    const documento = await this.consentimentos.publicarDocumento(
      this.contexto.require(),
      {
        type: 'BIOMETRIC',
        version: dados.version,
        purpose: dados.purpose,
        content: dados.content,
        contentSha256: createHash('sha256').update(dados.content, 'utf8').digest('hex'),
        effectiveFrom: agora,
      },
      requisicao.correlationId ?? 'sem-correlacao',
      agora,
    );

    return {
      id: documento.id,
      version: documento.version,
      purpose: documento.purpose,
      content: documento.content,
      contentSha256: documento.contentSha256,
      effectiveFrom: documento.effectiveFrom.toISOString(),
    };
  }

  /** Estado do consentimento do aluno, e se ele autoriza biometria agora. */
  @Get('students/:id/biometric-consent')
  @RequirePermissions('consent.read')
  async consultar(@Param('id') studentId: string): Promise<DecisaoDto | null> {
    const contexto = this.contexto.require();

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const decisao = await this.consentimentos.encontrarDecisaoVigente(
      contexto,
      studentId,
      'BIOMETRIC',
    );

    if (!decisao) return null;

    const avaliacao = avaliarConsentimento(
      decisao,
      calcularIdadeEmAnos(aluno.birthDate, new Date()),
    );

    return {
      id: decisao.id,
      decision: decisao.decision,
      subjectKind: decisao.subjectKind,
      documentVersion: decisao.documentVersion,
      allowsBiometricEnrollment: avaliacao.valido,
      blockedReason: avaliacao.valido ? null : avaliacao.motivo,
    };
  }

  /**
   * Registra a decisao do titular (ou do responsavel legal).
   *
   * RECUSAR NAO IMPEDE NADA fora da biometria (INV-017, INV-022b): o aluno
   * continua cadastrado e acessa por QR, cartao, PIN ou liberacao assistida.
   * E o que torna o consentimento livre em vez de coacao comercial.
   */
  @Post('students/:id/biometric-consent')
  @RequirePermissions('consent.manage')
  async registrar(
    @Param('id') studentId: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<DecisaoDto> {
    const dados = esquemaDeDecisao.parse(corpo);
    const contexto = this.contexto.require();
    const agora = new Date();

    const aluno = await this.alunos.encontrar(contexto, studentId);
    if (!aluno) throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });

    const documento = await this.consentimentos.encontrarDocumentoVigente(
      contexto,
      'BIOMETRIC',
      agora,
    );

    if (!documento) throw new NotFoundException({ code: 'CONSENT_DOCUMENT_NOT_FOUND' });

    const idade = calcularIdadeEmAnos(aluno.birthDate, agora);
    const sujeito = sujeitoExigido(idade);

    // Menor de 18 exige responsavel legal identificado (INV-143). Sem nome e
    // parentesco, o vinculo nao e comprovavel -- e a exigencia do ADR-008 e
    // justamente que ele seja.
    if (sujeito === 'LEGAL_GUARDIAN' && (!dados.guardianName || !dados.guardianRelation)) {
      throw new BadRequestException({ code: 'CONSENT_GUARDIAN_REQUIRED' });
    }

    // Responsavel informado para aluno maior de idade: recusa em vez de
    // ignorar. Aceitar em silencio gravaria uma decisao que atribui a outra
    // pessoa o consentimento de quem ja decide por si.
    if (sujeito === 'STUDENT' && (dados.guardianName ?? dados.guardianRelation)) {
      throw new BadRequestException({ code: 'CONSENT_GUARDIAN_NOT_ALLOWED' });
    }

    const registro = await this.consentimentos.registrarDecisao(
      contexto,
      {
        studentId,
        documentId: documento.id,
        decision: dados.decision,
        subjectKind: sujeito,
        guardianName: dados.guardianName,
        guardianRelation: dados.guardianRelation,
        // Congelada na decisao: e o que permite saber, depois, que o
        // consentimento foi dado por responsavel quando o aluno tinha 16.
        subjectAgeYears: idade,
        actorIp: requisicao.ip,
        actorUserAgent: requisicao.get('user-agent'),
        evidence: dados.evidence,
      },
      requisicao.correlationId ?? 'sem-correlacao',
      agora,
    );

    const avaliacao = avaliarConsentimento(
      {
        decision: registro.decision,
        subjectKind: registro.subjectKind,
        subjectAgeYears: registro.subjectAgeYears,
        supersededAt: registro.supersededAt,
        documentRetiredAt: documento.retiredAt,
      },
      idade,
    );

    return {
      id: registro.id,
      decision: registro.decision,
      subjectKind: registro.subjectKind,
      documentVersion: documento.version,
      allowsBiometricEnrollment: avaliacao.valido,
      blockedReason: avaliacao.valido ? null : avaliacao.motivo,
    };
  }
}
