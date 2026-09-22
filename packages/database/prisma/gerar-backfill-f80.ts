/**
 * Gera o SQL do backfill da F80 a partir de `PAPEIS_DE_SISTEMA`.
 *
 * EXISTE PARA QUE A LISTA NAO SEJA DIGITADA DUAS VEZES: a migration e um
 * arquivo estatico (o Prisma exige), mas o conteudo dela sai da MESMA
 * constante que o caso de uso le. Digitar as ~90 linhas de permissao a mao no
 * .sql produziria, mais cedo ou mais tarde, um perfil em producao diferente
 * do que o codigo cria -- exatamente o defeito que o comentario no topo de
 * `permissoes.ts` registra.
 *
 * Uso: pnpm --filter @arenahub/database exec tsx prisma/gerar-backfill-f80.ts
 */
import { PAPEIS_DE_SISTEMA } from '../src/permissoes.js';

const linhas: string[] = [
  '-- F80: os quatro perfis prontos para os tenants que JA EXISTEM.',
  '--',
  '-- Gerado por `prisma/gerar-backfill-f80.ts` a partir de',
  '-- `PAPEIS_DE_SISTEMA` -- nao editar a mao: rode o script de novo.',
  '--',
  '-- IDEMPOTENTE nos tres niveis (ON CONFLICT em role, permission e',
  '-- role_permission) e NAO toca em `user_roles`: ninguem muda de perfil por',
  '-- causa de uma migration. Quem e OWNER continua OWNER.',
  '',
];

const todosOsCodigos = [...new Set(PAPEIS_DE_SISTEMA.flatMap((p) => p.permissoes))].sort();

linhas.push('-- 1. O catalogo global de permissoes, que pode nao ter algum codigo ainda.');
linhas.push('INSERT INTO permissions (id, code)');
linhas.push('VALUES');
linhas.push(
  todosOsCodigos.map((code) => `  (gen_random_uuid(), '${code}')`).join(',\n') + '',
);
linhas.push('ON CONFLICT (code) DO NOTHING;');
linhas.push('');

for (const papel of PAPEIS_DE_SISTEMA) {
  if (papel.name === 'OWNER') continue; // ja existe em todo tenant

  linhas.push(`-- 2.${papel.name}: um papel por tenant.`);
  linhas.push('INSERT INTO roles (id, tenant_id, name, is_system, created_at, updated_at)');
  linhas.push(
    `SELECT gen_random_uuid(), t.id, '${papel.name}', true, now(), now() FROM tenants t`,
  );
  linhas.push('ON CONFLICT (tenant_id, name) DO NOTHING;');
  linhas.push('');

  linhas.push(`-- 3.${papel.name}: as permissoes do papel, em todo tenant.`);
  linhas.push('INSERT INTO role_permissions (role_id, permission_id)');
  linhas.push('SELECT r.id, p.id FROM roles r');
  linhas.push('JOIN permissions p ON p.code IN (');
  linhas.push(papel.permissoes.map((c) => `  '${c}'`).join(',\n'));
  linhas.push(')');
  linhas.push(`WHERE r.name = '${papel.name}'`);
  linhas.push('ON CONFLICT (role_id, permission_id) DO NOTHING;');
  linhas.push('');
}

process.stdout.write(linhas.join('\n'));
