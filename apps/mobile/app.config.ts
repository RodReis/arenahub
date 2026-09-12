import type { ExpoConfig } from 'expo/config';

/**
 * Configuracao do app do aluno.
 *
 * O `userInterfaceStyle` e `automatic` -- o app SEGUE O SO, como o DS-APP.md
 * §2.4.1 decidiu. O fundo de splash e barra usa o `bg/app` do tema escuro
 * porque escuro e o padrao (§1): quem abre o app no escuro nao ve um lampejo
 * branco antes da primeira tela.
 *
 * O hex aparece aqui como literal porque esta config e lida pelo Expo ANTES
 * de qualquer modulo do app ser carregado -- nao ha runtime onde importar
 * `APP_TOKENS`. E a unica excecao a regra 1 do DS-APP.md §2, e ela e estreita
 * de proposito: dois valores, os dois comentados, os dois iguais ao token.
 */
const BG_APP_DARK = '#121417'; // = APP_TOKENS.dark.bg.app

const config: ExpoConfig = {
  name: 'ArenaHub',
  slug: 'arenahub',
  scheme: 'arenahub',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  backgroundColor: BG_APP_DARK,
  // `newArchEnabled` tambem saiu do tipo no SDK 57: a nova arquitetura passou
  // a ser o unico modo. Declarar hoje e erro de tipo, nao reforco.
  experiments: {
    typedRoutes: true,
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'br.com.arenahub.app',
  },
  // `edgeToEdgeEnabled` NAO entra aqui: saiu do tipo no SDK 57, porque o
  // edge-to-edge passou a ser o comportamento padrao do Android. Declarar a
  // flag hoje e erro de tipo, nao redundancia inofensiva.
  android: {
    package: 'br.com.arenahub.app',
  },
  plugins: ['expo-router', 'expo-font'],
};

export default config;
