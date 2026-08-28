import type { NextConfig } from 'next';

/**
 * `.env` da RAIZ do monorepo, carregado aqui porque o Next so le o `.env` do
 * proprio diretorio do app -- e as `KIOSK_*` moram na raiz, junto das demais.
 *
 * Sem isto, `KIOSK_KEY_ID`/`KIOSK_SECRET` nao chegam a ponte de
 * `app/api/kiosk/[...caminho]/route.ts` e `/config` e `/heartbeat` respondem
 * 500: o totem nao abre em desenvolvimento. Nenhum teste pega o defeito,
 * porque teste nao sobe o `dev` -- o `pretest:e2e` deste pacote ja carregava a
 * raiz (`--env-file-if-exists`) e o `dev` nao, e foi essa assimetria que
 * deixou o CI verde com a tela quebrada (issue #212).
 *
 * `loadEnvFile` NAO sobrescreve o que ja veio do ambiente, entao o E2E (que
 * injeta as `KIOSK_*` pelo `webServer.env`) e o CI seguem mandando.
 */
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // Sem `.env` na raiz: as variaveis vem do ambiente (CI, E2E, producao).
}

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
