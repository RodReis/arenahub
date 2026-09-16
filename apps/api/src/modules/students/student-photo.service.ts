import { Inject, Injectable } from '@nestjs/common';

import {
  MALWARE_SCANNER,
  ErroDoScanner,
  type MalwareScanner,
} from '../../common/antivirus/malware-scanner.port.js';
import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  aceitarFotoDoAluno,
  chaveDeFotoPertenceA,
  montarChaveDeFoto,
  type ContentTypeDeFoto,
  type MotivoDeRecusaDeFoto,
} from './domain/foto-do-aluno.js';

export interface ArquivoDeFoto {
  readonly contentType: string;
  readonly conteudo: Uint8Array;
}

export class AlunoNaoEncontradoParaFotoError extends ErroDeDominio {
  constructor() {
    super('STUDENT_NOT_FOUND', 404, 'Aluno não encontrado');
  }
}

export class FotoDoAlunoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('STUDENT_PHOTO_NOT_FOUND', 404, 'Foto não encontrada');
  }
}

/**
 * Foto do aluno na ficha do painel -- F72 (issue #348).
 *
 * MESMA ORDEM DE OPERACOES do `BrandingService`: formato -> antivirus ->
 * storage. Inverter as duas ultimas guardaria malware no bucket.
 */
@Injectable()
export class StudentPhotoService {
  constructor(
    private readonly db: PrismaService,
    @Inject(MALWARE_SCANNER) private readonly antivirus: MalwareScanner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * Substitui a foto do aluno.
   *
   * Grava a chave NOVA na coluna e apaga o objeto anterior so DEPOIS de a
   * coluna ja apontar para o novo -- na ordem contraria, uma falha entre o
   * delete e o update deixaria a coluna apontando para objeto que nao existe
   * mais.
   */
  async substituir(
    contexto: TenantContext,
    studentId: string,
    arquivo: ArquivoDeFoto,
  ): Promise<{ objectKey: string }> {
    // O ALUNO ANTES DE TUDO -- escanear e gravar no bucket so para descobrir
    // depois que o id nao existe deixaria um objeto orfao no bucket.
    const anterior = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: studentId, tenantId: contexto.tenantId },
        select: { photoObjectKey: true },
      }),
    );

    if (!anterior) throw new AlunoNaoEncontradoParaFotoError();

    // --- 1. FORMATO ------------------------------------------------------
    const aceitacao = aceitarFotoDoAluno(arquivo);

    if (!aceitacao.aceito) {
      throw new ErroDeDominio(aceitacao.motivo, 400, MENSAGEM_DE_RECUSA[aceitacao.motivo]);
    }

    // --- 2. ANTIVIRUS, ANTES DE TOCAR O STORAGE --------------------------
    let veredito;

    try {
      veredito = await this.antivirus.escanear(arquivo.conteudo);
    } catch (erro) {
      // Scanner FORA DO AR e diferente de arquivo infectado: na duvida o
      // arquivo NAO entra no storage.
      if (erro instanceof ErroDoScanner) {
        throw new ErroDeDominio(erro.codigo, 503, 'Antivírus indisponível. Tente de novo.');
      }

      throw erro;
    }

    if (!veredito.limpo) {
      throw new ErroDeDominio('FILE_INFECTED', 422, 'Arquivo recusado pelo antivírus.');
    }

    // --- 3. STORAGE, so depois de limpo -----------------------------------
    const contentType = arquivo.contentType.toLowerCase() as ContentTypeDeFoto;
    const objectKey = montarChaveDeFoto(contexto.tenantId, studentId, contentType);

    await this.storage.putPrivateObject({
      key: objectKey,
      body: Buffer.from(arquivo.conteudo),
      contentType,
    });

    await this.db.comTenant((tx) =>
      tx.student.update({
        where: { id: studentId },
        data: { photoObjectKey: objectKey },
      }),
    );

    const chaveAntiga = anterior.photoObjectKey;

    // Apaga o orfao SO depois de a coluna ja apontar para o arquivo novo, e
    // so quando a chave mudou de verdade (mesmo aluno reenviando o mesmo
    // formato produz a mesma chave).
    if (chaveAntiga !== null && chaveAntiga !== objectKey) {
      await this.storage.deletePrivateObject(chaveAntiga);
    }

    return { objectKey };
  }

  /**
   * Os bytes da foto do aluno.
   *
   * CONFERE O PERTENCIMENTO antes de ler -- mesma disciplina de
   * `BrandingService.lerArquivo`: a chave sai de uma coluna do banco, e
   * servir o que a coluna disser sem olhar o prefixo entregaria a foto de um
   * aluno de outro tenant a quem escrevesse a chave errada naquele campo.
   */
  async lerArquivo(
    contexto: TenantContext,
    studentId: string,
  ): Promise<{ body: Buffer; contentType: string }> {
    const aluno = await this.db.comTenant((tx) =>
      tx.student.findFirst({
        where: { id: studentId, tenantId: contexto.tenantId },
        select: { photoObjectKey: true },
      }),
    );

    if (!aluno) throw new AlunoNaoEncontradoParaFotoError();

    const chave = aluno.photoObjectKey;

    if (chave === null || !chaveDeFotoPertenceA(chave, contexto.tenantId)) {
      throw new FotoDoAlunoNaoEncontradaError();
    }

    try {
      return await this.storage.getPrivateObject(chave);
    } catch {
      // OBJETO SUMIU DO BUCKET: a coluna aponta para o que nao existe mais.
      // Vira 404, e nao 500 -- para a ficha o efeito e o mesmo de nunca ter
      // enviado foto.
      throw new FotoDoAlunoNaoEncontradaError();
    }
  }
}

const MENSAGEM_DE_RECUSA: Readonly<Record<MotivoDeRecusaDeFoto, string>> = {
  FILE_TOO_LARGE: 'Arquivo grande demais. O limite é 5 MB.',
  FILE_EMPTY: 'Arquivo vazio.',
  FILE_TYPE_NOT_ALLOWED: 'Formato não aceito. Envie JPEG ou PNG.',
  FILE_SIGNATURE_MISMATCH: 'O conteúdo do arquivo não corresponde ao formato informado.',
};
