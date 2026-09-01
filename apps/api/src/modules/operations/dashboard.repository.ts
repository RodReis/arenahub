import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { inicioDoDiaLocal } from '../health/domain/periodo.js';
import { feriadosDoMes, type FeriadoDoCalendario } from './domain/feriados.js';

/**
 * Ordem de exibicao das contagens por situacao -- funcao PURA, exportada
 * para ter teste proprio.
 *
 * `groupBy` sem `orderBy` devolve na ordem FISICA do Postgres, que muda a
 * cada UPDATE nas linhas. Ordenar so por quantidade deixa os empates -- que
 * sao a maioria numa academia com dois ou tres bloqueados -- trocando de
 * lugar entre dois carregamentos, sem nada ter mudado. Uma lista que se
 * reordena sozinha faz a recepcao reler a tela para conferir se leu certo.
 *
 * Vive aqui, e nao inline no `.sort()`, porque a ordem fisica do Postgres
 * NAO e reproduzivel sob demanda: teste de integracao que tenta forcar o
 * embaralhamento passa verde mesmo sem o desempate (medido). O que da para
 * provar de verdade e a funcao de comparacao, com as entradas na ordem
 * errada de proposito.
 */
export function compararSituacoes(
  a: ContagemDeSituacao,
  b: ContagemDeSituacao,
): number {
  return (
    b.quantidade - a.quantidade ||
    a.status.localeCompare(b.status) ||
    // `null` por ULTIMO: "motivo nao informado" e o caso a resolver, nao o
    // cabecalho da lista. `￿` e o maior ponto de codigo utilizavel.
    (a.motivo ?? '￿').localeCompare(b.motivo ?? '￿')
  );
}

/**
 * Leitura agregada do dashboard operacional -- F57, `SPEC-057`.
 *
 * SO LE. Nenhum bloco do dashboard escreve: a tela que todo mundo deixa
 * aberta na recepcao e o pior lugar possivel para um botao que muda estado.
 *
 * Le tabela de outros modulos (`students`, `challenges`, `local_holidays`)
 * pela mesma razao que `OperationsRepository` ja le -- leitura agregada e
 * somente-leitura nao e o acoplamento que a regra de arquitetura no 9 impede.
 * Nenhuma REGRA de outro modulo e reimplementada aqui: onde havia regra
 * (exposicao de placar), o caso de uso publico daquele modulo e chamado.
 */

export interface ResumoDoDia {
  /** Meia-noite LOCAL da unidade, em ISO -- de quando o contador conta. */
  desde: string;
  allow: number;
  deny: number;
  override: number;
}

export interface ContagemDeSituacao {
  /** `SUSPENDED` ou `BLOCKED`. */
  status: string;
  /** `null` para quem foi bloqueado antes de o motivo existir (#241). */
  motivo: string | null;
  quantidade: number;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Acessos do DIA da unidade -- bloco 2.
   *
   * "Hoje" e o dia civil da unidade, nao as ultimas 24 h e nao o dia em UTC:
   *
   * - 24 h corridas fazem o numero das 9h da manha incluir metade do
   *   movimento de ontem, e ele nunca bate com o que a recepcao contou.
   * - dia em UTC faz o contador ZERAR as 21h de Brasilia -- na frente do
   *   operador, no pico.
   *
   * O corte sai de `inicioDoDiaLocal`, que e o unico lugar do codigo que
   * sabe converter fuso em meia-noite (ADR-019, sem fallback).
   */
  async acessosDeHoje(
    contexto: TenantContext,
    gymUnitId: string,
    fuso: string,
    agora: Date,
  ): Promise<ResumoDoDia> {
    const desde = inicioDoDiaLocal(agora, fuso);

    const [porResultado, overrides] = await Promise.all([
      this.db.accessEvent.groupBy({
        by: ['outcome'],
        where: { tenantId: contexto.tenantId, gymUnitId, occurredAt: { gte: desde } },
        _count: true,
      }),

      this.db.accessEvent.count({
        where: {
          tenantId: contexto.tenantId,
          gymUnitId,
          mode: 'OVERRIDE',
          occurredAt: { gte: desde },
        },
      }),
    ]);

    return {
      desde: desde.toISOString(),
      allow: porResultado.find((g) => g.outcome === 'ALLOW')?._count ?? 0,
      deny: porResultado.find((g) => g.outcome === 'DENY')?._count ?? 0,
      override: overrides,
    };
  }

  /**
   * Quantos alunos estao suspensos ou bloqueados, POR MOTIVO -- bloco 4.
   *
   * O motivo e a lista fechada da issue #241 (`StudentStatusReason`), e e por
   * ela ser fechada que esta contagem existe: texto livre nao se agrupa.
   *
   * `motivo: null` aparece de proposito -- quem foi bloqueado antes de o
   * campo existir nao tem razao gravada, e esconder essa linha faria a soma
   * das partes nao bater com o total que a grid de alunos mostra.
   */
  async situacoesRestritivas(
    contexto: TenantContext,
    gymUnitId: string,
  ): Promise<readonly ContagemDeSituacao[]> {
    const grupos = await this.db.student.groupBy({
      by: ['status', 'statusReason'],
      where: {
        tenantId: contexto.tenantId,
        gymUnitId,
        status: { in: ['SUSPENDED', 'BLOCKED'] },
      },
      _count: true,
    });

    return grupos
      .map((g) => ({
        status: g.status,
        motivo: g.statusReason,
        quantidade: g._count,
      }))
      .sort(compararSituacoes);
  }

  /**
   * Feriados do mes corrente da unidade -- bloco 7.
   *
   * Nacionais sao CALCULADOS (nunca gravados, nunca por rede); municipais vem
   * do cadastro da propria unidade. Ver `domain/feriados.ts`.
   */
  async feriadosDoMesCorrente(
    contexto: TenantContext,
    gymUnitId: string,
    mes: string,
  ): Promise<readonly FeriadoDoCalendario[]> {
    const cadastrados = await this.db.localHoliday.findMany({
      where: { tenantId: contexto.tenantId, gymUnitId },
      select: { date: true, name: true },
      orderBy: { date: 'asc' },
    });

    const municipais = cadastrados.map((f) => ({
      // `@db.Date` volta como Date a meia-noite UTC: o prefixo do ISO E a
      // data local que foi gravada. Formatar por fuso aqui a moveria um dia.
      data: f.date.toISOString().slice(0, 10),
      nome: f.name,
      origem: 'MUNICIPAL' as const,
    }));

    return feriadosDoMes(mes, municipais);
  }

  /**
   * Cadastra um feriado municipal -- unica ESCRITA da fatia, e ela nao mora
   * no dashboard: a tela de configuracao da unidade e que a oferece.
   *
   * Idempotente por `@@unique(gymUnitId, date)`: dois cliques no botao
   * atualizam o nome em vez de deixar o mesmo dia duas vezes na lista.
   */
  async cadastrarFeriado(
    contexto: TenantContext,
    gymUnitId: string,
    data: string,
    nome: string,
  ): Promise<FeriadoDoCalendario> {
    // `Date.UTC` a partir do `AAAA-MM-DD`: coluna `@db.Date` guarda dia, nao
    // instante, e deixar o parser inferir fuso local moveria a data um dia
    // para quem roda a oeste de Greenwich.
    const [ano, mes, dia] = data.split('-').map(Number);
    const comoData = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, dia ?? 1));

    const gravado = await this.db.localHoliday.upsert({
      where: { gymUnitId_date: { gymUnitId, date: comoData } },
      create: { tenantId: contexto.tenantId, gymUnitId, date: comoData, name: nome },
      update: { name: nome },
      select: { date: true, name: true },
    });

    return {
      data: gravado.date.toISOString().slice(0, 10),
      nome: gravado.name,
      origem: 'MUNICIPAL',
    };
  }

  /**
   * Remove um feriado municipal cadastrado.
   *
   * Escopo de tenant no `deleteMany` e nao no `delete`: `delete` por id
   * apagaria a linha de outro tenant que soubesse o UUID, e `deleteMany`
   * com `tenantId` no filtro simplesmente nao acha nada.
   */
  async removerFeriado(contexto: TenantContext, gymUnitId: string, id: string): Promise<boolean> {
    const { count } = await this.db.localHoliday.deleteMany({
      where: { id, tenantId: contexto.tenantId, gymUnitId },
    });

    return count > 0;
  }

  /** Feriados municipais cadastrados na unidade, para a tela de configuracao. */
  async feriadosCadastrados(
    contexto: TenantContext,
    gymUnitId: string,
  ): Promise<readonly { id: string; data: string; nome: string }[]> {
    const encontrados = await this.db.localHoliday.findMany({
      where: { tenantId: contexto.tenantId, gymUnitId },
      select: { id: true, date: true, name: true },
      orderBy: { date: 'asc' },
    });

    return encontrados.map((f) => ({
      id: f.id,
      data: f.date.toISOString().slice(0, 10),
      nome: f.name,
    }));
  }

  /** Fuso e nome da unidade -- o "hoje" nao existe sem eles. */
  async unidade(
    contexto: TenantContext,
    gymUnitId: string,
  ): Promise<{ id: string; name: string; timezone: string } | null> {
    return this.db.gymUnit.findFirst({
      where: { id: gymUnitId, tenantId: contexto.tenantId },
      select: { id: true, name: true, timezone: true },
    });
  }

  /** Unidades ativas do tenant, para o dashboard saber de quem falar. */
  async unidadesAtivas(
    contexto: TenantContext,
  ): Promise<readonly { id: string; name: string; timezone: string }[]> {
    return this.db.gymUnit.findMany({
      where: { tenantId: contexto.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    });
  }
}
