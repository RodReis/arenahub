import { Global, Module } from '@nestjs/common';

import { carregarConfig } from '../../config/env.js';
import { OBJECT_STORAGE } from './object-storage.port.js';
import { S3ObjectStorageAdapter } from './s3-object-storage.adapter.js';

/**
 * Storage privado como porta injetavel.
 *
 * `@Global` pelo mesmo motivo do `PersistenceModule`: biometria, avaliacao
 * fisica e comprovante de pagamento vao todos precisar do mesmo bucket, e
 * reimportar o modulo em cada um so gera ruido.
 *
 * O provider e registrado pelo TOKEN, nao pela classe: quem consome depende
 * de `ObjectStoragePort`, e trocar MinIO por S3 -- ou por um dublê em teste
 * -- nao toca em nenhum caso de uso.
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORAGE,
      useFactory: (): S3ObjectStorageAdapter =>
        new S3ObjectStorageAdapter(carregarConfig().storage),
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class StorageModule {}
