/**
 * Copia os `.module.css` de `src/` para `dist/`, preservando a arvore.
 *
 * O `tsc` transpila `.tsx` e ignora `.css` -- ele e compilador de tipos, nao
 * bundler. Sem esta copia, o `dist` sai com `import './Button.module.css'`
 * apontando para um arquivo que nunca chegou, e o Next falha com
 * "Module not found" em todo componente que tem estilo.
 *
 * Roda depois do `tsc`, no mesmo `pnpm build`. A alternativa seria apontar o
 * entrypoint para `src/`, mas os imports internos usam extensao `.js`
 * (NodeNext) e o bundler lendo `.tsx` nao mapeia `.js` de volta.
 */
import { cp, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const ORIGEM = join(RAIZ, 'src');
const DESTINO = join(RAIZ, 'dist');

/** Caminhos de todo `.module.css` sob `src/`, recursivo. */
async function estilos(diretorio) {
  const entradas = await readdir(diretorio, { withFileTypes: true });
  const encontrados = [];

  for (const entrada of entradas) {
    const caminho = join(diretorio, entrada.name);

    if (entrada.isDirectory()) {
      encontrados.push(...(await estilos(caminho)));
    } else if (entrada.name.endsWith('.module.css')) {
      encontrados.push(caminho);
    }
  }

  return encontrados;
}

const arquivos = await estilos(ORIGEM);

for (const arquivo of arquivos) {
  await cp(arquivo, join(DESTINO, relative(ORIGEM, arquivo)));
}

console.log(`✓ css: ${arquivos.length} CSS Modules copiados para dist/`);
