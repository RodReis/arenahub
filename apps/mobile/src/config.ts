import Constants from 'expo-constants';

/**
 * Onde a API vive, do ponto de vista do APARELHO.
 *
 * `localhost` NAO SERVE: no emulador e no celular, `localhost` e o proprio
 * aparelho, nao a maquina que roda a API. O endereco tem de ser o IP da
 * maquina na LAN -- e o Expo ja sabe qual e, porque e por ele que o app
 * baixou o bundle.
 *
 * `hostUri` vem como `192.168.1.108:8081`; trocamos a porta do Metro pela da
 * API (3344, fixada no CLAUDE.md). Em build de producao `hostUri` nao
 * existe, e ai vale `EXPO_PUBLIC_API_URL`.
 */
const PORTA_DA_API = 3344;

/**
 * `process.env` chega como `any` aqui: o tsconfig do app NAO inclui
 * `@types/node` de proposito -- o app nao roda em Node, e incluir faria o
 * typecheck aceitar `fs` e `path`, que so quebram no aparelho.
 *
 * O Metro injeta as `EXPO_PUBLIC_*` em tempo de bundle, entao a leitura
 * funciona; o que falta e so o tipo.
 */
const ambiente = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;

function derivarBaseUrl(): string {
  const configurada = ambiente?.['EXPO_PUBLIC_API_URL'];
  if (configurada) return configurada.replace(/\/$/, '');

  // `Constants` chega sem tipo util na resolucao do Metro; estreitar aqui
  // evita espalhar `no-unsafe-member-access` por quem le a base URL.
  const config = Constants as unknown as { expoConfig?: { hostUri?: string } };
  const hostUri = config.expoConfig?.hostUri;

  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host) return `http://${host}:${PORTA_DA_API}`;
  }

  // Ultimo recurso. Vai falhar no aparelho, e falhar com endereco visivel no
  // erro e melhor do que falhar com `undefined` na URL.
  return `http://localhost:${PORTA_DA_API}`;
}

export const API_BASE_URL = derivarBaseUrl();

/**
 * A academia deste build.
 *
 * O ALUNO NAO DIGITA ISTO. Pedir a ele o identificador tecnico da propria
 * academia transferiria um detalhe de implementacao para quem so quer entrar.
 * No piloto ha um cliente; quando houver mais, a escolha entre build proprio
 * por academia e uma tela de selecao e decisao de produto -- e quando ela
 * vier, o unico ponto a mudar e este.
 */
export const TENANT_SLUG = ambiente?.['EXPO_PUBLIC_TENANT_SLUG'] ?? 'arena-positiva';
