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
};

export default config;
