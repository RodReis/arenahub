import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

/**
 * Tirar o tenant de operacao e ato sensivel: exige motivo, e motivo que nao e
 * gravado em lugar nenhum e teatro de auditoria.
 */
export class MotivoObrigatorioError extends ErroDeDominio {
  constructor() {
    super('MOTIVO_OBRIGATORIO', 400, 'Informe o motivo ao tirar o tenant de operacao');
  }
}

export class TenantNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('TENANT_NOT_FOUND', 404, 'Tenant nao encontrado');
  }
}

/** Mesmo piso do motivo de inativacao de unidade: "ok" nao e motivo. */
const MOTIVO_MINIMO = 10;

/**
 * Uniao literal, e nao o enum do Prisma: `@arenahub/database` nao reexporta os
 * enums gerados, e o esquema Zod do PATCH ja declara os mesmos tres valores.
 */
export type SituacaoDeTenant = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';

// `| undefined` explicito: com `exactOptionalPropertyTypes`, campo opcional
// nao aceita `undefined` implicitamente, e o Zod devolve exatamente isso para
// campo ausente num PATCH.
export interface AlteracaoDeTenant {
  legalName?: string | undefined;
  displayName?: string | undefined;
  cnpj?: string | undefined;
  timezone?: string | undefined;
  responsavelNome?: string | undefined;
  responsavelEmail?: string | undefined;
  status?: SituacaoDeTenant | undefined;
  /**
   * Missao e diferenciais da tela de login por slug (F62).
   *
   * String VAZIA e valor legitimo e significa apagar o texto -- por isso ela
   * atravessa o filtro de `undefined` abaixo, que so remove campo AUSENTE.
   * "Nao mexer" e diferente de "gravar vazio", e os dois precisam existir.
   */
  missionText?: string | undefined;
  highlightsText?: string | undefined;
  /**
   * F65 -- liga/desliga a suspensao automatica por inadimplencia. Nao entra
   * em `saindoDeOperacao`: e preferencia de cobranca, nao ato que tira o
   * tenant de operacao, entao nao exige motivo.
   */
  autoSuspend?: boolean | undefined;
}

/**
 * Edicao cadastral e alternancia de situacao do tenant pelo dono do SaaS.
 *
 * Auditoria na MESMA transacao da mudanca de estado (regra de arquitetura no
 * 5): ato que falhou depois nao pode ficar gravado como se tivesse acontecido.
 */
@Injectable()
export class AlterarTenantUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async executar(
    contexto: PlatformContext,
    tenantId: string,
    dados: AlteracaoDeTenant,
    correlationId: string,
    motivo?: string,
  ): Promise<void> {
    const saindoDeOperacao = dados.status === 'INACTIVE' || dados.status === 'SUSPENDED';
    const justificativa = motivo?.trim() ?? '';

    if (saindoDeOperacao && justificativa.length < MOTIVO_MINIMO) {
      throw new MotivoObrigatorioError();
    }

    // Campo ausente chega como `undefined` e o tipo do Prisma nao o aceita sob
    // `exactOptionalPropertyTypes`. Remover a chave e mais correto que passar
    // `undefined`: "nao mexer" e diferente de "gravar vazio".
    const alteracoes = Object.fromEntries(
      Object.entries(dados).filter(([, valor]) => valor !== undefined),
    );

    await this.db.$transaction(async (tx) => {
      /*
       * `updateMany` com o filtro, e nao `update` por id: o `update` lanca
       * `P2025` do Prisma quando nao acha, e o codigo de erro do driver
       * viraria contrato acidental. O `updateMany` devolve a contagem e o
       * "nao existe" vira erro de dominio com codigo estavel.
       */
      const alterados = await tx.tenant.updateMany({ where: { id: tenantId }, data: alteracoes });

      if (alterados.count === 0) throw new TenantNaoEncontradoError();

      await this.auditoria.registrar(
        contexto,
        {
          action: dados.status === undefined ? 'tenant.updated' : 'tenant.status_changed',
          target: 'tenant',
          targetId: tenantId,
          tenantId,
          metadata: {
            // Sem PII: so o NOME dos campos, nunca o valor gravado.
            campos: Object.keys(alteracoes),
            // Motivo SO quando ele existe de verdade. Motivo em branco na
            // auditoria e pior que campo ausente: parece que alguem respondeu
            // e nao respondeu nada.
            ...(saindoDeOperacao ? { motivo: justificativa } : {}),
          },
        },
        correlationId,
        tx,
      );
    });
  }
}
