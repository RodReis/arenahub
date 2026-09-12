/**
 * Jest do app do aluno.
 *
 * `jest-expo` e o preset porque e ele que traz a transformacao do React
 * Native e os mocks dos modulos nativos -- sem ele, o primeiro `import` de
 * `react-native` morre em sintaxe de Flow, e o erro nao diz que falta preset.
 *
 * `transformIgnorePatterns` precisa ABRIR excecao para os pacotes do RN e do
 * Expo: eles publicam ES modules nao transpilados, e o padrao do Jest e nao
 * transformar nada dentro de `node_modules`.
 *
 * O padrao que o preset traz e escrito para `node_modules` ACHATADO (npm), e
 * no pnpm nada casa: os pacotes moram em `.pnpm/<nome>@<versao>_<hash>/
 * node_modules/<nome>`, com a versao e o hash no meio do caminho. O sintoma e
 * `SyntaxError: Cannot use import statement outside a module` apontando para
 * um arquivo de setup do proprio React Native -- que parece defeito do preset
 * e e so caminho que nao casou.
 *
 * A saida e transformar TUDO o que estiver sob `.pnpm/`. E mais largo do que
 * a lista nominal do preset, e deliberadamente: a alternativa e reescrever
 * doze nomes de pacote com `@versao_hash` no meio, que erra em silencio na
 * primeira dependencia nova -- com o mesmo sintoma enganoso. O custo e tempo
 * de transformacao de pacote ja em CommonJS, que o Babel atravessa rapido.
 *
 * O PADRAO PRECISA SER ANCORADO EM `^`, e isso nao e detalhe de estilo.
 * O caminho real de um pacote no pnpm tem `node_modules` DUAS vezes:
 *
 *   ...\node_modules\.pnpm\@react-native+jest-preset@0_b66\node_modules\@react-native\...
 *        ^-- 1o, seguido de .pnpm            2o --^  seguido do nome do pacote
 *
 * Um `node_modules[/\\](?!\.pnpm[/\\])` sem ancora parece certo e falha: a
 * negativa protege o primeiro, mas o regex encontra o SEGUNDO mais adiante na
 * mesma string, casa ali, e o arquivo volta a ser ignorado. A ancora obriga a
 * decisao a ser sobre o caminho inteiro -- se ha `.pnpm` em qualquer ponto,
 * transforma.
 *
 * No Windows o Jest normaliza a barra do padrao para `\`, entao a classe
 * `[/\\]` cobre as duas plataformas.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transformIgnorePatterns: ['^(?!.*[/\\\\]\\.pnpm[/\\\\]).*[/\\\\]node_modules[/\\\\]'],
  /**
   * `./theme.js` -> `theme.tsx`.
   *
   * O codigo-fonte escreve o import com extensao `.js` (o que o TypeScript
   * exige sob resolucao de ESM, e o que o resto do repositorio ja faz), mas o
   * arquivo em disco e `.tsx`. O Metro resolve isso sozinho; o Jest nao, e o
   * erro que da -- "Cannot find module './theme.js'" -- parece caminho errado
   * em vez de extensao nao mapeada.
   */
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
