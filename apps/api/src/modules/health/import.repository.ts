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

/**
 * Nenhuma medida da sessao passou na faixa plausivel.
 *
 * Diferente de `SessaoBloqueadaError`: la a sessao esta incompleta (falta o
 * laudo da balanca, ha divergencia aberta); aqui os arquivos vieram, foram
 * lidos, e TODO valor extraido e impossivel -- foto ilegivel, laudo de
 * modelo que o extrator confunde inteiro.
 *
 * O erro existe para nao criar avaliacao VAZIA: uma avaliacao publicada sem
 * medida nenhuma apareceria no historico do aluno como um ponto no grafico
 * que nao mede nada.
 */
export class SessaoSemMedidaPlausivelError extends ErroDeDominio {
  constructor() {
    super(
      'SESSION_NO_PLAUSIBLE_MEASURE',
      422,
      'nenhum valor extraido dos laudos esta numa faixa plausivel',
    );
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
 * A GARANTIA PRINCIPAL contra confirmacao dupla ja aconteceu ANTES deste
 * ponto, em `AssessmentRepository.criarRascunho` (indice parcial
 * `body_assessments_import_source_reference_uq`, fix Task 5 round 2) -- lá o
 * `P2002` vira `AvaliacaoJaExisteParaOrigemError`. Este erro aqui e a
 * checagem DEFENSIVA de `ImportRepository.confirmarSessao`: se o numero de
 * linhas afetadas nao bater com o numero de imports esperado (um import
 * mudou de status por outro caminho entre a leitura da sessao e o UPDATE),
 * sinaliza o mesmo 409 -- o cliente nao precisa distinguir as duas causas.
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

/**
 * Um TIPO de medida tem mais de um valor ACEITO na sessao -- dois campos
 * divergentes foram os DOIS confirmados/corrigidos, em vez de um confirmado
 * e o(s) outro(s) descartado(s) (revisao adversarial, achado contra
 * Postgres real).
 *
 * `consolidar()` NUNCA deduplica uma linha DIVERGENTE (e correto: o humano
 * precisa decidir qual valor vale) -- mas nada IMPEDIA o avaliador de
 * confirmar os DOIS lados pela rota de campo isolado (`POST
 * assessment-imports/:id/fields/:fieldId`, F19), que aceita qualquer campo
 * do import sem saber que ele pertence a uma linha divergente de outra
 * sessao. Sem esta checagem, duas medidas do MESMO tipo entrariam na MESMA
 * avaliacao e o `@@unique([assessmentId, type])` do banco estourava um
 * P2002 cru, sem dizer qual tipo nem por que -- e pior, se o rascunho
 * chegasse a ser criado antes do estouro, a sessao ficava travada em 409
 * `SESSION_ALREADY_CONFIRMED` para sempre (nenhuma tentativa futura resolve
 * sozinha, porque o conflito esta nos DADOS revisados, nao numa corrida).
 *
 * O `title` carrega o TIPO em conflito, pela mesma razao de
 * `RevisaoIncompletaError`: o `application/problem+json` do projeto nao
 * carrega campos extras, e sem o tipo no titulo o avaliador nao saberia
 * qual dos vinte campos da sessao decidir de novo.
 */
export class MedidaDuplicadaNaSessaoError extends ErroDeDominio {
  constructor(tipo: string) {
    super(
      'SESSION_MEASUREMENT_CONFLICT',
      409,
      `mais de um valor aceito para o tipo ${tipo}; descarte um dos campos divergentes`,
    );
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
  /**
   * So os imports que PODEM virar avaliacao (`EXTRACTED`).
   *
   * Um laudo que o extrator nao conseguiu ler fica `FAILED` e continua na
   * sessao -- ele existe, o arquivo esta guardado, e a fila da F22 o mostra
   * -- mas nao pode receber `assessment_id`: a constraint
   * `assessment_imports_avaliacao_so_em_confirmada` proibe, e com razao
   * (avaliacao ligada a import que falhou seria proveniencia mentirosa).
   *
   * Sem esta separacao, `confirmarSessao` comparava a contagem de linhas
   * atualizadas com o total da sessao, nao batia por causa do `FAILED`, e
   * estourava `SESSION_ALREADY_CONFIRMED` -- um erro que MENTE sobre a
   * causa e nao resolve em nenhuma tentativa futura. Achado com os tres
   * laudos reais: o ECG e PDF de tracado, sem texto extraivel.
   */
  readonly importIdsConfirmaveis: readonly string[];
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

  /**
   * `tipoDeLaudo` e gravado MESMO na falha -- e a unica informacao do
   * arquivo que nao depende do extrator ter funcionado.
   *
   * Sem isto, o laudo que falha perde o tipo e vira `UNKNOWN` na tela: a
   * aba do ECG nao conseguia dizer "o ECG veio e nao pode ser lido" porque
   * nao sabia mais que aquele arquivo ERA um ECG. Quem enviou declarou o
   * tipo no campo; o fracasso da leitura nao apaga essa declaracao.
   */
  async marcarFalha(
    contexto: TenantContext,
    importId: string,
    motivo: string,
    tipoDeLaudo?: string | null,
  ): Promise<void> {
    await this.db.assessmentImport.updateMany({
      where: { id: importId, tenantId: contexto.tenantId },
      data: {
        status: 'FAILED',
        failureReason: motivo,
        ...(tipoDeLaudo ? { extractedAttributes: { tipoDeLaudo } } : {}),
      },
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
      include: { fields: { orderBy: { id: 'asc' } } },
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
      // ORDEM EXPLICITA DOS CAMPOS, e nao so dos arquivos.
      //
      // Sem `orderBy` no `include`, o Postgres devolve os campos na ordem
      // FISICA da tabela -- que muda quando uma linha e reescrita (um
      // `UPDATE` de `state`, por exemplo, move a tupla). Observado ao vivo:
      // a mesma sessao renderizou "Peso" na 1a linha e, depois da
      // publicacao automatica marcar os campos, na 10a. A tela parecia
      // embaralhar sozinha entre dois carregamentos.
      //
      // `id` e uuid v4 -- nao carrega ordem semantica, mas e ESTAVEL, que e
      // o que falta aqui. Ordenar por `type` daria uma ordem alfabetica que
      // separa "Peso" de "Altura"; a ordem de insercao agrupa o que veio do
      // mesmo laudo, que e como quem confere le.
      include: { fields: { orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });

    if (linhas.length === 0) return null;

    const primeira = linhas[0]!;

    const arquivos: ArquivoDaSessao[] = linhas.map((linha) => ({
      importId: linha.id,
      sourceLabel: linha.sourceLabel ?? linha.originalFilename,
      tipoDeLaudo: tipoDeLaudoDoAtributos(linha.extractedAttributes),
      // O status REAL do import. A tela precisa distinguir "extraido",
      // "esperando revisao" e "o extrator nao conseguiu ler" -- sem isto,
      // um laudo `FAILED` (zero campos) caia na mesma cesta de "pendente de
      // revisao" e pedia uma acao que nao existe para ele.
      status: linha.status,
      failureReason: linha.failureReason,
      // OPACO (ADR-035): mesma extracao que `atributosPorImport` abaixo, so
      // que presa ao ARQUIVO dono -- e o que faltava para a tela de revisao
      // citar o achado do ECG sem ter que adivinhar de qual arquivo ele veio.
      atributos: atributosOpacos(linha.extractedAttributes),
    }));

    const campos = linhas.flatMap((linha) => paraImportacaoComCampos(linha).campos);

    return {
      reviewSessionId,
      studentId: primeira.studentId,
      arquivos,
      campos,
      importIds: linhas.map((linha) => linha.id),
      importIdsConfirmaveis: linhas
        .filter((linha) => linha.status === 'EXTRACTED')
        .map((linha) => linha.id),
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
   * ---------------------------------------------------------------------------
   * FIX ROUND 2: UM UPDATE SO, NAO UM LOOP -- e a garantia mora em OUTRA tabela.
   * ---------------------------------------------------------------------------
   *
   * A versao anterior fazia um `updateMany` POR IMPORT, dentro de um loop, e
   * dependia de um indice parcial em `assessment_imports (review_session_id)`
   * para pegar corrida. Rodando contra Postgres de verdade pela primeira vez,
   * isso quebrou de um jeito diferente do esperado: uma sessao de TRES
   * arquivos tem TRES linhas com o MESMO `review_session_id`, e assim que a
   * PRIMEIRA linha do loop recebia `assessment_id`, a SEGUNDA linha do MESMO
   * loop (mesma sessao, mesma chamada, sem corrida nenhuma) já violava aquele
   * indice -- a primeira confirmacao de qualquer sessao multiarquivo sempre
   * falhava. O indice tinha o formato errado: unicidade por LINHA de import
   * nunca poderia expressar "N linhas legitimamente compartilham uma
   * avaliacao". Ver `AvaliacaoJaExisteParaOrigemError`
   * (`domain/avaliacao.ts`) para onde a garantia foi para -- a INSERCAO da
   * `body_assessments` em `AssessmentRepository.criarRascunho`, que e
   * estruturalmente UMA linha por tentativa de confirmacao.
   *
   * Este metodo agora so faz o UPDATE em massa (todos os ids de uma vez); a
   * idempotencia contra confirmacao dupla ja foi decidida ANTES desta
   * chamada, no `criarRascunho`. O que resta aqui e defensivo: se `count`
   * nao bater com `importIds.length`, algum import mudou de status por um
   * caminho diferente (ex.: descartado) entre a leitura da sessao e este
   * UPDATE -- sinaliza o mesmo 409, mas essa NAO e mais a linha de defesa
   * principal contra confirmacao dupla.
   */
  async confirmarSessao(
    contexto: TenantContext,
    reviewSessionId: string,
    importIds: readonly string[],
    assessmentId: string,
    reviewerUserId: string,
    agora: Date,
  ): Promise<void> {
    const afetadas = await this.db.assessmentImport.updateMany({
      where: {
        id: { in: [...importIds] },
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

    // LISTA VAZIA E CONFIRMACAO DUPLICADA, NAO SUCESSO.
    //
    // `importIds` aqui e `importIdsConfirmaveis` -- so os `EXTRACTED`. Numa
    // sessao JA confirmada, nenhum import esta `EXTRACTED`, a lista chega
    // vazia, e `0 !== 0` e falso: a guarda nao disparava e a segunda
    // confirmacao respondia 201, criando uma avaliacao duplicada. Regressao
    // introduzida junto com `importIdsConfirmaveis` e pega pelo teste de
    // integracao que ja existia -- por isso a checagem de vazio vem ANTES da
    // comparacao de contagem.
    if (importIds.length === 0) throw new SessaoJaConfirmadaError();

    if (afetadas.count !== importIds.length) throw new SessaoJaConfirmadaError();
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
      // O arquivo dono -- vinculo REAL, nunca casamento por rotulo de texto
      // (ver `CampoExtraido.importId`).
      importId: linha.id,
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
      referenceMin: campo.referenceMin === null ? null : campo.referenceMin.toNumber(),
      referenceMax: campo.referenceMax === null ? null : campo.referenceMax.toNumber(),
      standardPercent: campo.standardPercent === null ? null : campo.standardPercent.toNumber(),
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

  // Lista derivada de `TipoDeLaudo` -- e um `satisfies` de proposito: tipo
  // novo no dominio que ninguem adicionar aqui vira `UNKNOWN` em silencio, e
  // foi assim que `BIOIMPEDANCE_ANALYSIS` apareceu como "UNKNOWN" na tela
  // no mesmo dia em que foi criado. O `satisfies` nao impede o esquecimento
  // (a leitura e de JSON, sem tipo em runtime), mas deixa a lista ao lado da
  // definicao em vez de espalhada em literais soltos.
  const CONHECIDOS = [
    'BIOIMPEDANCE',
    'BIOIMPEDANCE_ANALYSIS',
    'ECG',
  ] as const satisfies readonly TipoDeLaudo[];

  return (CONHECIDOS as readonly string[]).includes(valor as string)
    ? (valor as TipoDeLaudo)
    : 'UNKNOWN';
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
