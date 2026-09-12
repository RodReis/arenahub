const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

/**
 * Metro num monorepo pnpm.
 *
 * `watchFolders` com a raiz nao e opcional: sem isso o Metro nao enxerga
 * `packages/ui`, e o import de `@arenahub/ui/app-tokens` morre com "Unable to
 * resolve module", como se o pacote nao existisse.
 *
 * `disableHierarchicalLookup` NAO ENTRA AQUI, e a tentacao e grande -- e a
 * receita padrao de monorepo, e serve para impedir que o Metro ache duas
 * copias de `react` subindo a arvore. Num layout pnpm ela QUEBRA O BUNDLE:
 * cada pacote resolve as proprias dependencias pelo `node_modules` que o pnpm
 * criou ao lado dele, dentro de `.pnpm/`, e desligar a busca hierarquica tira
 * exatamente esse caminho. O sintoma e o proprio `react-native` nao achar
 * `invariant`, uma dependencia DELE:
 *
 *   Unable to resolve module invariant from .../react-native/index.js
 *
 * -- que parece instalacao corrompida e e so a busca desligada.
 *
 * A protecao contra React duplicado fica no `resolveRequest` abaixo, que
 * resolve o problema real sem derrubar a resolucao de todo mundo.
 */
const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * UMA copia de `react` e `react-native`, sempre a do app.
 *
 * Duas copias de `react` no bundle produzem "Invalid hook call" em runtime,
 * apontando para o componente que por acaso renderizou primeiro -- um dos
 * erros mais caros de diagnosticar em RN, porque o lugar do sintoma nao tem
 * relacao com a causa. Fixar o caminho aqui e barato e resolve na resolucao,
 * nao no aparelho.
 */
const UNICOS = ['react', 'react-dom', 'react-native'];
const resolverOriginal = config.resolver.resolveRequest;

/**
 * `./theme.js` -> `theme.tsx`.
 *
 * O codigo-fonte escreve o import relativo com extensao `.js`, que e o que o
 * TypeScript exige sob resolucao de ESM e o que o resto do repositorio ja
 * faz -- mas o arquivo em disco e `.tsx`. O Metro nao faz essa troca sozinho,
 * e o erro ("Unable to resolve ./theme.js") acusa o caminho em vez da
 * extensao. Vale so para import RELATIVO: pacote publicado com `.js` no
 * subpath e mesmo `.js`.
 */
const RELATIVO_COM_JS = /^\.{1,2}\/.*\.js$/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (UNICOS.includes(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.join(projectRoot, 'index.js') },
      moduleName,
      platform,
    );
  }

  if (RELATIVO_COM_JS.test(moduleName)) {
    const semExtensao = moduleName.slice(0, -'.js'.length);
    try {
      return context.resolveRequest(context, semExtensao, platform);
    } catch {
      // Nao era um `.tsx`/`.ts` nosso -- deixa o resolvedor normal decidir,
      // para que o erro que chega ao desenvolvedor seja o original.
    }
  }

  return (resolverOriginal ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
