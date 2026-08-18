#!/usr/bin/env node
/**
 * Expurga o residuo de teste do banco de DESENVOLVIMENTO -- card [INFRA],
 * issue #101.
 *
 * Antes de as suites ganharem banco proprio, elas escreviam aqui e nao
 * limpavam. Sobraram duas classes de lixo:
 *
 *   1. **Tenants inteiros de teste** -- slug com sufixo hex de 8 digitos
 *      (`f7-rede-a-a6b8b550`, `academia-2d849fb4`), criados pelas suites de
 *      integracao. Apagar o tenant leva junto tudo que pendura nele: todas as
 *      FKs sao `ON DELETE CASCADE`.
 *   2. **Linhas com epoch no nome DENTRO do tenant real** -- `Caminho
 *      Biometria 1787060177858`, `Plano Atribuivel 1786909436454`, deixadas
 *      pela suite E2E, que rodava contra o tenant do seed.
 *   3. **Usuarios de teste** -- e-mail em `@exemplo.test`, dominio que a RFC
 *      2606 reserva justamente para isso. `users` NAO pendura em tenant, entao
 *      o CASCADE nao os leva: some o tenant, fica o usuario orfao.
 *
 * Este script e de uso UNICO por natureza: depois que as suites passaram a
 * usar banco proprio, o residuo nao se forma de novo. Fica no repositorio
 * porque quem clonou antes da separacao ainda tem o banco sujo.
 *
 * PROTECAO -- tres, porque apagar dado nao tem desfazer:
 *
 *   - **Recusa** rodar contra banco de teste (`_e2e`, `_int`): esses sao
 *     recriados do zero e nao precisam disto; apontar para eles seria sinal
 *     de que quem rodou se enganou de alvo.
 *   - **Conta antes de apagar** e mostra o que vai sumir.
 *   - **Exige `--confirmar`**: sem a flag, so relata.
 *
 * O criterio e conservador de proposito. Tenant SEM sufixo hex nunca e tocado,
 * mesmo que pareca lixo: preferir deixar sujeira a apagar dado de verdade.
 */
import { PrismaClient, PrismaPg } from '@arenahub/database';

const URL_DEV = process.env['DATABASE_URL'];

if (!URL_DEV) {
  throw new Error('DATABASE_URL nao definida. Copie o `.env.example` para `.env` na raiz.');
}

const nome = new URL(URL_DEV).pathname.replace(/^\//, '');

// Bancos de suite sao recriados a cada execucao pelo `preparar-banco-de-teste`.
// Rodar o expurgo neles nao faz mal, mas indica alvo errado -- e alvo errado em
// script destrutivo se trata parando, nao seguindo.
if (nome.endsWith('_e2e') || nome.endsWith('_int')) {
  throw new Error(
    `Recusado: "${nome}" e banco de suite, recriado do zero a cada execucao.\n` +
      'Este script existe para limpar o banco de DESENVOLVIMENTO.',
  );
}

const confirmado = process.argv.includes('--confirmar');

/** Sufixo hex de 8 digitos: como as suites nomeiam tenant descartavel. */
const PADRAO_TENANT_DE_TESTE = '-[0-9a-f]{8}$';

/** Epoch em milissegundos no nome: como as suites nomeiam aluno descartavel. */
const PADRAO_EPOCH = '1[0-9]{12}';

/**
 * Dominio reservado pela RFC 2606 para exemplo e teste. Endereco real nunca
 * cai aqui, entao o criterio nao tem falso positivo -- diferente de varrer
 * digito no e-mail, que pegaria gente de verdade.
 */
const DOMINIO_DE_TESTE = '@exemplo.test';
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: URL_DEV }) });

/**
 * Varre o catalogo do Postgres atras de coluna de texto com epoch.
 *
 * Descobrir as colunas, em vez de lista-las aqui, e o que faz este script nao
 * envelhecer: tabela nova entra na varredura sozinha. A primeira versao
 * listava `tenants` e `students` a mao e deixou 37 planos com epoch para tras
 * -- limpou uma classe de lixo e declarou vitoria.
 *
 * So colunas que NOMEIAM alguma coisa. Varrer todo texto pegava
 * `sessions.token_hash`, onde a sequencia de digitos e coincidencia de hash --
 * e apagar sessao por coincidencia e pior do que deixar sujeira.
 */
const COLUNAS_DE_NOME = ['name', 'full_name', 'display_name', 'label', 'title', 'slug'];

async function colunasDeTexto() {
  return db.$queryRaw`
    select table_name as tabela, column_name as coluna
    from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying')
      and column_name = any(${COLUNAS_DE_NOME})
      and table_name not like '_prisma%'
    order by table_name, column_name`;
}

try {
  const tenantsComHifen = await db.tenant.findMany({
    where: { slug: { contains: '-' } },
    select: { id: true, slug: true },
  });

  // O filtro fino roda aqui, e nao no `where`: o Prisma nao expoe regex de
  // Postgres, e `contains` sozinho pegaria `arena-positiva` junto.
  const regexTenant = new RegExp(PADRAO_TENANT_DE_TESTE);
  const alvos = tenantsComHifen.filter((t) => regexTenant.test(t.slug));
  const idsDeTeste = alvos.map((t) => t.id);

  console.log(`\nBanco: "${nome}"\n`);
  console.log(`Tenants de teste (com sufixo hex):  ${String(alvos.length)}`);
  console.log(`Tenants PRESERVADOS:                ${String(tenantsComHifen.length - alvos.length)}`);

  // Linhas com epoch no nome, em QUALQUER tabela. As que vivem dentro de um
  // tenant de teste caem junto com ele pelo CASCADE; as que sobram vivem no
  // tenant real -- residuo da suite E2E, que rodava contra o tenant do seed.
  const colunas = await colunasDeTexto();
  const comEpoch = [];

  for (const { tabela, coluna } of colunas) {
    // `$queryRawUnsafe` porque identificador nao pode ser parametro. Tabela e
    // coluna vem do catalogo do proprio banco, nao de entrada de usuario.
    const linhas = await db.$queryRawUnsafe(
      `select count(*)::int as total from "${tabela}" where "${coluna}" ~ $1`,
      PADRAO_EPOCH,
    );

    if (linhas[0].total > 0) {
      comEpoch.push({ tabela, coluna, total: linhas[0].total });
    }
  }

  if (comEpoch.length > 0) {
    console.log('\nLinhas com epoch no nome:');
    for (const { tabela, coluna, total } of comEpoch) {
      console.log(`  ${tabela}.${coluna}: ${String(total)}`);
    }
  }

  const usuariosDeTeste = await db.user.count({ where: { email: { endsWith: DOMINIO_DE_TESTE } } });
  console.log(`
Usuarios de teste (${DOMINIO_DE_TESTE}): ${String(usuariosDeTeste)}`);

  if (!confirmado) {
    console.log('\nNada foi apagado. Rode com `--confirmar` para executar.\n');
    process.exit(0);
  }

  console.log('\nApagando...\n');

  // Tenant primeiro: as FKs sao ON DELETE CASCADE, entao isso leva junto
  // aluno, plano, dispositivo, evento e o resto que pendura neles.
  const tenantsApagados = await db.tenant.deleteMany({ where: { id: { in: idsDeTeste } } });
  console.log(`Tenants apagados: ${String(tenantsApagados.count)}`);

  for (const { tabela, coluna } of comEpoch) {
    const apagadas = await db.$executeRawUnsafe(
      `delete from "${tabela}" where "${coluna}" ~ $1`,
      PADRAO_EPOCH,
    );

    if (apagadas > 0) {
      console.log(`  ${tabela}.${coluna}: ${String(apagadas)} apagadas`);
    }
  }

  // `users` e global, sem `tenant_id`: o CASCADE do tenant nao os alcanca, e
  // sem isto ficariam centenas de orfaos apos o resto sumir.
  const usuariosApagados = await db.user.deleteMany({
    where: { email: { endsWith: DOMINIO_DE_TESTE } },
  });

  if (usuariosApagados.count > 0) {
    console.log(`  users.email: ${String(usuariosApagados.count)} apagados`);
  }

  console.log('\nExpurgo concluido.\n');
} finally {
  await db.$disconnect();
}
