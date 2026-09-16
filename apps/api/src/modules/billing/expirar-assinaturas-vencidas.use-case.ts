import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Expira assinatura vencida -- issue #272, lacuna achada apos o fix original
 * (PR #273).
 *
 * O fix original garantiu UMA assinatura vigente por aluno (indice parcial
 * no banco), mas nada fazia uma assinatura `ACTIVE`/`PAST_DUE` transicionar
 * para `EXPIRED` quando `endsAt` passa. A migration do fix rodou este UPDATE
 * UMA VEZ como backfill; sem job recorrente, toda assinatura que vencer
 * depois volta a inflar `receitaEsperadaMinor` no painel financeiro -- o
 * mesmo sintoma da issue original, por uma causa diferente.
 *
 * IDEMPOTENTE POR CONSTRUCAO, mesmo padrao de `AplicarInadimplenciaUseCase`:
 * o `where` filtra pelo estado de ORIGEM (`ACTIVE`/`PAST_DUE` com `endsAt` no
 * passado), entao rodar duas vezes no mesmo estado nao muda nada.
 *
 * NAO mexe em `Entitlement`: o acesso fisico ja e protegido pela janela de
 * validade do proprio entitlement (F24), independente do status da
 * assinatura -- este job so corrige o FATO COMERCIAL que o painel le.
 */
@Injectable()
export class ExpirarAssinaturasVencidasUseCase {
  constructor(private readonly db: PrismaService) {}

  async executar(tenantId: string, agora: Date): Promise<{ expiradas: number }> {
    const resultado = await this.db.subscription.updateMany({
      where: {
        tenantId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        endsAt: { lt: agora },
      },
      data: { status: 'EXPIRED', version: { increment: 1 } },
    });

    return { expiradas: resultado.count };
  }
}
