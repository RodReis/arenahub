import { Global, Module } from '@nestjs/common';

import { FakeMediaFetcherAdapter } from './fake-media-fetcher.adapter.js';
import { MEDIA_FETCHER } from './media-fetcher.port.js';
import { YtDlpMediaFetcherAdapter } from './yt-dlp-media-fetcher.adapter.js';

/**
 * Extracao de midia externa como porta injetavel (ADR-042, Decisao 7).
 *
 * ---------------------------------------------------------------------------
 * O ADAPTER REAL E O PADRAO. O DUBLÊ ENTRA POR AMBIENTE.
 * ---------------------------------------------------------------------------
 *
 * Ao contrario do `AntivirusModule` -- onde o dublê e o registrado porque o
 * antivirus real ainda nao existe --, aqui o adapter real EXISTE e funciona
 * (comprovado em 28/08/2026 com o reel `DbtoWkFR6l6`: MP4 de 24,6 MB). Se o
 * dublê fosse o padrao, a producao serviria video falso sem ninguem notar.
 *
 * `MEDIA_FETCHER_FAKE=1` troca o provider, e existe para o teste de
 * integracao: a suite nao pode depender da rede nem da Meta -- quebra de
 * terceiro viraria CI vermelho sem defeito nosso.
 *
 * `@Global` pelo mesmo motivo do `StorageModule` e do `AntivirusModule`: a
 * porta e do boundary, e quem ingere midia externa a consome.
 */
@Global()
@Module({
  providers: [
    FakeMediaFetcherAdapter,
    /*
     * `useFactory` e nao a CLASSE como provider: o construtor de
     * `YtDlpMediaFetcherAdapter` recebe o nome do binario com valor padrao, e
     * o Nest tenta injetar esse parametro -- "can't resolve dependencies
     * (String at index [0])", que derrubou a suite INTEIRA de integracao ate
     * ser visto. Um argumento primitivo com default nao e injetavel; quem o
     * fornece e a fabrica.
     */
    {
      provide: MEDIA_FETCHER,
      inject: [FakeMediaFetcherAdapter],
      useFactory: (fake: FakeMediaFetcherAdapter) =>
        process.env['MEDIA_FETCHER_FAKE'] === '1' ? fake : new YtDlpMediaFetcherAdapter(),
    },
  ],
  exports: [MEDIA_FETCHER, FakeMediaFetcherAdapter],
})
export class MediaFetcherModule {}
