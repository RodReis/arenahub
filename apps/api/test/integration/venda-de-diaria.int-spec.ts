import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module.js';
import { PasswordService } from '../../src/modules/auth/password.service.js';
import { MembershipRepository } from '../../src/modules/membership/membership.repository.js';
import { PrismaService } from '../../src/persistence/prisma.service.js';
import { comContextoDeTenant } from './com-contexto-de-tenant.js';
import {
  AGORA,
  apagarCenario,
  contextoDe,
  criarCenarioDeDiaria,
  type CenarioDeDiaria,
} from './helpers/cenario-de-diaria.js';

/**
 * Diaria avulsa no balcao (F86, issue #616): o aluno sem plano paga R$ 30,00 e
 * usa a academia ate 23:59. Contra banco de verdade (`docs/TESTING.md` 3): a
 * atomicidade, a trava do aluno e a promocao pelo pagamento sao comportamento
 * do Postgres -- dublar o banco provaria so a sintaxe do TypeScript.
 */
describe('F86 -- diaria avulsa no balcao', () => {
  let db: PrismaService;
  let membership: MembershipRepository;
  let c: CenarioDeDiaria;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    db = moduleRef.get(PrismaService);
    membership = comContextoDeTenant(moduleRef.get(MembershipRepository));
    c = await criarCenarioDeDiaria(db, moduleRef.get(PasswordService));
  });

  afterAll(async () => {
    await apagarCenario(db, c);
  });

  it('persiste plano com a modalidade DIARIA', async () => {
    const plano = await membership.criarPlano(
      contextoDe(c),
      {
        name: `Diaria ${c.sufixo}`,
        gymUnitIds: [c.unidadeId],
        janelas: [{ gymUnitId: c.unidadeId, dayOfWeek: 1, startMinute: 360, endMinute: 1320 }],
        amountMinor: 3000,
        billingMode: 'DIARIA',
      },
      'corr-f86',
      AGORA,
    );

    expect(plano.billingMode).toBe('DIARIA');
  });
});
