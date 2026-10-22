/**
 * Correcao de dado da issue #671 -- nome de aluno em caixa de nome proprio.
 *
 *   pnpm --filter @arenahub/database fix:nomes            # so relata (antes -> depois)
 *   pnpm --filter @arenahub/database fix:nomes --aplicar  # grava
 *
 * O QUE ACONTECEU. O nome era gravado como foi digitado ou importado
 * ("ANDRE LUIZ VICENTE MENEZES", "BRUNA Aires de sousa") e toda tela o
 * mostrava assim. O codigo ja grava formatado (`nomeProprio`, na API e nos
 * importadores) -- este script conserta quem foi gravado ANTES.
 *
 * O PI confere a lista do modo relato ANTES de rodar com `--aplicar`
 * (decisao do PI, 22/10/2026). A lista sai no terminal de quem roda e nao
 * vai para arquivo nenhum: e nome de aluno real.
 *
 * IDEMPOTENTE: `nomeProprio` aplicado duas vezes da o mesmo nome, entao
 * depois de rodar ninguem cai no filtro de novo.
 * SEGURO POR PADRAO: sem `--aplicar` apenas lista o que faria.
 * Roda contra a `DATABASE_URL` de quem chama; nada de URL fixa aqui.
 */
import { fileURLToPath } from 'node:url';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

import { criarPrismaClient } from '../src/client.js';
import { nomeProprio } from '../src/nome-proprio.js';

async function corrigir(): Promise<void> {
  const aplicar = process.argv.includes('--aplicar');
  const db = criarPrismaClient();

  try {
    const alunos = await db.student.findMany({
      select: { id: true, tenantId: true, fullName: true },
      orderBy: [{ tenantId: 'asc' }, { fullName: 'asc' }],
    });

    const mudancas = alunos
      .map((aluno) => ({ ...aluno, novo: nomeProprio(aluno.fullName) }))
      .filter((aluno) => aluno.novo !== aluno.fullName);

    for (const { fullName, novo } of mudancas) {
      console.log(`${fullName}  ->  ${novo}`);
    }

    console.log(`\n${mudancas.length} de ${alunos.length} nome(s) mudam.`);

    if (!aplicar) {
      console.log('Modo relato: nada foi gravado. Confira a lista e rode com --aplicar.');
      return;
    }

    /*
     * UM statement so: atomico por si, e uma ida ao banco. A primeira versao
     * fazia um UPDATE por aluno numa transacao e estourou o teto de 5 s do
     * Prisma com 1919 nomes contra a Railway (P2028) -- desfez tudo, mas nao
     * gravou nada. `version` nao sobe de proposito: so a caixa muda, e subir
     * faria a ficha aberta na recepcao recusar o proximo salvar.
     */
    const gravados = await db.$executeRaw`
      UPDATE students AS s
         SET full_name = v.nome, updated_at = now()
        FROM unnest(${mudancas.map((m) => m.id)}::uuid[], ${mudancas.map((m) => m.novo)}::text[])
             AS v(id, nome)
       WHERE s.id = v.id`;

    console.log(`${gravados} nome(s) gravado(s).`);
  } finally {
    await db.$disconnect();
  }
}

await corrigir();
