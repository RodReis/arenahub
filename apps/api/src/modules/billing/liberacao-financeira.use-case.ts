import { Injectable } from '@nestjs/common';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Liberacao financeira excepcional. `MVP-02` 7, Slice 2.4: "override
 * financeiro excepcional auditado e com expiracao".
 *
 * ## O caso real que ela resolve
 *
 * O aluno chega dizendo que pagou, o PIX ainda nao caiu, e a catraca esta
 * fechada. Sem esta valvula a recepcao tem duas saidas ruins: mandar a pessoa
 * embora, ou registrar um pagamento manual que nao aconteceu -- e o segundo
 * corrompe o financeiro para resolver um problema de porta.
 *
 * ## NAO E O OVERRIDE DA F9, e a diferenca importa
 *
 * O da F9 e por PASSAGEM: amarrado a um `accessEventId`, a recepcao abre a
 * catraca para quem esta na frente dela, uma vez. Este e por PERIODO. Reusar
 * aquele obrigaria a recepcao a repetir a liberacao a cada entrada durante
 * tres dias, o que na pratica vira ninguem conferir mais nada.
 *
 * ## Expira sozinho
 *
 * Nao ha job de expiracao: `expiresAt` e comparado com o instante da tentativa
 * no momento da leitura. Liberacao que depende de alguem lembrar de desligar
 * vira permanente por esquecimento -- e a Slice pede "com expiracao"
 * justamente por isso.
 *
 * ## A regra no 1 continua valendo
 *
 * Isto NAO faz pagamento controlar acesso: e uma pessoa autorizada assumindo
 * responsabilidade, com nome e prazo gravados. O entitlement continua
 * suspenso, e volta a `ACTIVE` so quando o pagamento entrar de verdade.
 */

/** Padrao quando a recepcao nao escolhe. Decisao do PI em 19/08/2026. */
export const DIAS_PADRAO_DE_LIBERACAO = 3;

/**
 * Teto de prazo.
 *
 * Liberacao longa demais deixa de ser excecao e vira plano gratuito por
 * outro nome -- e ninguem revisa o que ja esta valendo ha um mes.
 */
export const DIAS_MAXIMOS_DE_LIBERACAO = 30;

export class AlunoNaoEncontradoParaLiberacaoError extends ErroDeDominio {
  constructor() {
    super('STUDENT_NOT_FOUND', 404, 'Aluno nao encontrado');
  }
}

export class PrazoDeLiberacaoInvalidoError extends ErroDeDominio {
  constructor() {
    super(
      'OVERRIDE_PERIOD_INVALID',
      422,
      `A liberacao vale de 1 a ${DIAS_MAXIMOS_DE_LIBERACAO} dias`,
    );
  }
}

export class LiberacaoNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('FINANCIAL_OVERRIDE_NOT_FOUND', 404, 'Liberacao nao encontrada ou ja encerrada');
  }
}

export interface LiberacaoConcedida {
  readonly id: string;
  readonly studentId: string;
  readonly expiresAt: Date;
}

@Injectable()
export class LiberacaoFinanceiraUseCase {
  constructor(private readonly db: PrismaService) {}

  /**
   * `agora` entra por parametro (`CLAUDE.md`): o prazo e contado a partir
   * dele, e um teste precisa provar a expiracao sem relogio falso.
   */
  async conceder(
    contexto: TenantContext,
    entrada: { studentId: string; reason: string; dias?: number | undefined; agora: Date },
  ): Promise<LiberacaoConcedida> {
    const dias = entrada.dias ?? DIAS_PADRAO_DE_LIBERACAO;

    if (!Number.isInteger(dias) || dias < 1 || dias > DIAS_MAXIMOS_DE_LIBERACAO) {
      throw new PrazoDeLiberacaoInvalidoError();
    }

    const aluno = await this.db.student.findFirst({
      where: { id: entrada.studentId, tenantId: contexto.tenantId },
      select: { id: true },
    });

    if (!aluno) {
      throw new AlunoNaoEncontradoParaLiberacaoError();
    }

    const expiresAt = new Date(entrada.agora.getTime());
    expiresAt.setUTCDate(expiresAt.getUTCDate() + dias);

    /**
     * NAO REVOGA A LIBERACAO ANTERIOR. Duas liberacoes vivas nao se
     * atrapalham -- a leitura pergunta "existe alguma?", e a mais longa
     * simplesmente prevalece. Encerrar a anterior automaticamente encurtaria
     * um prazo que alguem concedeu de proposito.
     */
    const liberacao = await this.db.financialAccessOverride.create({
      data: {
        tenantId: contexto.tenantId,
        studentId: aluno.id,
        reason: entrada.reason,
        expiresAt,
        actorId: contexto.actorId,
      },
      select: { id: true, studentId: true, expiresAt: true },
    });

    return liberacao;
  }

  /**
   * Encerra a liberacao antes do prazo.
   *
   * `revokedAt` em vez de apagar a linha: a liberacao aconteceu, e quem a
   * concedeu responde por ela. Apagar tiraria da auditoria justamente o
   * registro que ela existe para guardar.
   */
  async revogar(
    contexto: TenantContext,
    entrada: { overrideId: string; agora: Date },
  ): Promise<void> {
    const atualizadas = await this.db.financialAccessOverride.updateMany({
      where: {
        id: entrada.overrideId,
        tenantId: contexto.tenantId,
        revokedAt: null,
      },
      data: { revokedAt: entrada.agora, revokedById: contexto.actorId },
    });

    if (atualizadas.count === 0) {
      throw new LiberacaoNaoEncontradaError();
    }
  }

  /**
   * Ha liberacao viva para este aluno neste instante?
   *
   * Chamada pelo caminho de decisao de acesso ANTES do motor puro -- o motor
   * nao consulta banco, e por isso `FINANCIAL_OVERRIDE` nunca sai dele
   * (mesma arquitetura de `MANUAL_OVERRIDE`, ADR-024).
   */
  async liberacaoVigente(
    tenantId: string,
    studentId: string,
    agora: Date,
  ): Promise<{ id: string; reason: string } | null> {
    return this.db.financialAccessOverride.findFirst({
      where: {
        tenantId,
        studentId,
        revokedAt: null,
        expiresAt: { gt: agora },
      },
      orderBy: { expiresAt: 'desc' },
      select: { id: true, reason: true },
    });
  }
}
