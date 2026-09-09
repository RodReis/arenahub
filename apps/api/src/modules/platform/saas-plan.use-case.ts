import { Injectable } from '@nestjs/common';
import type { SaasPlan } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

/**
 * Plano com valores incoerentes com o proprio modelo.
 *
 * O banco tambem recusa (CHECK `saas_plans_valores_por_modelo`), e as duas
 * guardas sao de proposito: o CHECK protege o `psql` de madrugada e o seed, e
 * este erro protege quem preencheu o formulario -- 422 com mensagem em vez de
 * 500 com violacao de constraint.
 */
export class ValoresIncoerentesComOModeloError extends ErroDeDominio {
  constructor(mensagem: string) {
    super('SAAS_PLAN_VALUES_INVALID', 422, mensagem);
  }
}

export class PlanoNaoEncontradoError extends ErroDeDominio {
  constructor() {
    super('SAAS_PLAN_NOT_FOUND', 404, 'Plano não encontrado');
  }
}

/**
 * Plano arquivado nao fecha contrato novo, mas contrato JA fechado nele
 * continua valendo -- o contrato guarda copia dos valores (ADR-052 §8).
 */
export class PlanoArquivadoError extends ErroDeDominio {
  constructor() {
    super('SAAS_PLAN_ARCHIVED', 409, 'Este plano está arquivado e não aceita contrato novo');
  }
}

export interface EntradaDePlano {
  name: string;
  model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  activeStudentPriceMinor?: number | null | undefined;
  inactiveStudentPriceMinor?: number | null | undefined;
  fixedPriceMinor?: number | null | undefined;
  currency?: string | undefined;
}

/**
 * Confere que os valores batem com o modelo, ANTES do banco.
 *
 * Funcao pura, no arquivo do caso de uso porque e a unica coisa que a usa --
 * um `domain/` de tres linhas seria abstracao de uso unico.
 */
function conferirValores(entrada: EntradaDePlano): void {
  if (entrada.model === 'PER_STUDENT') {
    if (entrada.activeStudentPriceMinor == null || entrada.inactiveStudentPriceMinor == null) {
      throw new ValoresIncoerentesComOModeloError(
        'Plano por aluno exige preço de aluno ativo e de aluno inativo',
      );
    }

    if (entrada.fixedPriceMinor != null) {
      throw new ValoresIncoerentesComOModeloError('Plano por aluno não tem valor fixo mensal');
    }

    return;
  }

  if (entrada.fixedPriceMinor == null) {
    throw new ValoresIncoerentesComOModeloError('Plano fixo exige o valor mensal');
  }

  if (entrada.activeStudentPriceMinor != null || entrada.inactiveStudentPriceMinor != null) {
    throw new ValoresIncoerentesComOModeloError('Plano fixo não tem preço por aluno');
  }
}

/**
 * Catalogo de planos SaaS -- F63, ADR-052 §5.
 *
 * EDITAR PLANO NAO TOCA EM CONTRATO ATIVO. Nao ha nada aqui que propague
 * preco para contrato, e essa ausencia e a feature: o contrato copiou os
 * valores no fechamento e le os proprios.
 */
@Injectable()
export class SaasPlanUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
  ) {}

  async listar(): Promise<SaasPlan[]> {
    return this.db.saasPlan.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  }

  async porId(id: string): Promise<SaasPlan> {
    const plano = await this.db.saasPlan.findUnique({ where: { id } });

    if (!plano) throw new PlanoNaoEncontradoError();

    return plano;
  }

  async criar(
    contexto: PlatformContext,
    entrada: EntradaDePlano,
    correlationId: string,
  ): Promise<SaasPlan> {
    conferirValores(entrada);

    const plano = await this.db.saasPlan.create({
      data: {
        name: entrada.name,
        model: entrada.model,
        activeStudentPriceMinor: entrada.activeStudentPriceMinor ?? null,
        inactiveStudentPriceMinor: entrada.inactiveStudentPriceMinor ?? null,
        fixedPriceMinor: entrada.fixedPriceMinor ?? null,
        currency: entrada.currency ?? 'BRL',
      },
    });

    await this.auditoria.registrar(
      contexto,
      {
        action: 'saas_plan.created',
        target: 'saas_plan',
        targetId: plano.id,
        metadata: { model: plano.model },
      },
      correlationId,
    );

    return plano;
  }

  async alterar(
    contexto: PlatformContext,
    id: string,
    entrada: EntradaDePlano,
    correlationId: string,
  ): Promise<SaasPlan> {
    await this.porId(id);
    conferirValores(entrada);

    const plano = await this.db.saasPlan.update({
      where: { id },
      data: {
        name: entrada.name,
        model: entrada.model,
        activeStudentPriceMinor: entrada.activeStudentPriceMinor ?? null,
        inactiveStudentPriceMinor: entrada.inactiveStudentPriceMinor ?? null,
        fixedPriceMinor: entrada.fixedPriceMinor ?? null,
        currency: entrada.currency ?? 'BRL',
      },
    });

    await this.auditoria.registrar(
      contexto,
      {
        action: 'saas_plan.updated',
        target: 'saas_plan',
        targetId: plano.id,
        metadata: { model: plano.model },
      },
      correlationId,
    );

    return plano;
  }

  /**
   * Arquiva o plano. NAO apaga: contrato ativo aponta para ele pelo `planId`,
   * e apagar deixaria o contrato sem a origem que ele registra.
   */
  async arquivar(
    contexto: PlatformContext,
    id: string,
    correlationId: string,
  ): Promise<SaasPlan> {
    await this.porId(id);

    const plano = await this.db.saasPlan.update({ where: { id }, data: { status: 'ARCHIVED' } });

    await this.auditoria.registrar(
      contexto,
      { action: 'saas_plan.archived', target: 'saas_plan', targetId: plano.id },
      correlationId,
    );

    return plano;
  }
}
