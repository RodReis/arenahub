import { describe, expect, it } from '@jest/globals';

import { avisoDeRoleSemRls } from './role-do-banco.js';

describe('avisoDeRoleSemRls', () => {
  it('role comum (arenahub_app) nao gera aviso', () => {
    expect(
      avisoDeRoleSemRls({ rolname: 'arenahub_app', rolsuper: false, rolbypassrls: false }),
    ).toBeNull();
  });

  it('superusuario gera aviso com o nome do role', () => {
    const aviso = avisoDeRoleSemRls({ rolname: 'postgres', rolsuper: true, rolbypassrls: true });

    expect(aviso).toContain('"postgres"');
    expect(aviso).toContain('superusuario');
    expect(aviso).toContain('RUNTIME_DATABASE_URL');
  });

  it('role dono com BYPASSRLS (sem ser superusuario) tambem gera aviso', () => {
    const aviso = avisoDeRoleSemRls({ rolname: 'dono', rolsuper: false, rolbypassrls: true });

    expect(aviso).toContain('BYPASSRLS');
  });
});
