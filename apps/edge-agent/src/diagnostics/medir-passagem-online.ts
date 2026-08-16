/**
 * CLI da medicao de bancada -- F9, Task 6 Steps 2 e 3.
 *
 * Mora em `diagnostics/` junto do diagnostico de bancada, e nao em `test/`,
 * por dois motivos que apontam para o mesmo lugar: aqui e onde processo de
 * linha de comando ja vive neste app, e a saida de console E a interface
 * deste tipo de ferramenta.
 *
 * O CONTRATO e o CALCULO ficam em `relatorio-de-passagem.ts` -- puros,
 * testados no CI. Este arquivo so orquestra: le a configuracao, conversa com
 * o equipamento e imprime o relatorio.
 *
 * ⚠️ **SEM A FLAG `--sem-comando`, ISTO GIRA UMA CATRACA DE VERDADE.**
 */

import { MATRIZ_NEGATIVA } from './relatorio-de-passagem.js';

const SEM_COMANDO = process.argv.includes('--sem-comando');
const TRIALS = Number(process.env['HW_TRIALS'] ?? 100);

function main(): void {
  console.info('Medicao de passagem online — ArenaHub edge-agent');
  console.info(
    SEM_COMANDO
      ? 'Modo OBSERVACAO: mede a decisao, NAO aciona a catraca.\n'
      : '⚠️  Modo ASSISTIDO: ACIONA A CATRACA de verdade.\n',
  );

  console.info(`Trials configurados: ${TRIALS}`);
  console.info(`Casos na matriz negativa: ${MATRIZ_NEGATIVA.length}\n`);

  console.info('Pre-condicoes obrigatorias:');
  console.info('  - leitor facial e catraca cadastrados e sincronizados (F8)');
  console.info('  - `.env` do edge-agent com USE_SIMULATOR=false');
  console.info('  - API de pe e alcancavel a partir do PC da bancada\n');

  // A implementacao da coleta depende de a bancada existir para ser escrita
  // contra o equipamento real -- protocolo de leitor tem detalhe que so
  // aparece com o hardware na frente. Escrever contra o simulador produziria
  // um script que roda bonito e falha na primeira medicao de verdade.
  console.error(
    [
      'COLETA NAO IMPLEMENTADA — bancada indisponivel em 16/08/2026.',
      '',
      'O que ja existe e esta testado no CI:',
      '  - a matriz de casos (10 cenarios, incluindo o de controle)',
      '  - o resumo de percentis por nearest-rank',
      '  - o veredito, com o limite do MVP 0 vencendo o objetivo de 300 ms',
      '',
      'O que falta e a coleta contra o equipamento. Ver:',
      '  docs/operations/smart-access/online-access-evidence.md §4 e §5',
      '',
      'NAO preencha o documento de evidencia com numero estimado.',
    ].join('\n'),
  );

  process.exit(1);
}

main();
