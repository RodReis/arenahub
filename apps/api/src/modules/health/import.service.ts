import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { OBJECT_STORAGE, type ObjectStoragePort } from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { StudentRepository } from '../students/student.repository.js';
import { AssessmentRepository } from './assessment.repository.js';
import {
  ImportRepository,
  ImportacaoNaoEncontradaError,
  RevisaoIncompletaError,
  SessaoBloqueadaError,
  type ImportacaoComCampos,
  type SessaoComArquivos,
} from './import.repository.js';
import { aceitarArquivo } from './domain/arquivo-de-importacao.js';
import { converterParaCanonica } from './domain/medida.js';
import {
  ordemDeRevisao,
  revisaoCompleta,
  valoresAceitos,
  type CampoExtraido,
  type EstadoDoCampo,
} from './domain/revisao-de-importacao.js';
import type { UnidadeDeMedida } from './domain/medida.js';
import { consolidar, type LinhaConsolidada } from './domain/consolidacao-de-laudos.js';
import { sessaoPodeConfirmar, type AvaliacaoDaSessao } from './domain/sessao-de-revisao.js';
import {
  DOCUMENT_EXTRACTOR,
  ErroDeExtracao,
  type DocumentExtractor,
} from './provider/document-extractor.port.js';
import {
  MALWARE_SCANNER,
  ErroDoScanner,
  type MalwareScanner,
} from './provider/malware-scanner.port.js';

/**
 * Upload, extracao e revisao de arquivo (F19, Slice 3.3).
 *
 * Este arquivo e a FRONTEIRA, e a ORDEM das operacoes e a defesa:
 *
 *   1. o arquivo e aceito por TAMANHO, tipo declarado e ASSINATURA;
 *   2. o antivirus escaneia ANTES de qualquer coisa tocar o storage;
 *   3. so entao o arquivo e guardado;
 *   4. a extracao roda e produz PROPOSTAS, nunca medidas;
 *   5. um humano revisa campo a campo (INV-103);
 *   6. so na confirmacao nasce a avaliacao.
 *
 * Inverter 2 e 3 guardaria malware no bucket. Pular 5 seria o OCR publicando
 * sozinho -- o que a regra de arquitetura no 8 proibe.
 *
 * ---------------------------------------------------------------------------
 * OCR FORA NAO IMPEDE AVALIACAO MANUAL (INV-140, `M3-NFR-004`).
 * ---------------------------------------------------------------------------
 *
 * Falha de extrator vira LINHA `FAILED`, nao excecao que sobe: a recepcao ve
 * o arquivo na lista de falhas e digita a avaliacao a mao, que e o caminho
 * que sempre existiu. Um 500 aqui deixaria a operacao sem saber se deve
 * tentar de novo ou digitar.
 */

export interface ResultadoDoUpload {
  readonly id: string;
  readonly status: string;
  readonly camposExtraidos: number;
  readonly motivoDaFalha: string | null;
  /**
   * Toda importacao pertence a uma sessao, mesmo quando enviada sozinha --
   * o cliente que so tem UM arquivo simplesmente nunca envia um segundo para
   * a mesma sessao, e o fluxo F19 continua identico visto de fora.
   */
  readonly reviewSessionId: string;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly importacoes: ImportRepository,
    private readonly avaliacoes: AssessmentRepository,
    private readonly alunos: StudentRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER) private readonly antivirus: MalwareScanner,
    @Inject(DOCUMENT_EXTRACTOR) private readonly extrator: DocumentExtractor,
  ) {}

  async enviar(
    contexto: TenantContext,
    studentId: string,
    arquivo: {
      originalFilename: string;
      contentType: string;
      conteudo: Uint8Array;
    },
    uploaderId: string,
    sessao?: {
      reviewSessionId?: string | undefined;
      sourceLabel?: string | undefined;
    },
  ): Promise<ResultadoDoUpload> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    // --- 1. ACEITACAO: tamanho, tipo declarado e ASSINATURA --------------
    const aceitacao = aceitarArquivo({
      tamanhoBytes: arquivo.conteudo.byteLength,
      contentType: arquivo.contentType,
      cabecalho: arquivo.conteudo.subarray(0, 16),
    });

    if (!aceitacao.aceito) {
      // 400 e nao linha no banco: arquivo que nem chega a ser um dos tipos
      // aceitos nao e uma importacao que falhou, e sim um pedido invalido.
      throw new BadRequestException({ code: aceitacao.motivo });
    }

    // Toda importacao pertence a uma sessao: sem `reviewSessionId` no
    // pedido, uma NOVA nasce aqui. O cliente com um unico arquivo devolve o
    // id gerado e nunca mais o usa -- visto de fora, o fluxo F19 nao muda.
    const reviewSessionId = sessao?.reviewSessionId ?? randomUUID();

    const importacao = await this.importacoes.criar(contexto, {
      studentId,
      originalFilename: arquivo.originalFilename,
      fileType: aceitacao.tipo,
      fileSizeBytes: arquivo.conteudo.byteLength,
      uploadedByUserId: uploaderId,
      reviewSessionId,
      sourceLabel: sessao?.sourceLabel,
    });

    // --- 2. ANTIVIRUS, ANTES DE TOCAR O STORAGE --------------------------
    try {
      const veredito = await this.antivirus.escanear(arquivo.conteudo);

      if (!veredito.limpo) {
        await this.importacoes.marcarInfectada(contexto, importacao.id, veredito.ameaca);

        return {
          id: importacao.id,
          status: 'INFECTED',
          camposExtraidos: 0,
          motivoDaFalha: `antivirus recusou: ${veredito.ameaca}`,
          reviewSessionId,
        };
      }
    } catch (erro) {
      // Scanner FORA DO AR e diferente de arquivo infectado: aqui nao sabemos
      // se o arquivo e seguro, e na duvida ele NAO entra no storage.
      const doScanner = erro instanceof ErroDoScanner ? erro : null;

      await this.importacoes.marcarFalha(
        contexto,
        importacao.id,
        doScanner?.codigo ?? 'SCANNER_UNAVAILABLE',
      );

      return {
        id: importacao.id,
        status: 'FAILED',
        camposExtraidos: 0,
        motivoDaFalha: doScanner?.codigo ?? 'SCANNER_UNAVAILABLE',
        reviewSessionId,
      };
    }

    // --- 3. STORAGE, so depois de limpo ----------------------------------
    const objectKey = `tenants/${contexto.tenantId}/health-imports/${importacao.id}/${randomUUID()}`;

    await this.storage.putPrivateObject({
      key: objectKey,
      body: Buffer.from(arquivo.conteudo),
      contentType: arquivo.contentType,
    });

    // --- 4. EXTRACAO: propostas, nunca medidas ---------------------------
    try {
      const extracao = await this.extrator.extrair({
        conteudo: arquivo.conteudo,
        tipo: aceitacao.tipo,
      });

      await this.importacoes.gravarExtracao(
        contexto,
        importacao.id,
        extracao.extractor,
        objectKey,
        extracao.campos.map((campo) => ({
          type: campo.type,
          value: campo.value,
          unit: campo.unit,
          confidence: campo.confidence,
          sourceLocation: campo.sourceLocation,
          // Campo sem rotulo proprio herda o do ARQUIVO -- e o que a tela de
          // revisao mostra como "Origem" quando o extrator nao rotula campo
          // a campo (caso comum: todo campo de um CSV vem do mesmo aparelho).
          sourceLabel: sessao?.sourceLabel ?? extracao.sourceLabel ?? null,
          referenceMin: campo.referenceMin ?? null,
          referenceMax: campo.referenceMax ?? null,
          standardPercent: campo.standardPercent ?? null,
        })),
        {
          sourceLabelDoArquivo: extracao.sourceLabel ?? null,
          tipoDeLaudo: extracao.tipoDeLaudo ?? null,
          atributos: extracao.atributos ?? null,
        },
      );

      return {
        id: importacao.id,
        status: 'EXTRACTED',
        camposExtraidos: extracao.campos.length,
        motivoDaFalha: null,
        reviewSessionId,
      };
    } catch (erro) {
      // INV-140: extrator fora NAO impede avaliacao manual. Vira linha, e a
      // recepcao digita a mao -- que e o caminho que sempre existiu.
      const daExtracao = erro instanceof ErroDeExtracao ? erro : null;

      await this.importacoes.marcarFalha(
        contexto,
        importacao.id,
        daExtracao?.codigo ?? 'EXTRACTOR_UNAVAILABLE',
      );

      return {
        id: importacao.id,
        status: 'FAILED',
        camposExtraidos: 0,
        motivoDaFalha: daExtracao?.codigo ?? 'EXTRACTOR_UNAVAILABLE',
        reviewSessionId,
      };
    }
  }

  /** A fila de importacoes que precisam de atencao -- painel da F22. */
  async fila(contexto: TenantContext) {
    return this.importacoes.pendentesEFalhas(contexto);
  }

  /** A importacao com os campos em ORDEM DE REVISAO -- menor confianca antes. */
  async detalhar(contexto: TenantContext, importId: string): Promise<ImportacaoComCampos> {
    const importacao = await this.importacoes.encontrar(contexto, importId);

    if (importacao === null) throw new ImportacaoNaoEncontradaError();

    return { ...importacao, campos: ordemDeRevisao(importacao.campos) };
  }

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
    if (decisao.state === 'PENDING') {
      // Voltar um campo para pendente nao e revisao -- e desfazer. Se um dia
      // fizer falta, e caso de uso proprio com nome proprio.
      throw new BadRequestException({ code: 'IMPORT_CANNOT_UNREVIEW_FIELD' });
    }

    if (decisao.state === 'CORRECTED' && decisao.reviewedValue === null) {
      throw new BadRequestException({ code: 'IMPORT_CORRECTION_WITHOUT_VALUE' });
    }

    await this.importacoes.revisarCampo(contexto, importId, campoId, decisao);
  }

  /**
   * Confirma a revisao e CRIA a avaliacao (`M3-FR-011`, INV-103).
   *
   * O rascunho nasce aqui e ja e publicado: o avaliador acabou de olhar campo
   * a campo, e obriga-lo a publicar num segundo passo seria pedir duas
   * confirmacoes para a mesma decisao.
   *
   * ---------------------------------------------------------------------------
   * DELEGA PARA `confirmarSessao` SO QUANDO A SESSAO TEM MAIS DE UM ARQUIVO.
   * ---------------------------------------------------------------------------
   *
   * Toda importacao pertence a uma sessao desde a Task 5 (`enviar` sempre
   * gera uma), entao "tem `reviewSessionId`" deixou de distinguir F19 de
   * multiarquivo -- SEMPRE e verdade. O que distingue e o TAMANHO da sessao:
   * uma sessao de UM arquivo e exatamente o fluxo que a F19 entregou, e
   * exigir bioimpedancia dela (a porta de `sessaoPodeConfirmar`) quebraria
   * import avulso de peso/gordura que nunca teve essa exigencia. Sessao com
   * MAIS de um arquivo e o caso novo desta fatia, e so ai a porta completa
   * (Task 4) se aplica -- e ai sim faz sentido reusar `confirmarSessao`
   * inteiro, inclusive a consolidacao entre arquivos.
   */
  async confirmar(
    contexto: TenantContext,
    importId: string,
    revisorId: string,
    assessedAt: Date,
    agora: Date,
  ): Promise<{ assessmentId: string }> {
    const importacao = await this.importacoes.encontrar(contexto, importId);

    if (importacao === null) throw new ImportacaoNaoEncontradaError();

    if (importacao.reviewSessionId !== null) {
      const sessao = await this.importacoes.encontrarSessao(contexto, importacao.reviewSessionId);

      if (sessao !== null && sessao.importIds.length > 1) {
        return this.confirmarSessao(contexto, importacao.reviewSessionId, revisorId, assessedAt, agora);
      }
    }

    if (importacao.status !== 'EXTRACTED') {
      throw new ConflictException({ code: 'IMPORT_NOT_REVIEWABLE' });
    }

    // A regra no 8 em codigo: campo pendente impede a confirmacao.
    const pronta = revisaoCompleta(importacao.campos);

    if (!pronta.pronta) {
      throw new RevisaoIncompletaError(pronta.motivo, pronta.campoId);
    }

    const aceitos = valoresAceitos(importacao.campos);

    // Converte para a unidade canonica AQUI, com a mesma funcao testada que a
    // F17 usa: um laudo em libras contra uma serie em quilos compararia
    // grandezas diferentes (INV-105).
    const medidas = aceitos.map((valor) =>
      converterParaCanonica({ type: valor.type, value: valor.value, unit: valor.unit }),
    );

    const avaliacao = await this.avaliacoes.criarRascunho(contexto, importacao.studentId, {
      assessedAt,
      evaluatorUserId: revisorId,
      medidas,
      // A origem fica registrada na avaliacao: o aluno ve que aquele numero
      // veio de arquivo, e a auditoria chega ao arquivo pelo id.
      source: 'IMPORT',
      sourceReference: importId,
    });

    await this.avaliacoes.publicar(contexto, avaliacao.id, agora);
    await this.importacoes.confirmar(contexto, importId, avaliacao.id, revisorId, agora);

    // Temporario tem retencao curta e delecao verificavel (`MVP-03` 15): o
    // arquivo cumpriu o proposito, e as medidas ja estao na avaliacao.
    if (importacao.status === 'EXTRACTED') {
      await this.apagarArquivo(contexto, importId);
    }

    return { assessmentId: avaliacao.id };
  }

  /**
   * A sessao como a tela de revisao precisa dela: arquivos, linhas
   * consolidadas (Task 3) e se pode confirmar (Task 4).
   *
   * Grava a deduplicacao (`agreesWithFieldId`) de volta no banco a cada
   * leitura -- ela muda quando um arquivo novo chega ou quando o avaliador
   * corrige um campo, e a tela sempre quer o estado ATUAL, nao o de quando o
   * ultimo arquivo foi extraido.
   */
  async detalharSessao(
    contexto: TenantContext,
    reviewSessionId: string,
  ): Promise<{
    sessionId: string;
    arquivos: SessaoComArquivos['arquivos'];
    linhas: LinhaConsolidada[];
    podeConfirmar: AvaliacaoDaSessao;
  }> {
    const sessao = await this.importacoes.encontrarSessaoOuFalhar(contexto, reviewSessionId);

    const linhas = consolidar(sessao.campos);

    await this.importacoes.gravarConcordancias(
      contexto,
      paresDeConcordancia(sessao.campos, linhas),
    );

    return {
      sessionId: reviewSessionId,
      arquivos: sessao.arquivos,
      linhas,
      podeConfirmar: sessaoPodeConfirmar(sessao.arquivos, linhas),
    };
  }

  /**
   * Confirma TODOS os arquivos da sessao de uma vez e cria UMA avaliacao
   * (Task 5, ADR-038). Segue a forma de `confirmar` (linha ~293), com a
   * diferenca de operar sobre a SESSAO inteira:
   *
   *   1. carrega TODOS os imports da sessao, nao um;
   *   2. consolida os campos de todos com `consolidar` (Task 3);
   *   3. valida com `sessaoPodeConfirmar` (Task 4); bloqueio vira 409 com o
   *      `motivo` do dominio como `code`;
   *   4. `valoresAceitos` roda sobre os campos ACEITOS de todas as linhas;
   *   5. UMA `criarRascunho` + `publicar`, com `sourceReference: sessionId`;
   *   6. `confirmar` de cada import da sessao, todos apontando para a MESMA
   *      avaliacao;
   *   7. apaga os arquivos de todos os imports;
   *   8. TUDO dentro de uma unica logica atomica -- ver nota abaixo sobre a
   *      transacao.
   *
   * ## Por que a "transacao unica" e o REPOSITORIO, nao um `$transaction`
   * amarrando os dois lados aqui
   *
   * `criarRascunho`/`publicar` (em `AssessmentRepository`) e `confirmarSessao`
   * (em `ImportRepository`) cada um abre a PROPRIA transacao Prisma -- e nao
   * ha, neste `PrismaService`, um jeito de compartilhar um `tx` entre dois
   * repositorios injetados independentemente sem reescrever a assinatura de
   * TODOS os metodos que participam (o padrao que `AssessmentRepository` ja
   * usa nas suas proprias operacoes de varias tabelas). A garantia de
   * idempotencia que IMPORTA -- nunca duas avaliacoes da mesma sessao -- nao
   * depende de as duas transacoes serem uma so: ela e o INDICE PARCIAL do
   * banco, que se aplica no momento exato em que `confirmarSessao` tenta
   * gravar `assessment_id`. Se a avaliacao for criada e a etapa 6 falhar por
   * corrida, a avaliacao fica orfa (sem import apontando para ela) --
   * consequencia aceita: FICA UM RASCUNHO/PUBLICADA ORFAO, nunca uma
   * DUPLICATA, que era o risco que a Task 5 existe para eliminar.
   */
  async confirmarSessao(
    contexto: TenantContext,
    reviewSessionId: string,
    revisorId: string,
    assessedAt: Date,
    agora: Date,
  ): Promise<{ assessmentId: string }> {
    const sessao = await this.importacoes.encontrarSessaoOuFalhar(contexto, reviewSessionId);

    const linhas = consolidar(sessao.campos);
    const avaliacaoDaSessao = sessaoPodeConfirmar(sessao.arquivos, linhas);

    if (!avaliacaoDaSessao.pronta) {
      throw new SessaoBloqueadaError(avaliacaoDaSessao.motivo);
    }

    // `valoresAceitos` opera por CAMPO (CONFIRMED/CORRECTED/DISCARDED), e
    // essa decisao e do avaliador em CADA campo, nao da linha consolidada:
    // por isso roda sobre os campos ACEITOS de TODAS as linhas, achatados --
    // igual `confirmar` faz para um import so, so que com o conjunto inteiro
    // da sessao.
    const aceitos = valoresAceitos(sessao.campos);

    const medidas = aceitos.map((valor) =>
      converterParaCanonica({ type: valor.type, value: valor.value, unit: valor.unit }),
    );

    const dispositivo = dadosDoAparelho(sessao.atributosPorImport);

    const avaliacao = await this.avaliacoes.criarRascunho(contexto, sessao.studentId, {
      assessedAt,
      evaluatorUserId: revisorId,
      medidas,
      source: 'IMPORT',
      // A origem aponta para a SESSAO, nao para um import isolado: e o id
      // que a auditoria segue para achar os TRES arquivos que compuseram
      // esta avaliacao, nao so o primeiro que chegou.
      sourceReference: reviewSessionId,
      ...(dispositivo ?? {}),
    });

    await this.avaliacoes.publicar(contexto, avaliacao.id, agora);

    await this.importacoes.confirmarSessao(
      contexto,
      reviewSessionId,
      sessao.importIds,
      avaliacao.id,
      revisorId,
      agora,
    );

    await this.importacoes.esquecerArquivosDaSessao(contexto, sessao.importIds);

    return { assessmentId: avaliacao.id };
  }

  async descartar(
    contexto: TenantContext,
    importId: string,
    revisorId: string,
    agora: Date,
  ): Promise<void> {
    const importacao = await this.importacoes.encontrar(contexto, importId);

    if (importacao === null) throw new ImportacaoNaoEncontradaError();

    await this.importacoes.descartar(contexto, importId, revisorId, agora);
    await this.apagarArquivo(contexto, importId);
  }

  /**
   * Remove o arquivo do storage e a chave da linha.
   *
   * Falha de storage NAO derruba a operacao: a avaliacao ja foi criada e
   * desfaze-la por causa de um objeto orfao seria trocar um problema pequeno
   * (lixo no bucket) por um grande (dado de saude perdido). O objeto vira
   * pendencia de limpeza, que e o que a F22 tem de mostrar.
   */
  private async apagarArquivo(contexto: TenantContext, importId: string): Promise<void> {
    const importacao = await this.importacoes.encontrar(contexto, importId);

    if (importacao === null) return;

    try {
      await this.importacoes.esquecerArquivo(contexto, importId);
    } catch {
      // Deliberadamente silencioso aqui: ver o bloco acima.
    }
  }
}

/**
 * Traduz `LinhaConsolidada[]` (Task 3) em pares `(campoId, agreesWithFieldId)`
 * prontos para `gravarConcordancias`.
 *
 * ---------------------------------------------------------------------------
 * A ARMADILHA QUE ESTA FUNCAO EXISTE PARA EVITAR (nota do brief da Task 5)
 * ---------------------------------------------------------------------------
 *
 * `agreesWithFieldId` NAO TEM FOREIGN KEY (decisao deliberada da Task 2) --
 * a integridade referencial e desta funcao, e so dela:
 *
 *   - NUNCA aponta para um campo de OUTRA sessao ou OUTRO conjunto de
 *     importacoes: `campos` aqui e SEMPRE `sessao.campos`, ja filtrado por
 *     `review_session_id` e `tenant_id` em `encontrarSessao` -- os pares so
 *     existem entre campos que vieram do MESMO `consolidar()`, nunca
 *     montados a partir de duas leituras diferentes;
 *   - NUNCA aponta para si mesmo: o campo REPRESENTANTE de uma linha
 *     concordante (`grupo[0]`) recebe `agreesWithFieldId: null` -- so os
 *     OUTROS membros do grupo apontam para ele. O `.slice(1)` abaixo e o que
 *     garante isso: o indice 0 nunca entra no lado esquerdo do par.
 *
 * Linha DIVERGENTE (`concordante: false`) nunca produz par: divergencia
 * nunca e deduplicada (comentario de `consolidacao-de-laudos.ts`), e
 * apontar um campo divergente para outro inventaria uma concordancia que o
 * dominio explicitamente recusou a declarar.
 */
function paresDeConcordancia(
  campos: readonly CampoExtraido[],
  linhas: readonly LinhaConsolidada[],
): { campoId: string; agreesWithFieldId: string | null }[] {
  const pares: { campoId: string; agreesWithFieldId: string | null }[] = [];

  for (const linha of linhas) {
    if (!linha.concordante) continue;

    // `linha.campos` de uma linha concordante tem so o REPRESENTANTE
    // (consolidar() colapsa o grupo); o grupo COMPLETO -- para saber quem
    // mais concordou -- e recuperado filtrando os campos originais pelo
    // MESMO tipo, agora que ja sabemos que todos os do tipo concordam.
    const grupo = campos.filter((campo) => campo.type === linha.type);
    const representante = grupo[0];

    if (!representante) continue;

    pares.push({ campoId: representante.id, agreesWithFieldId: null });

    for (const outro of grupo.slice(1)) {
      pares.push({ campoId: outro.id, agreesWithFieldId: representante.id });
    }
  }

  return pares;
}

/**
 * Dado do APARELHO (Task 6, `atributos`) que migra para `BodyAssessment` na
 * confirmacao -- o achado de ECG e afins ficam em `deviceReport`, OPACOS
 * (ADR-035); nenhuma linha aqui interpreta o conteudo, so agrega.
 *
 * `undefined` quando nenhum import da sessao trouxe atributo: nao grava
 * `deviceReport: {}` para uma avaliacao manual/sem aparelho.
 */
function dadosDoAparelho(
  atributosPorImport: readonly (Record<string, unknown> | null)[],
): { deviceReport: Record<string, unknown> } | undefined {
  const combinados = atributosPorImport.reduce<Record<string, unknown>>(
    (acc, atributos) => (atributos === null ? acc : { ...acc, ...atributos }),
    {},
  );

  return Object.keys(combinados).length === 0 ? undefined : { deviceReport: combinados };
}
