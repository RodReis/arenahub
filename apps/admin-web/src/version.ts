import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ_DO_WORKSPACE = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Mesma regra da api: a versao vem do manifesto, nunca de literal no codigo.
 *
 * Roda so no servidor -- le o sistema de arquivos.
 */
export function lerVersaoDoPainel(): string {
  const manifesto: unknown = JSON.parse(
    readFileSync(join(RAIZ_DO_WORKSPACE, 'package.json'), 'utf8'),
  );

  if (
    typeof manifesto !== 'object' ||
    manifesto === null ||
    !('version' in manifesto) ||
    typeof manifesto.version !== 'string'
  ) {
    throw new Error('package.json do admin-web nao declara "version" como string');
  }

  return manifesto.version;
}
