/**
 * Babel do app.
 *
 * Nao e opcional, nem no Metro nem no Jest: sem `babel-preset-expo` nenhum
 * arquivo do React Native e transformado, e o primeiro sintoma e um
 * `SyntaxError: Cannot use import statement outside a module` apontando para
 * um `setup.js` DENTRO do preset do proprio RN -- que parece defeito da
 * biblioteca e e so a ausencia deste arquivo.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
