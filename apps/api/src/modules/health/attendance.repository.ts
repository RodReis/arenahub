import { Injectable } from '@nestjs/common';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  POLITICA_DE_SESSAO,
  type PassagemElegivel,
  type SessaoProjetada,
} from './domain/frequencia.js';

/**
 * Sessoes de frequencia (`M3-FR-013`, Slice 3.4).
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 *
 * Este repositorio LE passagens e ESCREVE sessoes. Ele nunca escreve em
 * `access_events` nem em `access_passages`: `M3-BR-008` exige agrupar "sem
 * apagar eventos brutos", e a regra de arquitetura no 9 proibe um modulo de
 * mexer na tabela privada de outro. A leitura e por caso de uso publico do
 * proprio Prisma, em modo somente-leitura.
 */
@Injectable()
export class AttendanceRepository {
  constructor(private readonly db: PrismaService) {}

  /**
   * Passagens ELEGIVEIS de um aluno, para projecao.
   *
   * A elegibilidade e um `WHERE`, e cada clausula fecha uma porta diferente:
   *
   * - `passage.state = CONFIRMED` -- `M3-BR-007`: acesso concedido SEM giro
   *   confirmado nao e treino. A pessoa que recebeu ALLOW e desistiu na porta
   *   nao esteve na academia.
   * - `outcome = ALLOW` -- negado nunca vira frequencia, mesmo que o braco
   *   tenha girado por outro motivo.
   * - `studentId` -- evento sem aluno resolvido (identidade desconhecida) nao
   *   pertence a ninguem, e atribui-lo a alguem seria inventar presenca.
   *
   * O filtro de correcao NAO esta aqui de proposito: `access_event_corrections`
   * marca evento errado, e um evento corrigido continua sendo um fato fisico
   * ocorrido. Tratar correcao como exclusao apagaria a passagem real; quando
   * o MVP 1 amadurecer esse fluxo, a decisao volta a esta funcao -- e por isso
   * ela mora num lugar so.
   */
  async passagensElegiveis(
    contexto: TenantContext,
    studentId: string,
    desde: Date | null,
    ate: Date,
  ): Promise<PassagemElegivel[]> {
    const eventos = await this.db.accessEvent.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        outcome: 'ALLOW',
        passage: { state: 'CONFIRMED' },
        occurredAt: desde ? { gte: desde, lte: ate } : { lte: ate },
      },
      select: {
        id: true,
        gymUnitId: true,
        occurredAt: true,
        passage: { select: { id: true } },
      },
      orderBy: { occurredAt: 'asc' },
    });

    return eventos.flatMap((evento) =>
      // `passage` nao pode ser nulo aqui (o `where` exige `state`), mas o tipo
      // do Prisma nao sabe disso. `flatMap` descarta em vez de usar `!`: se um
      // dia a clausula mudar, o codigo deixa de contar em vez de estourar.
      evento.passage
        ? [
            {
              passageId: evento.passage.id,
              accessEventId: evento.id,
              gymUnitId: evento.gymUnitId,
              occurredAt: evento.occurredAt,
            },
          ]
        : [],
    );
  }

  /**
   * Grava as sessoes projetadas, de forma idempotente.
   *
   * `upsert` e nao `create` porque reprojetar e uma operacao NORMAL, nao um
   * erro: o mesmo dia pode ser projetado de novo quando um evento atrasado
   * chega. A chave unica `(tenant, aluno, dia, unidade, politica)` decide o
   * que e a mesma sessao; o `update` reescreve os agregados daquele dia com o
   * conjunto novo de passagens.
   *
   * Tudo numa transacao: projetar meio periodo deixaria a frequencia
   * parcialmente atualizada, e o numero na tela seria a soma de duas verdades
   * de momentos diferentes.
   */
  async gravarSessoes(
    contexto: TenantContext,
    studentId: string,
    sessoes: readonly SessaoProjetada[],
  ): Promise<number> {
    if (sessoes.length === 0) return 0;

    await this.db.$transaction(
      sessoes.map((sessao) => {
        const chave = {
          tenantId_studentId_sessionDate_gymUnitId_policyVersion: {
            tenantId: contexto.tenantId,
            studentId,
            sessionDate: new Date(`${sessao.dataLocal}T00:00:00.000Z`),
            gymUnitId: sessao.gymUnitId,
            policyVersion: sessao.policyVersion,
          },
        };

        const dados = {
          firstPassageAt: sessao.primeiraEm,
          lastPassageAt: sessao.ultimaEm,
          passageCount: sessao.passagens,
          passageIds: [...sessao.passageIds],
        };

        return this.db.studentAttendanceSession.upsert({
          where: chave,
          // `sessionDate` como `Date` em UTC puro: a coluna e `DATE`, sem
          // fuso, e o dia ja foi decidido pela politica. Passar um instante
          // local aqui faria o Postgres reinterpretar o fuso -- aplicando-o
          // duas vezes, que e o erro classico desta tabela.
          create: {
            tenantId: contexto.tenantId,
            studentId,
            gymUnitId: sessao.gymUnitId,
            sessionDate: new Date(`${sessao.dataLocal}T00:00:00.000Z`),
            policyVersion: sessao.policyVersion,
            ...dados,
          },
          update: dados,
        });
      }),
    );

    return sessoes.length;
  }

  /**
   * Sessoes ja projetadas, na politica vigente.
   *
   * Filtrar por `policyVersion` nao e detalhe: sessoes de politicas diferentes
   * contam coisas diferentes, e somar as duas produziria frequencia dobrada no
   * periodo em que ambas existem.
   */
  async listarSessoes(
    contexto: TenantContext,
    studentId: string,
    desde: Date | null,
    ate: Date,
  ): Promise<SessaoProjetada[]> {
    const linhas = await this.db.studentAttendanceSession.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        policyVersion: POLITICA_DE_SESSAO,
        sessionDate: desde ? { gte: desde, lte: ate } : { lte: ate },
      },
      orderBy: [{ sessionDate: 'asc' }, { gymUnitId: 'asc' }],
    });

    return linhas.map((linha) => ({
      // `toISOString().slice(0,10)` e seguro porque a coluna e `DATE` e o
      // Prisma devolve meia-noite UTC -- nao ha hora a perder na conversao.
      dataLocal: linha.sessionDate.toISOString().slice(0, 10),
      gymUnitId: linha.gymUnitId,
      primeiraEm: linha.firstPassageAt,
      ultimaEm: linha.lastPassageAt,
      passagens: linha.passageCount,
      passageIds: linha.passageIds,
      policyVersion: linha.policyVersion,
    }));
  }
}
