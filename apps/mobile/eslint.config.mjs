import base from '@arenahub/config/eslint';
import designSystem from '@arenahub/config/eslint/design-system';
import react from '@arenahub/config/eslint/react';

/**
 * `.mjs`, e nao `.js` como nas outras superficies.
 *
 * O `apps/mobile` NAO pode declarar `"type": "module"` no package.json: o
 * Expo exige `metro.config.js`, `babel.config.js` e `jest.config.js` em
 * CommonJS, e marcar o pacote como ESM quebraria os tres. Sem a marca, um
 * `eslint.config.js` com `import` faz o Node reparsear o arquivo e emitir
 * MODULE_TYPELESS_PACKAGE_JSON a cada execucao. A extensao resolve sem
 * mexer no resto.
 *
 * As MESMAS regras do painel e do totem.
 *
 * Em especial a regra 1 (hex literal so em `packages/ui/tokens`): o app le
 * cor de `APP_TOKENS` e de nenhum outro lugar. O risco aqui e maior que nas
 * superficies web, porque em React Native o estilo mora no proprio arquivo
 * do componente -- copiar um hex do DS-APP.md para um `StyleSheet.create` e
 * um gesto de dois segundos, e cria a segunda verdade que o pipeline existe
 * para impedir.
 */
export default [
  ...base,
  ...designSystem,
  ...react,
  {
    ignores: ['.expo/**', 'dist/**', 'expo-env.d.ts'],
  },
];
