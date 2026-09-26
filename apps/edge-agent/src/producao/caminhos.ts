import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolucao de caminho que NAO depende de `process.cwd()`.
 *
 * Como servico Windows o diretorio de trabalho e `C:\Windows\System32`, e
 * todo caminho relativo da config apontaria para la: o `.env` seria
 * procurado em `C:\Windows\.env` e o SQLite tentaria nascer em
 * `C:\Windows\System32\data\`, sem permissao -- com o servico entrando em
 * loop de restart a cada 5 s (#406, Arena Positiva).
 */

/**
 * Raiz do pacote a partir do arquivo compilado em `<pacote>/dist/main.js`.
 *
 * `fileURLToPath` e nao `new URL(...).pathname`: no Windows o pathname vem
 * como `/C:/...`, com barra a mais e `%20` no lugar de espaco -- e o
 * caminho real do PC da recepcao tem espaco no nome do usuario.
 */
export function raizDoPacote(urlDoModulo: string): string {
  return resolve(dirname(fileURLToPath(urlDoModulo)), '..');
}

/**
 * Resolve `caminho` contra `base`; caminho absoluto passa intacto.
 *
 * As bases sao diferentes por config e isso importa: rodando por
 * `pnpm start` o `cwd` e `apps/edge-agent`, entao `data/edge-agent.sqlite`
 * sempre resolveu para dentro do PACOTE -- e e la que o banco das
 * instalacoes existentes esta. Ja `infra/bancada/inventory.yaml` aponta
 * para a raiz do MONOREPO. Uma base so moveria um dos dois de lugar.
 */
export function absoluto(caminho: string, base: string): string {
  return isAbsolute(caminho) ? caminho : resolve(base, caminho);
}
