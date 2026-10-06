/**
 * Atributos do role com que a API esta conectada ao Postgres.
 *
 * A segunda camada de isolamento (RLS) so protege se a API conecta como
 * `arenahub_app` (`NOBYPASSRLS`): o superusuario e quem tem `BYPASSRLS` ignoram
 * a politica, mesmo com `FORCE ROW LEVEL SECURITY`.
 */
export interface AtributosDoRole {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
}

/**
 * Devolve o aviso para o log, ou `null` se o role respeita o RLS.
 *
 * So AVISA. Derrubar o boot por isto antes de conferir o estado real da
 * producao derrubaria o servico (issue #584): o aviso primeiro, a falha de
 * boot so depois de confirmado que producao conecta com o role certo.
 */
export function avisoDeRoleSemRls(role: AtributosDoRole): string | null {
  if (!role.rolsuper && !role.rolbypassrls) return null;

  const motivo = role.rolsuper ? 'superusuario' : 'BYPASSRLS';

  return (
    `RLS DESLIGADO NA PRATICA: a API esta conectada como o role "${role.rolname}" ` +
    `(${motivo}), que ignora as politicas de isolamento por tenant. Defina ` +
    'RUNTIME_DATABASE_URL com o role arenahub_app (NOBYPASSRLS). Ver docs/DEPLOY.md.'
  );
}
