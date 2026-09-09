import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';

import type { ConfigDeStorage } from '../../config/env.js';
import type {
  ContentTypeDeCadastro,
  MetadadosDeObjeto,
  ObjectStoragePort,
  UploadPrivado,
} from './object-storage.port.js';

/**
 * Implementacao S3-compativel da porta. MinIO em desenvolvimento, S3 em
 * producao -- mesma API, muda so o endpoint.
 */
@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  private readonly cliente: S3Client;

  constructor(private readonly config: ConfigDeStorage) {
    this.cliente = new S3Client({
      region: config.regiao,
      // `forcePathStyle`: MinIO nao faz bucket como subdominio. Sem isto o SDK
      // tenta `http://bucket.localhost:9000` e o DNS local nao resolve.
      forcePathStyle: true,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async createPrivateUpload(entrada: {
    key: string;
    contentType: ContentTypeDeCadastro;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadPrivado> {
    const comando = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: entrada.key,
      ContentType: entrada.contentType,
      // Entra na assinatura: a URL so serve para um envio ate este tamanho.
      // Sem o teto, quem receber o link envia o que quiser, do tamanho que
      // quiser, ate a expiracao.
      ContentLength: entrada.maxBytes,
    });

    const uploadUrl = await getSignedUrl(this.cliente, comando, {
      expiresIn: entrada.expiresInSeconds,
    });

    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + entrada.expiresInSeconds * 1000).toISOString(),
    };
  }

  async headPrivateObject(key: string): Promise<MetadadosDeObjeto> {
    const resposta = await this.cliente.send(
      new HeadObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );

    return {
      size: resposta.ContentLength ?? 0,
      contentType: resposta.ContentType ?? 'application/octet-stream',
    };
  }

  /**
   * Idempotente por natureza: o S3 responde 204 mesmo para chave inexistente.
   * E o comportamento que o expurgo do INV-142 precisa -- reexecutar nao
   * pode falhar por ja ter dado certo.
   */
  async putPrivateObject(entrada: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: entrada.key,
        Body: entrada.body,
        ContentType: entrada.contentType,
      }),
    );
  }

  /**
   * Le o objeto inteiro para a memoria. Ver a porta para o porque de existir
   * ao lado de `createPrivateDownload` em vez de substitui-la.
   *
   * `transformToByteArray` e nao `transformToString`: o corpo pode ser PNG,
   * e decodificar bytes binarios como texto os corrompe silenciosamente.
   */
  async getPrivateObject(key: string): Promise<{ body: Buffer; contentType: string }> {
    const resposta = await this.cliente.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );

    const bytes = await resposta.Body?.transformToByteArray();

    return {
      body: Buffer.from(bytes ?? new Uint8Array(0)),
      contentType: resposta.ContentType ?? 'application/octet-stream',
    };
  }

  async createPrivateDownload(entrada: {
    key: string;
    expiresInSeconds: number;
    fileName: string;
  }): Promise<{ downloadUrl: string; expiresAt: string }> {
    const comando = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: entrada.key,
      // Forca download em vez de abrir no navegador, e com nome legivel. Sem
      // isto o arquivo chega como o UUID da chave.
      ResponseContentDisposition: `attachment; filename="${entrada.fileName}"`,
    });

    const downloadUrl = await getSignedUrl(this.cliente, comando, {
      expiresIn: entrada.expiresInSeconds,
    });

    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + entrada.expiresInSeconds * 1000).toISOString(),
    };
  }

  async deletePrivateObject(key: string): Promise<void> {
    await this.cliente.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  /**
   * Storage responde? Usado so pelo readiness.
   *
   * `HeadObject` numa chave impossivel: erro 404 prova que o servico atende
   * (respondeu "nao existe"); erro de rede ou credencial nao chega a 404.
   */
  async verificar(): Promise<boolean> {
    try {
      await this.headPrivateObject('__readiness__/nao-existe');
      return true;
    } catch (erro: unknown) {
      const status = (erro as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;

      // 404 e 403 provam servico vivo: ele avaliou a requisicao e respondeu.
      return status === 404 || status === 403;
    }
  }
}
