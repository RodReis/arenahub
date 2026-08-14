/**
 * Formatacao compartilhada do ArenaHub.
 *
 * Uso, no prettier.config.js de cada workspace:
 *
 *   export { default } from '@arenahub/config/prettier';
 */

/** @type {import("prettier").Config} */
export default {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  endOfLine: 'lf',
};
