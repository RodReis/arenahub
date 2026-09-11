import { Injectable } from '@nestjs/common';
import type { Tenant } from '@arenahub/database';

import { PrismaService } from '../../persistence/prisma.service.js';

export type TenantNaLista = Tenant & { _count: { gymUnits: number; students: number } };

/** Quantos alunos a academia tem, por lado da conta da fatura (F64). */
export interface ContagemDeAlunosDoTenant {
  ativos: number;
  inativos: number;
}

/**
 * Acesso a tenants pelo ator de PLATAFORMA.
 *
 * Nao recebe `TenantContext` -- e a unica classe do projeto que legitimamente
 * le tenants sem filtro de tenant. Por isso ela vive no modulo `platform` e
 * so e alcancavel por rota `@PlatformRoute()`.
 */
@Injectable()
export class TenantRepository {
  constructor(private readonly db: PrismaService) {}

  async listar(): Promise<TenantNaLista[]> {
    return this.db.tenant.findMany({
      orderBy: { displayName: 'asc' },
      include: { _count: { select: { gymUnits: true, students: true } } },
    });
  }

  /**
   * Alunos ativos por academia -- a base da fatura (F64, ADR-052 §6).
   *
   * UMA consulta agrupada para TODOS os tenants, e nao uma por linha da lista:
   * a lista tem N academias, e contar dentro do laco seria N+1 consultas para
   * um numero que o `groupBy` devolve de uma vez.
   *
   * So os ATIVOS: o inativo sai por complemento do total que o `_count` ja
   * traz. Contar os dois lados aqui exigiria enumerar os seis status
   * inativos, e um status novo ficaria fora das duas contagens -- o mesmo
   * erro que `PlatformInvoiceUseCase.contarAlunos` evita.
   */
  async ativosPorTenant(): Promise<Map<string, number>> {
    // `comTenant`: `students` tem politica RLS (F66) e, fora de transacao
    // interceptada, o `set_config` nunca aplica -- sob o role restrito o
    // agrupamento volta VAZIO e a lista de academias mostra zero aluno em
    // todas, indistinguivel de base nova (issue #306).
    //
    // Esta e a leitura que ATRAVESSA tenant de proposito (nao ha `tenantId`
    // no `where`), e por isso so funciona sob o contexto `platform` -- o
    // unico que a politica deixa passar (ADR-052 SS3). O
    // `TenantRlsInterceptor` o abre a partir do `platformContext` da sessao
    // de Super Admin.
    //
    // O QUE GARANTE QUE E SEMPRE `platform`: o unico chamador e o
    // `PlatformController`, que leva `@PlatformRoute()` na CLASSE -- toda
    // rota dali exige sessao de plataforma. Chamada a partir de rota de
    // tenant abriria contexto `tenant`, e ai a politica recortaria o
    // `groupBy` a UMA academia, devolvendo zero para todas as outras na
    // lista. Se um dia este metodo ganhar chamador fora da plataforma, ele
    // precisa de `comContexto({ kind: 'platform' })` explicito.
    const grupos = await this.db.comTenant((tx) =>
      tx.student.groupBy({
        by: ['tenantId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
    );

    return new Map(grupos.map((grupo) => [grupo.tenantId, grupo._count._all]));
  }

  /**
   * Um tenant, com os campos cadastrais que a lista omite.
   *
   * `listar()` e visao de painel e nao carrega `cnpj` nem `responsavelEmail`,
   * de proposito. Um formulario de edicao alimentado por ela nasceria com
   * esses campos em branco -- e salvar apagaria dado que ninguem pediu para
   * apagar.
   *
   * Devolve `null` em vez de lancar: quem decide se e 404 e o controller, que
   * e onde a forma da resposta HTTP mora.
   */
  async porId(id: string): Promise<TenantNaLista | null> {
    return this.db.tenant.findUnique({
      where: { id },
      include: { _count: { select: { gymUnits: true, students: true } } },
    });
  }
}
