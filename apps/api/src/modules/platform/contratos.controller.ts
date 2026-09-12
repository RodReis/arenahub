import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { PlatformContextService } from '../../common/platform/platform-context.service.js';
import { PlatformRoute } from '../../common/security/platform-route.decorator.js';
import { esquemaDePlanoSaas } from './dto/saas-plan.dto.js';
import {
  esquemaDeAssinaturaDeContrato,
  esquemaDeCriacaoDeContrato,
  esquemaDeDescarteDeContrato,
  esquemaDeEncerramentoDeContrato,
  esquemaDeValorDeIndice,
} from './dto/tenant-contract.dto.js';
import { IndexValueUseCase } from './index-value.use-case.js';
import { SaasPlanUseCase } from './saas-plan.use-case.js';
import { TenantContractUseCase } from './tenant-contract.use-case.js';

/**
 * O arquivo como o `FileInterceptor` o entrega -- mesma declaracao local do
 * `platform.controller.ts`, e pela mesma razao: sao tres campos, e
 * `@types/multer` traria uma dependencia inteira para descrever seis linhas.
 */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

/**
 * Teto do PDF assinado -- F70. MAIOR que o de identidade visual (1 MB): um
 * contrato digitalizado com duas paginas de assinatura passa de 1 MB com
 * facilidade, e recusar o upload do documento que a fatia existe para
 * guardar seria o proprio aceite falhando.
 */
const TAMANHO_MAXIMO_DO_CONTRATO_ASSINADO_BYTES = 10 * 1024 * 1024;

const ESQUEMA_DO_PLANO = {
  type: 'object',
  required: ['id', 'name', 'model', 'currency', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    model: { type: 'string', enum: ['PER_STUDENT', 'FIXED_MONTHLY'] },
    activeStudentPriceMinor: { type: 'integer', nullable: true },
    inactiveStudentPriceMinor: { type: 'integer', nullable: true },
    fixedPriceMinor: { type: 'integer', nullable: true },
    currency: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'ARCHIVED'] },
    mobileEnabled: { type: 'boolean' },
    kioskEnabled: { type: 'boolean' },
  },
};

const ESQUEMA_DO_CONTRATO = {
  type: 'object',
  required: ['id', 'tenantId', 'planId', 'model', 'currency', 'status'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    planId: { type: 'string', format: 'uuid' },
    model: { type: 'string', enum: ['PER_STUDENT', 'FIXED_MONTHLY'] },
    activeStudentPriceMinor: { type: 'integer', nullable: true },
    inactiveStudentPriceMinor: { type: 'integer', nullable: true },
    fixedPriceMinor: { type: 'integer', nullable: true },
    currency: { type: 'string' },
    indexCode: { type: 'string' },
    baseDate: { type: 'string', format: 'date-time' },
    anniversaryDay: { type: 'integer' },
    anniversaryMonth: { type: 'integer' },
    graceDays: { type: 'integer' },
    issueDay: { type: 'integer' },
    startsAt: { type: 'string', format: 'date-time' },
    endsAt: { type: 'string', format: 'date-time', nullable: true },
    status: { type: 'string', enum: ['DRAFT', 'ACTIVE', 'TERMINATED'] },
    supersedesId: { type: 'string', format: 'uuid', nullable: true },
    mobileEnabled: { type: 'boolean' },
    kioskEnabled: { type: 'boolean' },
    temDocumento: { type: 'boolean' },
    termsVersion: { type: 'string' },
    signatureStatus: { type: 'string', enum: ['PENDING', 'SIGNED', 'WAIVED'] },
    foroCidade: { type: 'string', nullable: true },
    foroUf: { type: 'string', nullable: true },
    temDocumentoAssinado: { type: 'boolean' },
  },
};

const ESQUEMA_DO_VALOR_DE_INDICE = {
  type: 'object',
  required: ['id', 'code', 'competencia', 'variationBasisPoints'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    competencia: { type: 'string' },
    variationBasisPoints: { type: 'integer' },
  },
};

const ESQUEMA_DO_VALOR_CORRIGIDO = {
  type: 'object',
  required: ['valorMinor', 'aniversariosAplicados'],
  properties: {
    valorMinor: { type: 'integer' },
    aniversariosAplicados: { type: 'integer' },
  },
};

/** O contrato como o painel o le. */
interface ContratoNaResposta {
  id: string;
  tenantId: string;
  planId: string;
  model: string;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  indexCode: string;
  baseDate: string;
  anniversaryDay: number;
  anniversaryMonth: number;
  graceDays: number;
  issueDay: number;
  startsAt: string;
  endsAt: string | null;
  status: string;
  supersedesId: string | null;
  mobileEnabled: boolean;
  kioskEnabled: boolean;
  temDocumento: boolean;
  termsVersion: string;
  signatureStatus: string;
  foroCidade: string | null;
  foroUf: string | null;
  temDocumentoAssinado: boolean;
}

/**
 * `temDocumento` no lugar de `documentObjectKey`.
 *
 * A chave e endereco interno do bucket: publica-la deixaria quem le a API
 * saber a forma do caminho dos objetos privados -- e o mesmo bucket guarda
 * foto biometrica de aluno. O painel so precisa saber SE ha PDF; para le-lo
 * existe a rota `/documento`.
 */
function paraResposta(contrato: {
  id: string;
  tenantId: string;
  planId: string;
  model: string;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  fixedPriceMinor: number | null;
  currency: string;
  indexCode: string;
  baseDate: Date;
  anniversaryDay: number;
  anniversaryMonth: number;
  graceDays: number;
  issueDay: number;
  startsAt: Date;
  endsAt: Date | null;
  status: string;
  supersedesId: string | null;
  mobileEnabled: boolean;
  kioskEnabled: boolean;
  documentObjectKey: string | null;
  termsVersion: string;
  signatureStatus: string;
  foroCidade: string | null;
  foroUf: string | null;
  signedDocumentObjectKey: string | null;
}): ContratoNaResposta {
  return {
    id: contrato.id,
    tenantId: contrato.tenantId,
    planId: contrato.planId,
    model: contrato.model,
    activeStudentPriceMinor: contrato.activeStudentPriceMinor,
    inactiveStudentPriceMinor: contrato.inactiveStudentPriceMinor,
    fixedPriceMinor: contrato.fixedPriceMinor,
    currency: contrato.currency,
    indexCode: contrato.indexCode,
    baseDate: contrato.baseDate.toISOString(),
    anniversaryDay: contrato.anniversaryDay,
    anniversaryMonth: contrato.anniversaryMonth,
    graceDays: contrato.graceDays,
    issueDay: contrato.issueDay,
    startsAt: contrato.startsAt.toISOString(),
    endsAt: contrato.endsAt?.toISOString() ?? null,
    status: contrato.status,
    supersedesId: contrato.supersedesId,
    mobileEnabled: contrato.mobileEnabled,
    kioskEnabled: contrato.kioskEnabled,
    temDocumento: contrato.documentObjectKey !== null,
    termsVersion: contrato.termsVersion,
    signatureStatus: contrato.signatureStatus,
    foroCidade: contrato.foroCidade,
    foroUf: contrato.foroUf,
    temDocumentoAssinado: contrato.signedDocumentObjectKey !== null,
  };
}

/**
 * Plano SaaS, contrato do tenant e historico do indice -- F63, ADR-052 §5-§8.
 *
 * CONTROLLER PROPRIO, e nao mais rotas no `PlatformController`: aquele ja
 * carrega tenant, elevacao e identidade visual, e uma classe que cresce por
 * acumulo vira o lugar onde ninguem acha nada. `@PlatformRoute()` na classe
 * pela mesma razao de la -- rota nova nasce protegida.
 */
@Controller('api/v1/platform')
@PlatformRoute()
export class ContratosController {
  constructor(
    private readonly contexto: PlatformContextService,
    private readonly planos: SaasPlanUseCase,
    private readonly contratos: TenantContractUseCase,
    private readonly indices: IndexValueUseCase,
  ) {}

  // --- Planos ------------------------------------------------------------

  @Get('plans')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_PLANO } })
  async listarPlanos(): Promise<unknown[]> {
    return this.planos.listar();
  }

  @Post('plans')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_PLANO })
  async criarPlano(@Body() corpo: unknown, @Req() requisicao: Request): Promise<unknown> {
    return this.planos.criar(
      this.contexto.require(),
      esquemaDePlanoSaas.parse(corpo),
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  @Patch('plans/:id')
  @ApiOkResponse({ schema: ESQUEMA_DO_PLANO })
  async alterarPlano(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<unknown> {
    return this.planos.alterar(
      this.contexto.require(),
      id,
      esquemaDePlanoSaas.parse(corpo),
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  @Post('plans/:id/archive')
  @ApiOkResponse({ schema: ESQUEMA_DO_PLANO })
  async arquivarPlano(@Param('id') id: string, @Req() requisicao: Request): Promise<unknown> {
    return this.planos.arquivar(
      this.contexto.require(),
      id,
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  // --- Contratos ---------------------------------------------------------

  @Get('tenants/:tenantId/contracts')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_CONTRATO } })
  async listarContratos(@Param('tenantId') tenantId: string): Promise<ContratoNaResposta[]> {
    const encontrados = await this.contratos.listarDoTenant(tenantId);

    return encontrados.map(paraResposta);
  }

  @Post('contracts')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_CONTRATO })
  async criarContrato(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ContratoNaResposta> {
    const contrato = await this.contratos.criar(
      this.contexto.require(),
      esquemaDeCriacaoDeContrato.parse(corpo),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(contrato);
  }

  @Post('contracts/:id/activate')
  @ApiOkResponse({ schema: ESQUEMA_DO_CONTRATO })
  async ativarContrato(
    @Param('id') id: string,
    @Req() requisicao: Request,
  ): Promise<ContratoNaResposta> {
    const contrato = await this.contratos.ativar(
      this.contexto.require(),
      id,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(contrato);
  }

  /**
   * Descarta um contrato em rascunho -- F68.
   *
   * `DELETE` e nao `POST .../discard`: rascunho descartado deixa de existir, e
   * o verbo que diz isso e o do HTTP. As duas outras transicoes do contrato
   * (`activate`, `terminate`) sao `POST` porque MUDAM ESTADO de uma linha que
   * permanece -- aqui a linha some.
   *
   * 204 e nao 200: nao ha corpo a devolver: o recurso acabou de deixar de
   * existir, e devolver o que foi apagado convidaria o painel a renderiza-lo.
   */
  @Delete('contracts/:id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Rascunho descartado.' })
  async descartarContrato(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<void> {
    await this.contratos.descartar(
      this.contexto.require(),
      id,
      esquemaDeDescarteDeContrato.parse(corpo).reason,
      requisicao.correlationId ?? 'sem-correlacao',
    );
  }

  @Post('contracts/:id/terminate')
  @ApiOkResponse({ schema: ESQUEMA_DO_CONTRATO })
  async encerrarContrato(
    @Param('id') id: string,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ContratoNaResposta> {
    const entrada = esquemaDeEncerramentoDeContrato.parse(corpo);

    const contrato = await this.contratos.encerrar(
      this.contexto.require(),
      id,
      entrada.encerradoEm,
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(contrato);
  }

  /**
   * O valor do contrato fixo corrigido ate hoje.
   *
   * LEITURA: nao grava nada. O contrato e imutavel, e quem persiste o valor
   * cobrado e a fatura (F64).
   *
   * `agora` entra por query so para o painel poder simular uma data -- a
   * ausencia dele usa o relogio do servidor, que e o caso normal.
   */
  @Get('contracts/:id/corrected-value')
  @ApiOkResponse({ schema: ESQUEMA_DO_VALOR_CORRIGIDO })
  async valorCorrigido(
    @Param('id') id: string,
    @Query('em') em?: string,
  ): Promise<{ valorMinor: number; aniversariosAplicados: number }> {
    const agora = em ? new Date(`${em}T00:00:00.000Z`) : new Date();

    return this.contratos.valorCorrigido(id, agora);
  }

  /**
   * O PDF do contrato.
   *
   * `attachment`, e nao `inline`: contrato e documento para guardar, e a
   * tela do painel oferece um link de download, nao um visualizador.
   */
  @Get('contracts/:id/document')
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async documento(@Param('id') id: string, @Res() resposta: Response): Promise<void> {
    const arquivo = await this.contratos.lerDocumento(id);

    resposta
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
    resposta.send(Buffer.from(arquivo.conteudo));
  }

  /**
   * Sobe o PDF assinado -- F70 (SPEC-070 §3.3, ADR-055).
   *
   * NAO SUBSTITUI `/document`: o gerado e o assinado convivem sob chaves
   * proprias (ver `TenantContractUseCase.registrarAssinatura`).
   */
  @Post('contracts/:id/signed-document')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_CONTRATO })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TAMANHO_MAXIMO_DO_CONTRATO_ASSINADO_BYTES },
    }),
  )
  async enviarDocumentoAssinado(
    @Param('id') id: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<ContratoNaResposta> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    if (arquivo.mimetype !== 'application/pdf') {
      throw new BadRequestException({ code: 'FILE_MUST_BE_PDF' });
    }

    const entrada = esquemaDeAssinaturaDeContrato.parse(corpo);

    const contrato = await this.contratos.registrarAssinatura(
      this.contexto.require(),
      id,
      arquivo.buffer,
      entrada.signedAt ?? new Date(),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return paraResposta(contrato);
  }

  /**
   * O PDF assinado do contrato.
   *
   * `attachment`, e nao `inline`, pela mesma razao de `/document`.
   */
  @Get('contracts/:id/signed-document')
  @ApiOkResponse({
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async documentoAssinado(@Param('id') id: string, @Res() resposta: Response): Promise<void> {
    const arquivo = await this.contratos.lerDocumentoAssinado(id);

    resposta
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${arquivo.nome}"`);
    resposta.send(Buffer.from(arquivo.conteudo));
  }

  // --- Historico do indice -----------------------------------------------

  @Get('index-values')
  @ApiOkResponse({ schema: { type: 'array', items: ESQUEMA_DO_VALOR_DE_INDICE } })
  async listarIndice(
    @Query('code') code?: string,
  ): Promise<Array<{ id: string; code: string; competencia: string; variationBasisPoints: number }>> {
    const valores = await this.indices.listar(code ?? 'IPCA');

    return valores.map((valor) => ({
      id: valor.id,
      code: valor.code,
      competencia: valor.referenceMonth.toISOString().slice(0, 7),
      variationBasisPoints: valor.variationBasisPoints,
    }));
  }

  @Post('index-values')
  @ApiCreatedResponse({ schema: ESQUEMA_DO_VALOR_DE_INDICE })
  async registrarIndice(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ id: string; code: string; competencia: string; variationBasisPoints: number }> {
    const valor = await this.indices.registrar(
      this.contexto.require(),
      esquemaDeValorDeIndice.parse(corpo),
      requisicao.correlationId ?? 'sem-correlacao',
    );

    return {
      id: valor.id,
      code: valor.code,
      competencia: valor.referenceMonth.toISOString().slice(0, 7),
      variationBasisPoints: valor.variationBasisPoints,
    };
  }
}
