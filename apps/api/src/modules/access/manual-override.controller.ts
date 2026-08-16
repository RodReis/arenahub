import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { RequirePermissions } from '../../common/security/permissions.decorator.js';
import { TenantContextService } from '../../common/tenant/tenant-context.service.js';
import {
  ManualOverrideUseCase,
  type OverrideRegistrado,
} from './manual-override.use-case.js';

/**
 * Liberação manual -- `M1-FR-023`, `M1-AC-008`.
 *
 * O motivo tem minimo de 10 caracteres. Nao e burocracia: override e o
 * unico caminho pelo qual alguem entra sem direito, e a auditoria so serve
 * se o campo disser algo. "ok" e "teste" nao explicam nada seis meses depois,
 * quando a pergunta for "por que esta pessoa passou no dia 12?".
 */
const esquemaDeOverride = z
  .object({
    gymUnitId: z.string().uuid(),
    /** Aluno conhecido. Exclusivo com `visitorDescription`. */
    studentId: z.string().uuid().optional(),
    /** Visitante. Minimizado: nome e contexto, nunca documento. */
    visitorDescription: z.string().min(3).max(120).optional(),
    deviceId: z.string().uuid(),
    reason: z.string().min(10).max(300),
    /** Dedupe: clique duplo da recepcao nao gira a catraca duas vezes. */
    idempotencyKey: z.string().min(8).max(120),
    /**
     * Confirmacao explicita, como na revogacao biometrica da F8.
     *
     * O `literal(true)` faz o servidor recusar o pedido que chega sem ela --
     * a tela pode ter bug, mas a API nao aceita override "sem querer".
     */
    confirm: z.literal(true),
  })
  .strict();

@Controller('api/v1/access/manual-overrides')
export class ManualOverrideController {
  constructor(
    private readonly override: ManualOverrideUseCase,
    private readonly contexto: TenantContextService,
  ) {}

  /**
   * Abre a catraca para alguem, com motivo e responsavel registrados.
   *
   * `access.override` e permissao PROPRIA, separada de `access.read`: quem
   * consulta eventos no dia a dia nao precisa, por isso, poder abrir a
   * catraca. Ato excepcional pede permissao excepcional.
   */
  @Post()
  @RequirePermissions('access.override')
  async criar(@Body() corpo: unknown, @Req() requisicao: Request): Promise<OverrideRegistrado> {
    const dados = esquemaDeOverride.parse(corpo);
    const contexto = this.contexto.require();

    return this.override.executar(contexto, {
      gymUnitId: dados.gymUnitId,
      studentId: dados.studentId,
      visitorDescription: dados.visitorDescription,
      deviceId: dados.deviceId,
      reason: dados.reason,
      idempotencyKey: dados.idempotencyKey,
      correlationId: requisicao.correlationId ?? 'sem-correlacao',
    });
  }
}
