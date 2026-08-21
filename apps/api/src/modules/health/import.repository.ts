import { Injectable } from '@nestjs/common';
import { Prisma } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import type { CampoExtraido, EstadoDoCampo } from './domain/revisao-de-importacao.js';
import type { TipoDeArquivo } from './domain/arquivo-de-importacao.js';
import type { TipoDeMedida, UnidadeDeMedida } from './domain/medida.js';
import type { ArquivoDaSessao, TipoDeLaudo } from './domain/sessao-de-revisao.js';

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

/**
 * A sessao nao pode virar avaliacao ainda -- `motivo` e o codigo do dominio
 * (`sessaoPodeConfirmar`), verbatim: `SESSION_EMPTY`, `BIOIMPEDANCE_REQUIRED`
 * ou `DIVERGENCE_UNRESOLVED`.
 */
export class SessaoBloqueadaError extends ErroDeDominio {
  constructor(motivo: string) {
    super(motivo, 409, 'a sessao de revisao nao pode ser confirmada');
  }
}

export class SessaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('SESSION_NOT_FOUND', 404, 'sessao de revisao nao encontrada');
  }
}

/**
 * O `reviewSessionId` do pedido pertence a OUTRO aluno.
 *
 * Sem esta checagem, um upload malicioso ou por engano anexaria o arquivo do
 * aluno B a sessao do aluno A -- `encontrarSessao` deriva `studentId` da
 * PRIMEIRA linha da sessao, e a confirmacao gravaria a medida de B na ficha
 * de A. Corrupcao de dado de saude entre pacientes, mesmo dentro do mesmo
 * tenant (nao e so isolamento de tenant que protege aqui).
 */
export class SessaoDeOutroAlunoError extends ErroDeDominio {
  constructor() {
    super('SESSION_STUDENT_MISMATCH', 409, 'a sessao de revisao pertence a outro aluno');
  }
}

/**
 * Duas confirmacoes concorrentes da mesma sessao -- a segunda chega aqui.
 *
 * O INDICE PARCIAL do banco e quem garante isto (nunca um `if`): a segunda
 * transacao que tenta gravar `assessment_id` para o mesmo `review_session_id`
 * ja confirmado leva `P2002`, e este erro traduz o `P2002` cru num 409 de
 * dominio -- o cliente nunca ve o erro do Postgres.
 */
export class SessaoJaConfirmadaError extends ErroDeDominio {
  constructor() {
    super('SESSION_ALREADY_CONFIRMED', 409, 'a sessao de revisao ja foi confirmada');
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
  readonly reviewSessionId: string | null;
  readonly sourceLabel: string | null;
  /** Chave no storage privado. `null` quando o arquivo ja foi expurgado. */
  readonly objectKey: string | null;
  readonly createdAt: Date;
  readonly campos: readonly CampoExtraido[];
}

/** Uma sessao de revisao: todos os arquivos e campos que a compoem. */
export interface SessaoComArquivos {
  readonly reviewSessionId: string;
  readonly studentId: string;
  readonly arquivos: readonly ArquivoDaSessao[];
  /** Campos de TODOS os arquivos da sessao, achatados. */
  readonly campos: readonly CampoExtraido[];
  readonly importIds: readonly string[];
  /** Chave no storage privado de cada import, na MESMA ordem de `importIds`. */
  readonly objectKeys: readonly (string | null)[];
  /**
   * O que cada arquivo guardou em `extracted_attributes` -- OPACO
   * (ADR-035), carregado ate a confirmacao migrar o que for dado de
   * aparelho para `BodyAssessment.deviceReport`. Nunca interpretado aqui.
   */
  readonly atributosPorImport: readonly (Record<string, unknown> | null)[];
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
      reviewSessionId?: string | undefined;
      sourceLabel?: string | undefined;
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
        reviewSessionId: dados.reviewSessionId ?? null,
        sourceLabel: dados.sourceLabel ?? null,
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
   *
   * NAO calcula `agreesWithFieldId` aqui: no momento em que UM arquivo e
   * extraido, os outros arquivos da sessao podem nao ter chegado ainda --
   * `enviarSegundoArquivo` pode rodar minutos depois. A deduplicacao entre
   * arquivos so faz sentido com a SESSAO INTEIRA na mao, e por isso mora em
   * `gravarConcordancias`, chamada por quem le a sessao (`detalharSessao` no
   * service).
   *
   * `sourceLabel` do ARQUIVO (nao do campo) so sobrescreve quando
   * `sourceLabelDoArquivo` vem preenchido: a F19 (import avulso) chama sem
   * rotulo do extrator, e nao deve perder o que `criar` ja gravou do pedido.
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
      sourceLabel: string | null;
      referenceMin: number | null;
      referenceMax: number | null;
      standardPercent: number | null;
    }[],
    extra: {
      sourceLabelDoArquivo: string | null;
      tipoDeLaudo: TipoDeLaudo | null;
      atributos: Record<string, unknown> | null;
    },
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
          sourceLabel: campo.sourceLabel,
          referenceMin: campo.referenceMin,
          referenceMax: campo.referenceMax,
          standardPercent: campo.standardPercent,
        })),
      });

      const atributosParaGravar: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        extra.tipoDeLaudo === null && extra.atributos === null
          ? Prisma.JsonNull
          : { tipoDeLaudo: extra.tipoDeLaudo, ...extra.atributos };

      await tx.assessmentImport.updateMany({
        where: { id: importId, tenantId: contexto.tenantId },
        data: {
          status: 'EXTRACTED',
          extractor,
          objectKey,
          ...(extra.sourceLabelDoArquivo !== null
            ? { sourceLabel: extra.sourceLabelDoArquivo }
            : {}),
          extractedAttributes: atributosParaGravar,
        },
      });
    });
  }

  /**
   * Grava, PARA CADA CAMPO ALVO, o id do campo com quem ele concorda --
   * resultado de `consolidar()` no dominio, ja resolvido para ids reais.
   *
   * `null` apaga a concordancia (o campo passou a divergir, ou a sessao
   * mudou de composicao). A trava de integridade e do CHAMADOR
   * (`import.service.ts`): este metodo so grava o par que recebe, e por
   * isso o service NUNCA monta o par a partir de dois conjuntos de campos
   * diferentes -- ver a nota em `detalharSessao`.
   */
  async gravarConcordancias(
    contexto: TenantContext,
    pares: readonly { campoId: string; agreesWithFieldId: string | null }[],
  ): Promise<void> {
    if (pares.length === 0) return;

    await this.db.$transaction(
      pares.map((par) =>
        this.db.importedField.updateMany({
          where: { id: par.campoId, tenantId: contexto.tenantId },
          data: { agreesWithFieldId: par.agreesWithFieldId },
        }),
      ),
    );
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

    return paraImportacaoComCampos(linha);
  }

  /**
   * Todos os arquivos e campos de UMA sessao de revisao (tenant-scoped).
   *
   * `null` quando a sessao nao existe NESTE tenant -- o controller traduz
   * isso em 404, nunca em lista vazia (que pareceria "sessao existe, sem
   * arquivo").
   */
  async encontrarSessao(
    contexto: TenantContext,
    reviewSessionId: string,
  ): Promise<SessaoComArquivos | null> {
    const linhas = await this.db.assessmentImport.findMany({
      where: { tenantId: contexto.tenantId, reviewSessionId },
      include: { fields: true },
      orderBy: { createdAt: 'asc' },
    });

    if (linhas.length === 0) return null;

    const primeira = linhas[0]!;

    const arquivos: ArquivoDaSessao[] = linhas.map((linha) => ({
      importId: linha.id,
      sourceLabel: linha.sourceLabel ?? linha.originalFilename,
      tipoDeLaudo: tipoDeLaudoDoAtributos(linha.extractedAttributes),
    }));

    const campos = linhas.flatMap((linha) => paraImportacaoComCampos(linha).campos);

    return {
      reviewSessionId,
      studentId: primeira.studentId,
      arquivos,
      campos,
      importIds: linhas.map((linha) => linha.id),
      objectKeys: linhas.map((linha) => linha.objectKey),
      atributosPorImport: linhas.map((linha) => atributosOpacos(linha.extractedAttributes)),
    };
  }

  /** Como `encontrarSessao`, mas lanca 404 de dominio em vez de devolver `null`. */
  async encontrarSessaoOuFalhar(
    contexto: TenantContext,
    reviewSessionId: string,
  ): Promise<SessaoComArquivos> {
    const sessao = await this.encontrarSessao(contexto, reviewSessionId);

    if (sessao === null) throw new SessaoNaoEncontradaError();

    return sessao;
  }

  /**
   * Confirma TODOS os imports `EXTRACTED` de uma sessao, apontando para a
   * MESMA avaliacao (Task 5).
   *
   * A GARANTIA DE IDEMPOTENCIA NAO ESTA AQUI DENTRO -- esta no INDICE
   * PARCIAL do banco (`assessment_imports_session_assessment_uq`). Este
   * metodo so tenta gravar; se outra transacao venceu a corrida, o Postgres
   * recusa com `P2002` e este metodo traduz isso em `SessaoJaConfirmadaError`
   * (409) -- nunca deixa o erro cru do driver vazar para o controller.
   */
  async confirmarSessao(
    contexto: TenantContext,
    reviewSessionId: string,
    importIds: readonly string[],
    assessmentId: string,
    reviewerUserId: string,
    agora: Date,
  ): Promise<void> {
    try {
      await this.db.$transaction(async (tx) => {
        for (const importId of importIds) {
          const afetadas = await tx.assessmentImport.updateMany({
            where: {
              id: importId,
              tenantId: contexto.tenantId,
              reviewSessionId,
              status: 'EXTRACTED',
            },
            data: {
              status: 'CONFIRMED',
              assessmentId,
              reviewedByUserId: reviewerUserId,
              reviewedAt: agora,
            },
          });

          // Outra transacao levou EXTRACTED embora entre a leitura da sessao
          // (no service) e este UPDATE -- a mesma classe de corrida que o
          // indice parcial cobre, so que chegando por um caminho diferente
          // (import ja no estado terminal, sem violar o indice). Sinaliza o
          // mesmo 409: o cliente nao distingue as duas causas.
          if (afetadas.count === 0) throw new SessaoJaConfirmadaError();
        }
      });
    } catch (erro: unknown) {
      // P2002 e o INDICE PARCIAL vencendo a corrida: duas confirmacoes
      // concorrentes da MESMA sessao passam as duas pela checagem de
      // aplicacao antes de qualquer uma escrever, e o banco e quem decide
      // qual das duas transacoes commita.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new SessaoJaConfirmadaError();
      }

      throw erro;
    }
  }

  /** Apaga a chave do arquivo de TODOS os imports de uma sessao. */
  async esquecerArquivosDaSessao(
    contexto: TenantContext,
    importIds: readonly string[],
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: { in: [...importIds] }, tenantId: contexto.tenantId },
      data: { objectKey: null },
    });
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

/** A linha do Prisma com os campos incluidos -- o shape que `encontrar` e `encontrarSessao` leem. */
type ImportacaoComCamposDoPrisma = Prisma.AssessmentImportGetPayload<{
  include: { fields: true };
}>;

/** Traduz a linha do Prisma (import + campos) para o formato do dominio. */
function paraImportacaoComCampos(linha: ImportacaoComCamposDoPrisma): ImportacaoComCampos {
  return {
    id: linha.id,
    studentId: linha.studentId,
    status: linha.status,
    originalFilename: linha.originalFilename,
    fileType: linha.fileType,
    extractor: linha.extractor,
    failureReason: linha.failureReason,
    assessmentId: linha.assessmentId,
    reviewSessionId: linha.reviewSessionId,
    sourceLabel: linha.sourceLabel,
    objectKey: linha.objectKey,
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
      sourceLabel: campo.sourceLabel,
      state: campo.state,
      reviewedValue: campo.reviewedValue === null ? null : campo.reviewedValue.toNumber(),
      reviewedUnit: doBanco(campo.reviewedUnit),
    })),
  };
}

/**
 * O `tipoDeLaudo` que o extrator classificou, lido de volta de
 * `extracted_attributes` -- ele NAO tem coluna propria (Task 2 nao previu
 * uma, e criar uma so para isto seria coluna de uso unico). `null` quando a
 * importacao ainda nao foi extraida, ou o extrator nao classificou.
 */
function tipoDeLaudoDoAtributos(atributos: Prisma.JsonValue): TipoDeLaudo {
  if (atributos === null || typeof atributos !== 'object' || Array.isArray(atributos)) {
    return 'UNKNOWN';
  }

  const valor = (atributos as Record<string, unknown>)['tipoDeLaudo'];

  return valor === 'BIOIMPEDANCE' || valor === 'ECG' ? valor : 'UNKNOWN';
}

/**
 * `extracted_attributes` cru, sem o `tipoDeLaudo` que `tipoDeLaudoDoAtributos`
 * ja extrai -- devolvido OPACO (ADR-035): nenhuma chave e interpretada aqui,
 * so repassada para quem monta `deviceReport` na confirmacao.
 */
function atributosOpacos(atributos: Prisma.JsonValue): Record<string, unknown> | null {
  if (atributos === null || typeof atributos !== 'object' || Array.isArray(atributos)) {
    return null;
  }

  const { tipoDeLaudo: _tipoDeLaudo, ...resto } = atributos as Record<string, unknown>;

  return Object.keys(resto).length === 0 ? null : resto;
}
