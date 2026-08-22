import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import { ImportService } from './import.service.js';
import { TAMANHO_MAXIMO_BYTES } from './domain/arquivo-de-importacao.js';
import { UNIDADES_DE_MEDIDA, type UnidadeDeMedida } from './domain/medida.js';
import { campoQueVirouMedida } from './domain/consolidacao-de-laudos.js';
import { lerFaixa, type Leitura } from './domain/leitura-de-faixa.js';
import type { CampoExtraido } from './domain/revisao-de-importacao.js';

/**
 * Upload e revisao de arquivo (F19, Slice 3.3).
 *
 * Rotas conforme o PRD (`MVP-03` secao 11):
 *
 *     POST /api/v1/students/:id/assessment-imports
 *     GET  /api/v1/assessment-imports/:id
 *     POST /api/v1/assessment-imports/:id/confirm
 *
 * Mais duas que o PRD nao lista e a revisao campo a campo exige -- sem elas o
 * `M3-FR-011` nao teria como acontecer:
 *
 *     PATCH /api/v1/assessment-imports/:id/fields/:fieldId
 *     POST  /api/v1/assessment-imports/:id/discard
 */

/**
 * O arquivo como o `FileInterceptor` o entrega.
 *
 * Declarado aqui em vez de instalar `@types/multer`: sao TRES campos, e o
 * pacote de tipos traria uma dependencia inteira para descrever o que cabe em
 * seis linhas. Se um dia o upload precisar de mais da API do multer, o pacote
 * entra -- por necessidade, nao por reflexo.
 */
interface ArquivoRecebido {
  readonly originalname: string;
  readonly mimetype: string;
  readonly buffer: Buffer;
}

const esquemaDeRevisao = z
  .object({
    state: z.enum(['CONFIRMED', 'CORRECTED', 'DISCARDED']),
    reviewedValue: z.number().finite().positive().nullable().optional(),
    reviewedUnit: z.enum(UNIDADES_DE_MEDIDA as [UnidadeDeMedida, ...UnidadeDeMedida[]]).nullable().optional(),
  })
  .strict();

const esquemaDeConfirmacao = z
  .object({
    /** Instante da MEDICAO -- o documento nem sempre traz. */
    assessedAt: z.iso.datetime(),
  })
  .strict();

/**
 * O corpo do upload viaja como `multipart/form-data` (o arquivo vai no
 * campo `file`), entao `reviewSessionId`/`sourceLabel` chegam como CAMPOS DE
 * TEXTO do mesmo formulario -- nao um `Body()` JSON separado. `z.uuid()`
 * valida o formato antes de tratar como id de sessao real.
 */
const esquemaDoEnvio = z
  .object({
    reviewSessionId: z.uuid().optional(),
    sourceLabel: z.string().min(1).max(120).optional(),
    /**
     * QUAL laudo e este -- declarado por QUEM ENVIA, nunca adivinhado.
     *
     * O OCR de imagem devolve `BIOIMPEDANCE` fixo para toda foto
     * (`anthropic-ocr-extractor.adapter.ts`): balanca e app de analise
     * chegam com o MESMO tipo, e a precedencia do ADR-041 ("a balanca
     * vence") nao tem como escolher entre dois `BIOIMPEDANCE`. Foi o que
     * travou a primeira medicao real: `mais de um valor aceito para o tipo
     * BODY_FAT_MASS`, e nenhuma avaliacao publicada.
     *
     * Classificar aparelho por imagem e o caminho fragil -- num teste com
     * tres arquivos reais o rotulo ja saiu errado em um deles. A tela pede
     * cada laudo no SEU campo (Balanca / Analise / ECG), e o campo diz o
     * que o arquivo e. Determinstico, visivel para quem envia, e sem
     * depender de o modelo acertar.
     *
     * Ausente mantem o comportamento antigo (o extrator decide): a rota
     * continua servindo o cliente que ainda nao manda o campo.
     */
    tipoDeLaudo: z.enum(['BIOIMPEDANCE', 'BIOIMPEDANCE_ANALYSIS', 'ECG']).optional(),

    /**
     * `"true"` marca o ULTIMO arquivo da medicao e dispara a publicacao
     * automatica (ADR-039). Chega como STRING porque o corpo e
     * `multipart/form-data`, onde tudo e texto -- `z.boolean()` recusaria.
     */
    ultimoDaSessao: z
      .enum(['true', 'false'])
      .optional()
      .transform((valor) => valor === 'true'),
  })
  .partial();

interface CampoDto {
  id: string;
  /** Arquivo dono deste campo. `null` so em campo sem vinculo no banco. */
  importId: string | null;
  type: string;
  extractedValue: number | null;
  extractedUnit: string | null;
  confidence: number | null;
  sourceLocation: string | null;
  sourceLabel: string | null;
  /** Faixa do laudo, guardada junto do campo (muda com firmware). */
  referenceMin: number | null;
  referenceMax: number | null;
  standardPercent: number | null;
  /**
   * Leitura do valor contra a faixa, RESOLVIDA NO SERVIDOR.
   *
   * Se cada superficie calculasse a sua, o painel e o totem discordariam no
   * dia em que uma faixa mudasse -- o mesmo braco verde num, amarelo no
   * outro. `UNKNOWN` quando falta valor ou falta faixa: nunca `WITHIN` por
   * omissao, que leria como "dentro do normal" um dado que ninguem mediu.
   */
  leitura: Leitura;
  state: string;
  reviewedValue: number | null;
  reviewedUnit: string | null;
}

interface ImportacaoDto {
  id: string;
  studentId: string;
  status: string;
  originalFilename: string;
  fileType: string;
  extractor: string | null;
  failureReason: string | null;
  assessmentId: string | null;
  createdAt: string;
  /** Em ORDEM DE REVISAO: menor confianca primeiro. */
  fields: CampoDto[];
}

@Controller('api/v1')
export class ImportController {
  constructor(
    private readonly importacoes: ImportService,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Recebe o arquivo (`M3-FR-009`).
   *
   * `health.upload` e nao `health.assess` (ADR-039): com a publicacao
   * automatica quem anexa e a RECEPCAO, e ela nao ve nem edita dado de
   * saude. A separacao do ADR-037 continua -- so mudou que anexar deixou de
   * exigir a permissao de quem mede.
   */
  @Post('students/:id/assessment-imports')
  @RequirePermissions('health.upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TAMANHO_MAXIMO_BYTES } }))
  async enviar(
    @Param('id') studentId: string,
    @UploadedFile() arquivo: ArquivoRecebido | undefined,
    @Body() corpo: unknown,
  ): Promise<{
    id: string;
    status: string;
    extractedFields: number;
    failureReason: string | null;
    reviewSessionId: string;
  }> {
    if (!arquivo) {
      throw new BadRequestException({ code: 'FILE_REQUIRED' });
    }

    const dados = esquemaDoEnvio.parse(corpo);
    const contexto = this.contexto.require();
    const uploader = this.exigirAtor();

    const resultado = await this.importacoes.enviar(
      contexto,
      studentId,
      {
        originalFilename: arquivo.originalname,
        contentType: arquivo.mimetype,
        conteudo: new Uint8Array(arquivo.buffer),
      },
      uploader,
      {
        reviewSessionId: dados.reviewSessionId,
        sourceLabel: dados.sourceLabel,
        tipoDeLaudo: dados.tipoDeLaudo,
        ultimoDaSessao: dados.ultimoDaSessao,
      },
      new Date(),
    );

    return {
      id: resultado.id,
      status: resultado.status,
      extractedFields: resultado.camposExtraidos,
      failureReason: resultado.motivoDaFalha,
      reviewSessionId: resultado.reviewSessionId,
    };
  }

  /**
   * Fila de importacoes que precisam de atencao -- o painel da F22.
   *
   * `EXTRACTED` (esperando revisao), `FAILED` e `INFECTED` num lugar so:
   * quem opera a recepcao age sobre as tres da mesma tela, e separar em
   * abas produziria uma aba que ninguem abre.
   *
   * Rota ANTES de `assessment-imports/:id` de proposito: registrada depois,
   * o Nest casaria `pending` como um `:id` e a fila responderia 404.
   */
  @Get('assessment-imports/pending')
  @RequirePermissions('health.read')
  async fila(): Promise<
    {
      id: string;
      studentId: string;
      status: string;
      originalFilename: string;
      failureReason: string | null;
      pendingFields: number;
      createdAt: string;
    }[]
  > {
    const fila = await this.importacoes.fila(this.contexto.require());

    return fila.map((linha) => ({
      id: linha.id,
      studentId: linha.studentId,
      status: linha.status,
      originalFilename: linha.originalFilename,
      failureReason: linha.failureReason,
      pendingFields: linha.camposPendentes,
      createdAt: linha.createdAt.toISOString(),
    }));
  }

  /**
   * A sessao como a tela de revisao precisa dela (Task 5): arquivos, linhas
   * consolidadas entre eles e se pode confirmar.
   *
   * Rota `assessment-imports/sessions/:sessionId` tem DOIS segmentos depois
   * de `assessment-imports/`, entao `:id` (UM segmento) nunca a engoliria --
   * mas fica ANTES de `:id` de qualquer jeito, seguindo o mesmo cuidado de
   * `pending` acima: registrar rota literal perto de `:id` e um lugar onde
   * vale nao confiar so na contagem de segmentos.
   */
  @Get('assessment-imports/sessions/:sessionId')
  @RequirePermissions('health.read')
  async detalharSessao(@Param('sessionId') sessionId: string): Promise<{
    sessionId: string;
    arquivos: {
      importId: string;
      sourceLabel: string;
      tipoDeLaudo: string;
      status: string;
      failureReason: string | null;
      /**
       * `extracted_attributes` cru do arquivo, OPACO (ADR-035) -- carrega
       * coisas como `ecgFinding`, nunca interpretado aqui nem no cliente,
       * so citado como texto atribuido ao aparelho.
       */
      atributos: Record<string, unknown> | null;
    }[];
    linhas: {
      type: string;
      concordante: boolean;
      origens: string[];
      campos: CampoDto[];
      /** Campo que virou a medida. `null` quando a divergencia nao se resolve. */
      campoPublicadoId: string | null;
    }[];
    podeConfirmar: { pronta: boolean; motivo?: string };
  }> {
    const sessao = await this.importacoes.detalharSessao(this.contexto.require(), sessionId);

    return {
      sessionId: sessao.sessionId,
      arquivos: sessao.arquivos.map((arquivo) => ({
        importId: arquivo.importId,
        sourceLabel: arquivo.sourceLabel,
        tipoDeLaudo: arquivo.tipoDeLaudo,
        // Status e motivo da falha: a tela distingue o laudo que entrou do
        // que o extrator nao conseguiu ler, e diz POR QUE nao leu.
        status: arquivo.status ?? 'UNKNOWN',
        failureReason: arquivo.failureReason ?? null,
        atributos: arquivo.atributos ?? null,
      })),
      linhas: sessao.linhas.map((linha) => ({
        type: linha.type,
        concordante: linha.concordante,
        origens: [...linha.origens],
        campos: linha.campos.map(paraCampoDto),
        /**
         * Qual campo VIROU a medida da avaliacao (ADR-041).
         *
         * A tela nao pode deduzir isso da ordem do array: a precedencia de
         * origem mora no dominio (`desempatarPorOrigem`), e uma segunda
         * implementacao no cliente divergiria da primeira na primeira
         * mudanca de regra -- com a tela mostrando um valor e o historico
         * guardando outro, que e a pior forma de erro possivel em dado de
         * saude.
         *
         * `null` quando a divergencia NAO se resolve (dois laudos do mesmo
         * tipo discordando): ai nao houve vencedor, a confirmacao falhou, e
         * a tela precisa dizer isso em vez de eleger um lado.
         */
        campoPublicadoId: campoQueVirouMedida(linha, sessao.arquivos)?.id ?? null,
      })),

      podeConfirmar: sessao.podeConfirmar.pronta
        ? { pronta: true }
        : { pronta: false, motivo: sessao.podeConfirmar.motivo },
    };
  }

  /**
   * Confirma a sessao inteira e cria UMA avaliacao com as medidas de TODOS
   * os arquivos (Task 5).
   */
  @Post('assessment-imports/sessions/:sessionId/confirm')
  @RequirePermissions('health.assess')
  async confirmarSessao(
    @Param('sessionId') sessionId: string,
    @Body() corpo: unknown,
  ): Promise<{ assessmentId: string }> {
    const dados = esquemaDeConfirmacao.parse(corpo);

    return this.importacoes.confirmarSessao(
      this.contexto.require(),
      sessionId,
      this.exigirAtor(),
      new Date(dados.assessedAt),
      new Date(),
    );
  }

  /**
   * URL assinada do arquivo original -- a tela mostra a MINIATURA do laudo
   * em vez do nome do arquivo (ADR-041).
   *
   * `health.read` e nao `health.assess`: ver o laudo que ja esta na tela de
   * revisao e leitura, e quem opera a revisao ja tem essa permissao.
   *
   * Devolve `{ url: null }` -- e nao 404 -- quando o arquivo foi expurgado
   * apos a confirmacao: para quem chama, "esta importacao existe e o arquivo
   * ja foi apagado" e uma resposta legitima, nao um recurso ausente. Um 404
   * aqui faria a tela tratar retencao cumprida como erro.
   */
  @Get('assessment-imports/:id/file-url')
  @RequirePermissions('health.read')
  async urlDoArquivo(
    @Param('id') importId: string,
  ): Promise<{ url: string | null; contentType: string | null }> {
    const arquivo = await this.importacoes.urlDoArquivo(this.contexto.require(), importId);

    return arquivo ?? { url: null, contentType: null };
  }

  @Get('assessment-imports/:id')
  @RequirePermissions('health.read')
  async detalhar(@Param('id') importId: string): Promise<ImportacaoDto> {
    const importacao = await this.importacoes.detalhar(this.contexto.require(), importId);

    return {
      id: importacao.id,
      studentId: importacao.studentId,
      status: importacao.status,
      originalFilename: importacao.originalFilename,
      fileType: importacao.fileType,
      extractor: importacao.extractor,
      failureReason: importacao.failureReason,
      assessmentId: importacao.assessmentId,
      createdAt: importacao.createdAt.toISOString(),
      fields: importacao.campos.map(paraCampoDto),
    };
  }

  /** Decisao do avaliador sobre UM campo (`M3-FR-011`). */
  @Post('assessment-imports/:id/fields/:fieldId')
  @RequirePermissions('health.assess')
  async revisar(
    @Param('id') importId: string,
    @Param('fieldId') fieldId: string,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    const dados = esquemaDeRevisao.parse(corpo);

    await this.importacoes.revisarCampo(this.contexto.require(), importId, fieldId, {
      state: dados.state,
      reviewedValue: dados.reviewedValue ?? null,
      reviewedUnit: dados.reviewedUnit ?? null,
    });

    return { ok: true };
  }

  /**
   * Confirma a revisao e cria a avaliacao (INV-103).
   *
   * Campo pendente responde 409 com o `fieldId` -- a tela leva o avaliador
   * direto ao que falta, em vez de dizer so "nao pode".
   */
  @Post('assessment-imports/:id/confirm')
  @RequirePermissions('health.assess')
  async confirmar(
    @Param('id') importId: string,
    @Body() corpo: unknown,
  ): Promise<{ assessmentId: string }> {
    const dados = esquemaDeConfirmacao.parse(corpo);

    return this.importacoes.confirmar(
      this.contexto.require(),
      importId,
      this.exigirAtor(),
      new Date(dados.assessedAt),
      new Date(),
    );
  }

  @Post('assessment-imports/:id/discard')
  @RequirePermissions('health.assess')
  async descartar(@Param('id') importId: string): Promise<{ ok: true }> {
    await this.importacoes.descartar(
      this.contexto.require(),
      importId,
      this.exigirAtor(),
      new Date(),
    );

    return { ok: true };
  }

  /**
   * O ator e obrigatorio em toda rota desta fatia.
   *
   * Quem envia e quem revisa precisam ter dono: `CONFIRMED` sem revisor e o
   * OCR publicando sozinho, e a constraint do banco recusa a linha.
   */
  private exigirAtor(): string {
    const ator = this.contexto.require().actorId;

    if (!ator) throw new BadRequestException({ code: 'ACTOR_REQUIRED' });

    return ator;
  }
}

/**
 * Um campo extraido, como a tela de revisao precisa dele.
 *
 * Existe em vez de dois mapeamentos inline porque a rota da sessao e a do
 * import avulso devolvem o MESMO campo -- e quando eram duas copias, a
 * segunda ficou sem `sourceLabel` por um tempo sem ninguem notar.
 *
 * A `leitura` sai daqui e nao do cliente: e a mesma razao do
 * `body-evolution`. Faixa de referencia e do fabricante, muda com firmware,
 * e duas superficies calculando a sua propria discordariam no dia da troca.
 */
function paraCampoDto(campo: CampoExtraido): CampoDto {
  const valor = campo.reviewedValue ?? campo.extractedValue;

  return {
    id: campo.id,
    // O arquivo dono do campo -- a tela precisa dele para ligar valor a
    // laudo. Casar por `sourceLabel` nao serve: o rotulo do campo vem do
    // nome do arquivo enviado e o do arquivo vem do conteudo extraido.
    importId: campo.importId,
    type: campo.type,
    extractedValue: campo.extractedValue,
    extractedUnit: campo.extractedUnit,
    confidence: campo.confidence,
    sourceLocation: campo.sourceLocation,
    sourceLabel: campo.sourceLabel,
    referenceMin: campo.referenceMin,
    referenceMax: campo.referenceMax,
    standardPercent: campo.standardPercent,
    leitura: lerFaixa(valor, campo.referenceMin, campo.referenceMax),
    state: campo.state,
    reviewedValue: campo.reviewedValue,
    reviewedUnit: campo.reviewedUnit,
  };
}
