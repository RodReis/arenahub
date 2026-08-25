import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * `@arenahub/ui` e compilado pelo Next a partir da FONTE -- mesma razao do
   * `admin-web`: o `tsc` do pacote transpila `.tsx` mas nao copia `.css`, e a
   * diretiva `'use client'` precisa sobreviver ao bundle do app que consome.
   */
  transpilePackages: ['@arenahub/ui'],
};

export default config;
