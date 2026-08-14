/**
 * Seed de desenvolvimento local.
 *
 * NASCE VAZIO, MAS NASCE. O CLAUDE.md e categorico: "sem hardcode e sem dado
 * inventado no caminho de producao; dado local de desenvolvimento entra por
 * seed, criado na primeira fatia que precisar". Este card cria o arquivo e o
 * comando; o conteudo vem depois, fatia a fatia.
 *
 * Nao ha o que semear ainda porque nao ha entidade -- o schema esta
 * propositalmente vazio (Tenant e GymUnit nascem em F6).
 *
 *   pnpm --filter @arenahub/database seed
 *
 * REGRA QUE NAO SE NEGOCIA: nunca versionar dado real de aluno aqui. Nem em
 * fixture, nem em golden file, nem em log de erro. Dado de seed e inventado
 * e obviamente falso -- se parecer real, esta errado.
 *
 * Quando houver o que semear, `semear` vira async e abre o client com
 * `criarPrismaClient()` de src/client.ts.
 */

function semear(): void {
  console.info('[seed] Nada a semear: o schema ainda nao tem entidade.');
  console.info('[seed] A primeira fatia que precisar de dado local preenche este arquivo.');
}

try {
  semear();
} catch (erro: unknown) {
  console.error('[seed] falhou:', erro);
  process.exitCode = 1;
}
