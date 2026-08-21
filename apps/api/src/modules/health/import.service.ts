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
  type ImportacaoComCampos,
} from './import.repository.js';
import { aceitarArquivo } from './domain/arquivo-de-importacao.js';
import { converterParaCanonica } from './domain/medida.js';
import {
  ordemDeRevisao,
  revisaoCompleta,
  valoresAceitos,
  type EstadoDoCampo,
} from './domain/revisao-de-importacao.js';
import type { UnidadeDeMedida } from './domain/medida.js';
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

    const importacao = await this.importacoes.criar(contexto, {
      studentId,
      originalFilename: arquivo.originalFilename,
      fileType: aceitacao.tipo,
      fileSizeBytes: arquivo.conteudo.byteLength,
      uploadedByUserId: uploaderId,
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
        extracao.campos,
      );

      return {
        id: importacao.id,
        status: 'EXTRACTED',
        camposExtraidos: extracao.campos.length,
        motivoDaFalha: null,
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
      };
    }
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
