interface Babel {
  transformSync: (
    codigo: string,
    opcoes: Record<string, unknown>,
  ) => { code?: string | null } | null;
}

declare const __dirname: string;

const { readFileSync }: { readFileSync: (caminho: string, codificacao: 'utf8') => string } =
  jest.requireActual('node:fs');
const { join }: { join: (...partes: string[]) => string } = jest.requireActual('node:path');
const babel: Babel = jest.requireActual('@babel/core');

const URL_DE_PRODUCAO = 'https://api-de-teste.exemplo.app';
const SLUG_DE_TESTE = 'academia-de-teste';

/**
 * O Metro so embute `process.env.EXPO_PUBLIC_*` escrito LITERALMENTE; leitura
 * dinamica (`env['EXPO_PUBLIC_X']`, via `globalThis`) passa em dev, onde a
 * variavel existe no processo, e some no APK -- que cai em `localhost` e nunca
 * alcanca a API (build 7, 26/09). Este teste faz o que o Metro faz: transforma
 * o arquivo em modo release e confere que os valores foram embutidos.
 */
describe('config do app em build de release', () => {
  const anterior = { ...process.env };

  afterEach(() => {
    process.env = { ...anterior };
  });

  function transformar(): string {
    process.env['EXPO_PUBLIC_API_URL'] = URL_DE_PRODUCAO;
    process.env['EXPO_PUBLIC_TENANT_SLUG'] = SLUG_DE_TESTE;

    const caminho = join(__dirname, 'config.ts');
    const resultado = babel.transformSync(readFileSync(caminho, 'utf8'), {
      filename: caminho,
      babelrc: false,
      configFile: false,
      presets: ['babel-preset-expo'],
      caller: { name: 'metro', bundler: 'metro', platform: 'android', isDev: false },
    });

    return resultado?.code ?? '';
  }

  it('embute a URL da API no bundle', () => {
    expect(transformar()).toContain(URL_DE_PRODUCAO);
  });

  it('embute o slug da academia no bundle', () => {
    expect(transformar()).toContain(SLUG_DE_TESTE);
  });
});
