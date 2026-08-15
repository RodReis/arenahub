import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_DO_WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Le a versao do manifesto do workspace, nao de um literal no codigo.
 *
 * Literal duplicado envelhece em silencio: alguem sobe a versao no
 * `package.json`, o `/version` continua respondendo a antiga, e o suporte
 * passa a depurar a build errada.
 */
export function lerVersaoDaApi(): string {
  const manifesto: unknown = JSON.parse(
    readFileSync(join(RAIZ_DO_WORKSPACE, 'package.json'), 'utf8'),
  );

  if (
    typeof manifesto !== 'object' ||
    manifesto === null ||
    !('version' in manifesto) ||
    typeof manifesto.version !== 'string'
  ) {
    throw new Error('package.json da api nao declara "version" como string');
  }

  return manifesto.version;
}
