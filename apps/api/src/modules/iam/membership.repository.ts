import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Consulta de vinculo entre usuario e academia.
 *
 * EXISTE PARA SER A PORTA PUBLICA de quem precisa saber "este usuario e
 * desta academia?" -- hoje o `students`, para validar o consultor
 * responsavel (F45). Sem ela, o outro modulo consultaria
 * `tenant_memberships` direto, que a regra de arquitetura no 9 proibe: a
 * regra de quem pertence a um tenant mudaria aqui e continuaria antiga la.
 *
 * POR QUE A CHECAGEM E NECESSARIA, e nao redundante com a FK: `User` e
 * entidade GLOBAL de proposito -- a mesma pessoa pode atender duas
 * academias, e por isso `users` nao tem `tenant_id` (o vinculo mora em
 * `TenantMembership`). A consequencia e que a FK `advisor_user_id ->
 * users(id)` aceita QUALQUER usuario do sistema, inclusive um que so
 * pertence a outra academia. O banco nao reclama; a regra no 2 sim.
 */
@Injectable()
export class MembershipRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * O usuario tem vinculo ATIVO com o tenant do contexto?
   *
   * `ACTIVE` e nao "existe": funcionario desligado tem vinculo revogado, e
   * atribui-lo como consultor de um aluno novo seria registrar como
   * responsavel alguem que nao trabalha mais ali.
   */
  async ehMembroAtivo(contexto: TenantContext, userId: string): Promise<boolean> {
    const vinculo = await this.db.tenantMembership.findFirst({
      where: { tenantId: contexto.tenantId, userId, status: 'ACTIVE' },
      select: { id: true },
    });

    return vinculo !== null;
  }
}
