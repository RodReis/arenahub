import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // `API_INTERNAL_URL` fica deliberadamente fora daqui: o que entra em `env`
  // vai para o bundle do cliente. A URL interna da API so e lida no servidor,
  // pelo cliente de API das Server Actions.
  poweredByHeader: false,
  /**
   * `@arenahub/ui` e compilado pelo Next, a partir da FONTE.
   *
   * O `tsc` do pacote transpila `.tsx` mas nao copia `.css`: o `dist` sai com
   * `import './Button.module.css'` apontando para um arquivo que nao esta la.
   * CSS Module e formato que o bundler resolve, nao o compilador de tipos.
   *
   * Transpilar aqui tambem e o que faz `'use client'` do `Toast` e do
   * `SensitiveAction` valer -- a diretiva precisa sobreviver ao bundle do app
   * que os consome.
   */
  transpilePackages: ['@arenahub/ui'],
  /**
   * Server Actions aceitam ate 10 MB de corpo -- o MESMO teto que a API
   * aplica em `TAMANHO_MAXIMO_BYTES`.
   *
   * O padrao do Next e 1 MB, e o envio de laudos passa disso com folga: os
   * arquivos reais da academia tem 1,4 MB e 2,1 MB, e vao TODOS no mesmo
   * pedido. O erro aparecia como "Body exceeded 1 MB limit" na tela, longe
   * da causa -- o arquivo era valido e a API o teria aceitado.
   *
   * Alinhado ao limite da API de proposito: dois tetos diferentes fariam o
   * arquivo passar num e morrer no outro, com a mensagem culpando a camada
   * errada.
   */
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
};

export default config;
