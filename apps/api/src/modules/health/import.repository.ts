import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { CampoExtraido, EstadoDoCampo } from './domain/revisao-de-importacao.js';
import type { TipoDeArquivo } from './domain/arquivo-de-importacao.js';
import type { TipoDeMedida, UnidadeDeMedida } from './domain/medida.js';

/**
 * Importacoes de arquivo e seus campos em revisao (F19).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 */

export class ImportacaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('IMPORT_NOT_FOUND', 404, 'importacao nao encontrada');
  }
}

export class ImportacaoJaFinalizadaError extends ErroDeDominio {
  constructor() {
    super(
      'IMPORT_ALREADY_FINALIZED',
      409,
      'importacao ja foi confirmada ou descartada e nao aceita mais revisao',
    );
  }
}

/**
 * Revisao incompleta, com o campo que falta NO TITULO.
 *
 * O `application/problem+json` do projeto tem campos fixos e nao carrega
 * extras -- decisao deliberada do filtro, porque em rotas de auth distinguir
 * "e-mail invalido" de "senha invalida" ja vaza estado. Entao o campo vai no
 * `title`, que e o canal que existe: sem ele a tela diria so "nao pode
 * confirmar" e o avaliador procuraria a mao qual dos dez campos falta.
 */
export class RevisaoIncompletaError extends ErroDeDominio {
  constructor(motivo: string, campoId: string | null) {
    super(
      motivo,
      409,
      campoId === null
        ? 'a revisao nao pode ser confirmada'
        : `a revisao nao pode ser confirmada; campo pendente: ${campoId}`,
    );
  }
}

export class CampoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('IMPORT_FIELD_NOT_FOUND', 404, 'campo de importacao nao encontrado');
  }
}

export type StatusDaImportacao =
  | 'RECEIVED'
  | 'INFECTED'
  | 'EXTRACTED'
  | 'FAILED'
  | 'CONFIRMED'
  | 'DISCARDED';

export interface ImportacaoComCampos {
  readonly id: string;
  readonly studentId: string;
  readonly status: StatusDaImportacao;
  readonly originalFilename: string;
  readonly fileType: string;
  readonly extractor: string | null;
  readonly failureReason: string | null;
  readonly assessmentId: string | null;
  readonly createdAt: Date;
  readonly campos: readonly CampoExtraido[];
}

@Injectable()
export class ImportRepository {
  constructor(private readonly db: PrismaService) {}

  async criar(
    contexto: TenantContext,
    dados: {
      studentId: string;
      originalFilename: string;
      fileType: TipoDeArquivo;
      fileSizeBytes: number;
      uploadedByUserId: string;
    },
  ): Promise<{ id: string }> {
    return this.db.assessmentImport.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: dados.studentId,
        status: 'RECEIVED',
        originalFilename: dados.originalFilename,
        fileType: dados.fileType,
        fileSizeBytes: dados.fileSizeBytes,
        uploadedByUserId: dados.uploadedByUserId,
      },
      select: { id: true },
    });
  }

  /**
   * Marca a importacao como infectada.
   *
   * `objectKey: null` NAO e detalhe: arquivo infectado nao fica no storage, e
   * a constraint `assessment_imports_infectada_sem_arquivo` impede que alguem
   * "conserte" isso guardando para analisar depois.
   */
  async marcarInfectada(
    contexto: TenantContext,
    importId: string,
    ameaca: string,
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId },
      data: {
        status: 'INFECTED',
        scanResult: ameaca,
        failureReason: `antivirus recusou: ${ameaca}`,
        objectKey: null,
      },
    });
  }

  async marcarFalha(
    contexto: TenantContext,
    importId: string,
    motivo: string,
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId },
      data: { status: 'FAILED', failureReason: motivo },
    });
  }

  /**
   * Grava os campos extraidos e move a importacao para `EXTRACTED`.
   *
   * Numa transacao: importacao marcada como extraida sem os campos deixaria a
   * tela de revisao vazia, e o avaliador concluiria que o arquivo nao tinha
   * nada -- quando na verdade a gravacao morreu no meio.
   */
  async gravarExtracao(
    contexto: TenantContext,
    importId: string,
    extractor: string,
    objectKey: string,
    campos: readonly {
      type: TipoDeMedida;
      value: number;
      unit: UnidadeDeMedida | null;
      confidence: number | null;
      sourceLocation: string | null;
    }[],
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.importedField.createMany({
        data: campos.map((campo) => ({
          tenantId: contexto.tenantId,
          importId,
          type: campo.type,
          state: 'PENDING' as const,
          extractedValue: campo.value,
          extractedUnit: paraBanco(campo.unit),
          confidence: campo.confidence,
          sourceLocation: campo.sourceLocation,
        })),
      });

      await tx.assessmentImport.updateMany({
        where: { id: importId, tenantId: contexto.tenantId },
        data: { status: 'EXTRACTED', extractor, objectKey },
      });
    });
  }

  async encontrar(
    contexto: TenantContext,
    importId: string,
  ): Promise<ImportacaoComCampos | null> {
    const linha = await this.db.assessmentImport.findFirst({
      where: { id: importId, tenantId: contexto.tenantId },
      include: { fields: true },
    });

    if (linha === null) return null;

    return {
      id: linha.id,
      studentId: linha.studentId,
      status: linha.status,
      originalFilename: linha.originalFilename,
      fileType: linha.fileType,
      extractor: linha.extractor,
      failureReason: linha.failureReason,
      assessmentId: linha.assessmentId,
      createdAt: linha.createdAt,
      campos: linha.fields.map((campo) => ({
        id: campo.id,
        // SEM `toLowerCase()`: `TipoDeMedida` ja e MAIUSCULO no dominio,
        // identico ao enum do Prisma. Baixar a caixa produzia
        // `body_fat_percent`, que a tabela de unidades nao conhece -- e o
        // erro so aparecia na CONFIRMACAO, com "unidade percent nao se aplica
        // a body_fat_percent". Mesma classe do bug da unidade `L`: converter
        // caixa cegamente entre camadas cujo formato ja coincide.
        type: campo.type,
        extractedValue: campo.extractedValue === null ? null : campo.extractedValue.toNumber(),
        extractedUnit: doBanco(campo.extractedUnit),
        confidence: campo.confidence === null ? null : campo.confidence.toNumber(),
        sourceLocation: campo.sourceLocation,
        // Coluna ainda nao existe no Prisma (F-multiarquivo persiste em fatia
        // posterior) -- `null` aqui e ausencia real, nao palpite.
        sourceLabel: null,
        state: campo.state,
        reviewedValue: campo.reviewedValue === null ? null : campo.reviewedValue.toNumber(),
        reviewedUnit: doBanco(campo.reviewedUnit),
      })),
    };
  }

  /**
   * Registra a decisao do avaliador sobre UM campo.
   *
   * Le o status da importacao DENTRO da transacao: sem isso, duas requisicoes
   * concorrentes -- uma confirmando a importacao, outra revisando um campo --
   * deixariam a revisao passar DEPOIS da confirmacao, e a avaliacao ja
   * publicada teria nascido de campos diferentes dos que estao gravados. E a
   * mesma classe do defeito que a F17 fechou com `FOR UPDATE`.
   */
  async revisarCampo(
    contexto: TenantContext,
    importId: string,
    campoId: string,
    decisao: {
      state: EstadoDoCampo;
      reviewedValue: number | null;
      reviewedUnit: UnidadeDeMedida | null;
    },
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const importacao = await tx.assessmentImport.findFirst({
        where: { id: importId, tenantId: contexto.tenantId },
        select: { status: true },
      });

      if (!importacao) throw new ImportacaoNaoEncontradaError();

      if (importacao.status === 'CONFIRMED' || importacao.status === 'DISCARDED') {
        throw new ImportacaoJaFinalizadaError();
      }

      const atualizados = await tx.importedField.updateMany({
        where: { id: campoId, importId, tenantId: contexto.tenantId },
        data: {
          state: decisao.state,
          // Estado que nao e `CORRECTED` limpa o valor revisado: a constraint
          // do banco exige isso, e deixar residuo faria alguem, um dia, ler um
          // valor de um campo descartado achando que vale.
          reviewedValue: decisao.state === 'CORRECTED' ? decisao.reviewedValue : null,
          reviewedUnit: decisao.state === 'CORRECTED' ? paraBanco(decisao.reviewedUnit) : null,
        },
      });

      if (atualizados.count === 0) throw new CampoNaoEncontradoError();
    });
  }

  /** Liga a importacao a avaliacao criada, fechando o ciclo (INV-103). */
  async confirmar(
    contexto: TenantContext,
    importId: string,
    assessmentId: string,
    reviewerUserId: string,
    agora: Date,
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId, status: 'EXTRACTED' },
      data: {
        status: 'CONFIRMED',
        assessmentId,
        reviewedByUserId: reviewerUserId,
        reviewedAt: agora,
      },
    });
  }

  async descartar(
    contexto: TenantContext,
    importId: string,
    reviewerUserId: string,
    agora: Date,
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId, status: 'EXTRACTED' },
      data: { status: 'DISCARDED', reviewedByUserId: reviewerUserId, reviewedAt: agora },
    });
  }

  /**
   * Importacoes que precisam de atencao -- o painel da F22.
   *
   * `EXTRACTED` (esperando revisao), `FAILED` e `INFECTED` num lugar so:
   * quem opera a recepcao age sobre as tres da mesma tela.
   */
  async pendentesEFalhas(
    contexto: TenantContext,
    limite = 100,
  ): Promise<
    readonly {
      id: string;
      studentId: string;
      status: StatusDaImportacao;
      originalFilename: string;
      failureReason: string | null;
      camposPendentes: number;
      createdAt: Date;
    }[]
  > {
    const linhas = await this.db.assessmentImport.findMany({
      where: {
        tenantId: contexto.tenantId,
        status: { in: ['EXTRACTED', 'FAILED', 'INFECTED'] },
      },
      include: { _count: { select: { fields: { where: { state: 'PENDING' } } } } },
      orderBy: { createdAt: 'asc' },
      take: limite,
    });

    return linhas.map((linha) => ({
      id: linha.id,
      studentId: linha.studentId,
      status: linha.status,
      originalFilename: linha.originalFilename,
      failureReason: linha.failureReason,
      camposPendentes: linha._count.fields,
      createdAt: linha.createdAt,
    }));
  }

  /** Apaga a chave do arquivo apos a confirmacao -- retencao curta. */
  async esquecerArquivo(contexto: TenantContext, importId: string): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId },
      data: { objectKey: null },
    });
  }
}

/**
 * Enum do Prisma (maiusculo) para a unidade do dominio.
 *
 * ⚠️ MAPA EXPLICITO, e nao `toLowerCase()`. A unidade de volume e `L`
 * MAIUSCULO no dominio -- litro em minusculo se confunde com o algarismo 1 e
 * com a letra i em varias fontes, e o dominio escolheu a forma sem
 * ambiguidade. Baixar a caixa cegamente produzia `l`, que nao existe na
 * tabela de fatores, e a conversao estourava com
 * `Cannot read properties of undefined` -- longe da causa, na primeira
 * importacao com agua corporal.
 */
const DO_BANCO: Readonly<Record<string, UnidadeDeMedida>> = {
  KG: 'kg',
  G: 'g',
  LB: 'lb',
  CM: 'cm',
  M: 'm',
  IN: 'in',
  PERCENT: 'percent',
  KCAL: 'kcal',
  L: 'L',
};

function doBanco(valor: string | null): UnidadeDeMedida | null {
  return valor === null ? null : (DO_BANCO[valor] ?? null);
}

/** Dominio para o enum do Prisma. Simetrico de `DO_BANCO`. */
function paraBanco(valor: UnidadeDeMedida | null): never | null {
  return valor === null ? null : (valor.toUpperCase() as never);
}
