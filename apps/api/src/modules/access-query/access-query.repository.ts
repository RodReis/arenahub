import { Injectable } from '@nestjs/common';
import type { Prisma } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';

/**
 * Consulta de eventos de acesso -- `M1-FR-024`.
 *
 * SO LEITURA. Este modulo nao tem `create`, `update` nem `delete`, e a
 * ausencia e a mesma garantia do `AccessEventRepository`: evento de passagem
 * e imutavel (`M1-BR-009`). Quem quiser corrigir usa o caminho de correcao,
 * que ACRESCENTA registro.
 */

export interface FiltroDeEventos {
  /** Obrigatorio e limitado -- ver `PERIODO_MAXIMO_DIAS`. */
  de: Date;
  ate: Date;
  gymUnitId?: string | undefined;
  studentId?: string | undefined;
  outcome?: 'ALLOW' | 'DENY' | undefined;
  mode?: 'ONLINE' | 'OFFLINE' | 'OVERRIDE' | undefined;
  /** Cursor opaco da pagina anterior. */
  cursor?: string | undefined;
  limite: number;
}

export interface EventoResumido {
  id: string;
  occurredAt: string;
  receivedAt: string;
  gymUnitId: string;
  outcome: string;
  reason: string;
  mode: string;
  method: string;
  /** Resumo do aluno. NUNCA CPF, foto ou divida. */
  student: { id: string; fullName: string; membershipNumber: string } | null;
  /** O que o leitor informou, quando nao resolveu para aluno nenhum. */
  externalUserId: string | null;
  deviceId: string | null;
  passageState: string | null;
  correlationId: string;
}

export interface PaginaDeEventos {
  eventos: EventoResumido[];
  /** Ausente quando nao ha mais pagina. */
  proximoCursor: string | null;
  /** `true` quando o periodo pedido foi reduzido ao maximo permitido. */
  periodoLimitado: boolean;
}

/**
 * Teto do periodo interativo.
 *
 * 31 dias vem do plano da fatia. O motivo de haver um teto: sem ele, alguem
 * abre o painel e pede "tudo", o banco varre a tabela inteira e a API fica
 * indisponivel para a operacao que esta com uma pessoa parada na catraca.
 * Periodo maior existe -- pela exportacao assincrona, que nao bloqueia a API.
 */
export const PERIODO_MAXIMO_DIAS = 31;

/** Sem periodo informado, o painel abre nas ultimas 24 h. */
export const PERIODO_PADRAO_HORAS = 24;

@Injectable()
export class AccessQueryRepository {
  constructor(private readonly db: PrismaService) {}

  async listar(contexto: TenantContext, filtro: FiltroDeEventos): Promise<PaginaDeEventos> {
    const { de, ate, limitado } = this.limitarPeriodo(filtro.de, filtro.ate);

    // Cursor entra DENTRO do `where`, com `AND`. Passa-lo como objeto
    // separado faria o Prisma usar um dos dois e descartar o outro -- e o
    // descartado seria o filtro, devolvendo evento fora do periodo pedido.
    const where: Prisma.AccessEventWhereInput = {
      ...this.montarWhere(contexto, { ...filtro, de, ate }),
      ...(filtro.cursor ? { AND: [this.condicaoDoCursor(filtro.cursor)] } : {}),
    };

    // `limite + 1` para saber se ha proxima pagina sem um `count` separado --
    // `count` numa tabela de eventos e a consulta cara que o teto de periodo
    // existe para evitar.
    const encontrados = await this.db.accessEvent.findMany({
      where,
      // Ordem DECRESCENTE e o que a operacao quer ver: o que acabou de
      // acontecer primeiro. `id` desempata para o cursor ser estavel quando
      // dois eventos compartilham o mesmo instante -- e eles compartilham,
      // porque uma rajada do leitor cabe no mesmo milissegundo.
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: filtro.limite + 1,
      select: {
        id: true,
        occurredAt: true,
        receivedAt: true,
        gymUnitId: true,
        outcome: true,
        reason: true,
        mode: true,
        method: true,
        externalUserId: true,
        deviceId: true,
        correlationId: true,
        student: { select: { id: true, fullName: true, membershipNumber: true } },
        passage: { select: { state: true } },
      },
    });

    const temMais = encontrados.length > filtro.limite;
    const pagina = temMais ? encontrados.slice(0, filtro.limite) : encontrados;
    const ultimo = pagina[pagina.length - 1];

    return {
      eventos: pagina.map((e) => ({
        id: e.id,
        occurredAt: e.occurredAt.toISOString(),
        receivedAt: e.receivedAt.toISOString(),
        gymUnitId: e.gymUnitId,
        outcome: e.outcome,
        reason: e.reason,
        mode: e.mode,
        method: e.method,
        student: e.student,
        externalUserId: e.externalUserId,
        deviceId: e.deviceId,
        passageState: e.passage?.state ?? null,
        correlationId: e.correlationId,
      })),
      proximoCursor: temMais && ultimo ? this.montarCursor(ultimo.occurredAt, ultimo.id) : null,
      periodoLimitado: limitado,
    };
  }

  /**
   * Detalhe de um evento, com as correcoes vinculadas.
   *
   * NAO OFERECE edicao nem remocao. E o `M1-BR-009` visivel na API: quem abre
   * um evento errado ve o registro original E a correcao que o sucede, nunca
   * um botao de "corrigir aqui".
   */
  async detalhar(
    contexto: TenantContext,
    id: string,
  ): Promise<{
    evento: EventoResumido;
    detail: unknown;
    policyVersion: string;
    validUntil: string | null;
    recognizedAt: string | null;
    correcoes: { id: string; reason: string; createdAt: string; correctingEventId: string | null }[];
  } | null> {
    const evento = await this.db.accessEvent.findFirst({
      where: {
        id,
        tenantId: contexto.tenantId,
        ...this.escopoDeUnidade(contexto),
      },
      select: {
        id: true,
        occurredAt: true,
        receivedAt: true,
        recognizedAt: true,
        gymUnitId: true,
        outcome: true,
        reason: true,
        mode: true,
        method: true,
        externalUserId: true,
        deviceId: true,
        correlationId: true,
        policyVersion: true,
        validUntil: true,
        detail: true,
        student: { select: { id: true, fullName: true, membershipNumber: true } },
        passage: { select: { state: true } },
        corrections: {
          select: { id: true, reason: true, createdAt: true, correctingEventId: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!evento) return null;

    return {
      evento: {
        id: evento.id,
        occurredAt: evento.occurredAt.toISOString(),
        receivedAt: evento.receivedAt.toISOString(),
        gymUnitId: evento.gymUnitId,
        outcome: evento.outcome,
        reason: evento.reason,
        mode: evento.mode,
        method: evento.method,
        student: evento.student,
        externalUserId: evento.externalUserId,
        deviceId: evento.deviceId,
        passageState: evento.passage?.state ?? null,
        correlationId: evento.correlationId,
      },
      // `detail` carrega a entrada congelada do motor -- e o que responde
      // "por que negou?" sem reconstruir o estado do banco daquele instante.
      detail: evento.detail,
      policyVersion: evento.policyVersion,
      validUntil: evento.validUntil?.toISOString() ?? null,
      recognizedAt: evento.recognizedAt?.toISOString() ?? null,
      correcoes: evento.corrections.map((c) => ({
        id: c.id,
        reason: c.reason,
        createdAt: c.createdAt.toISOString(),
        correctingEventId: c.correctingEventId,
      })),
    };
  }

  /**
   * Itera o resultado inteiro em paginas, para a exportacao.
   *
   * Generator, e nao `findMany` sem `take`: exportar 100 mil eventos com uma
   * consulta so carregaria tudo em memoria e derrubaria a API que a operacao
   * esta usando ao mesmo tempo.
   */
  async *paginarParaExportacao(
    contexto: TenantContext,
    filtro: Omit<FiltroDeEventos, 'cursor' | 'limite'>,
    tamanhoDaPagina = 500,
  ): AsyncGenerator<EventoResumido[]> {
    let cursor: string | undefined;

    for (;;) {
      const pagina = await this.listar(contexto, {
        ...filtro,
        cursor,
        limite: tamanhoDaPagina,
      });

      if (pagina.eventos.length === 0) return;

      yield pagina.eventos;

      if (!pagina.proximoCursor) return;

      cursor = pagina.proximoCursor;
    }
  }

  async contar(contexto: TenantContext, filtro: Omit<FiltroDeEventos, 'cursor' | 'limite'>) {
    const { de, ate } = this.limitarPeriodo(filtro.de, filtro.ate);

    return this.db.accessEvent.count({
      where: this.montarWhere(contexto, { ...filtro, de, ate, limite: 0 }),
    });
  }

  /**
   * Quantas entradas AUTORIZADAS a unidade teve no periodo (F51).
   *
   * CASO DE USO PUBLICO deste modulo, e por isso existe aqui em vez de o
   * `kiosk` consultar `access_events` direto: modulo nao le tabela privada
   * de outro (regra de arquitetura no 9).
   *
   * Escopo por `gymUnitId` EXPLICITO, e nao por `TenantContext`: quem chama
   * e o totem, cuja credencial e de dispositivo e ja carrega a unidade --
   * nao ha papel nem `allowedUnitIds` no caminho. Reusar `contar` obrigaria
   * a fabricar um `TenantContext` falso, e contexto fabricado e como
   * isolamento de tenant vira decoracao.
   *
   * Devolve INTEIRO. Nao ha `select` de aluno, de nome nem de id nesta
   * consulta -- `M3.5-BR-001` e cumprido por o dado nunca sair do banco.
   */
  async contarEntradasDaUnidade(entrada: {
    readonly tenantId: string;
    readonly gymUnitId: string;
    readonly de: Date;
    readonly ate: Date;
  }): Promise<number> {
    return this.db.accessEvent.count({
      where: {
        tenantId: entrada.tenantId,
        gymUnitId: entrada.gymUnitId,
        outcome: 'ALLOW',
        occurredAt: { gte: entrada.de, lte: entrada.ate },
      },
    });
  }

  private montarWhere(
    contexto: TenantContext,
    filtro: FiltroDeEventos,
  ): Prisma.AccessEventWhereInput {
    return {
      tenantId: contexto.tenantId,
      occurredAt: { gte: filtro.de, lte: filtro.ate },
      ...this.escopoDeUnidade(contexto),
      // Filtro explicito de unidade se soma ao escopo do papel; nao o
      // substitui. Um operador restrito a unidade A pedindo a unidade B
      // recebe vazio, nao os dados de B.
      ...(filtro.gymUnitId ? { gymUnitId: filtro.gymUnitId } : {}),
      ...(filtro.studentId ? { studentId: filtro.studentId } : {}),
      ...(filtro.outcome ? { outcome: filtro.outcome } : {}),
      ...(filtro.mode ? { mode: filtro.mode } : {}),
    };
  }

  private escopoDeUnidade(contexto: TenantContext): Prisma.AccessEventWhereInput {
    if (contexto.allowedUnitIds === 'ALL') return {};

    return { gymUnitId: { in: [...contexto.allowedUnitIds] } };
  }

  /**
   * Corta o periodo ao maximo permitido, preservando o FIM.
   *
   * Preservar o fim e nao o inicio e deliberado: quem pede um intervalo longo
   * quer chegar ao que aconteceu mais recentemente. Cortar pelo fim devolveria
   * um mes velho e esconderia justamente o que a pessoa procurava.
   */
  private limitarPeriodo(de: Date, ate: Date): { de: Date; ate: Date; limitado: boolean } {
    const maximoMs = PERIODO_MAXIMO_DIAS * 86_400_000;

    if (ate.getTime() - de.getTime() <= maximoMs) return { de, ate, limitado: false };

    return { de: new Date(ate.getTime() - maximoMs), ate, limitado: true };
  }

  /**
   * Cursor `(occurredAt, id)` em base64url.
   *
   * Codificado para ser OPACO: cursor legivel convida quem consome a
   * construi-lo a mao, e ai a paginacao passa a depender do formato interno.
   */
  private montarCursor(occurredAt: Date, id: string): string {
    return Buffer.from(`${occurredAt.toISOString()}|${id}`, 'utf8').toString('base64url');
  }

  private condicaoDoCursor(cursor: string): Prisma.AccessEventWhereInput {
    const bruto = Buffer.from(cursor, 'base64url').toString('utf8');
    const [instante, id] = bruto.split('|');

    const quando = instante ? new Date(instante) : new Date(Number.NaN);

    // Cursor corrompido nao vira consulta sem filtro: ignora-lo devolveria a
    // primeira pagina de novo, num laco infinito para quem estiver
    // paginando. Devolver nada e o comportamento que expoe o defeito.
    if (!id || !Number.isFinite(quando.getTime())) {
      return { id: '00000000-0000-0000-0000-000000000000' };
    }

    // Chave composta: eventos no MESMO instante desempatam por id, e nenhum
    // e pulado nem repetido entre paginas.
    return {
      OR: [{ occurredAt: { lt: quando } }, { occurredAt: quando, id: { lt: id } }],
    };
  }
}
