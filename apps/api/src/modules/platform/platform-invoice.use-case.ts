import { Injectable } from '@nestjs/common';
import { comContexto, type PlatformInvoice, type Prisma, type TenantContract } from '@arenahub/database';

import { ErroDeDominio } from '../../common/http/erro-de-dominio.js';
import type { PlatformContext } from '../../common/platform/platform-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  calcularFatura,
  competenciaDe,
  proximaEmissao,
  vencimentoDaFatura,
  type ContagemDeAlunos,
  type FaturaCalculada,
  type ValoresDoContrato,
} from './domain/calculo-da-fatura.js';
import { PlatformAuditService } from './platform-audit.service.js';
import { SuspenderTenantUseCase } from './suspender-tenant.use-case.js';
import { TenantContractUseCase } from './tenant-contract.use-case.js';

export class FaturaNaoEncontradaError extends ErroDeDominio {
  constructor() {
    super('PLATFORM_INVOICE_NOT_FOUND', 404, 'Fatura da plataforma não encontrada');
  }
}

/**
 * Pagamento so se registra UMA vez.
 *
 * 409 e nao 422: o corpo esta bem formado, o que nao pode e o ESTADO. Sem
 * isto, registrar duas vezes reescreveria `paidAt` e o historico perderia
 * quando a academia de fato pagou.
 */
export class FaturaJaPagaError extends ErroDeDominio {
  constructor() {
    super('PLATFORM_INVOICE_ALREADY_PAID', 409, 'Esta fatura já consta como paga');
  }
}

export class TenantSemContratoAtivoError extends ErroDeDominio {
  constructor() {
    super(
      'TENANT_CONTRACT_NOT_ACTIVE',
      422,
      'Esta academia não tem contrato vigente. Ative um contrato antes de faturar',
    );
  }
}

/** A previa que o OWNER e o Super Admin veem antes da emissao. */
export interface PreviaDaFatura {
  /** `AAAA-MM` da competencia que sera faturada. */
  competencia: string;
  /** Dia em que a fatura sai, ISO. */
  emiteEm: string;
  vencimento: string;
  model: string;
  activeCount: number;
  inactiveCount: number;
  activeStudentPriceMinor: number | null;
  inactiveStudentPriceMinor: number | null;
  totalMinor: number;
  currency: string;
  /** `true` quando a competencia corrente JA tem fatura emitida. */
  jaEmitida: boolean;
}

/**
 * Fatura do ArenaHub sobre a academia -- F64, ADR-052 (Fatura da plataforma).
 *
 * ---------------------------------------------------------------------------
 * A CONTAGEM E CONGELADA NA EMISSAO.
 * ---------------------------------------------------------------------------
 *
 * `emitir` conta os alunos UMA vez e grava o numero. Nada aqui recalcula
 * depois: o aluno que vira `CANCELLED` no dia 10 nao reescreve a fatura do
 * dia 1. E o aceite da fatia, e a unica forma de garanti-lo e a fatura
 * emitida nao ter caminho de volta ate a tabela de alunos -- a previa
 * consulta ao vivo, a fatura gravada nunca.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENCIA MORA NO BANCO (regra 4).
 * ---------------------------------------------------------------------------
 *
 * Rodar o job duas vezes na mesma competencia gera UMA fatura porque a chave
 * unica `(tenant_id, competence)` recusa a segunda, e nao porque um `if`
 * verificou antes. Duas instancias da API subindo o mesmo `@Cron` passam as
 * duas pela leitura antes de qualquer escrita; exclusao mutua derivada de
 * contagem e o erro que ja cobrou aluno em dobro neste sistema.
 */
@Injectable()
export class PlatformInvoiceUseCase {
  constructor(
    private readonly db: PrismaService,
    private readonly auditoria: PlatformAuditService,
    private readonly contratos: TenantContractUseCase,
    private readonly suspensao: SuspenderTenantUseCase,
  ) {}

  async listarDoTenant(tenantId: string): Promise<PlatformInvoice[]> {
    return this.db.platformInvoice.findMany({
      where: { tenantId },
      orderBy: { competence: 'desc' },
    });
  }

  async porId(id: string): Promise<PlatformInvoice> {
    const fatura = await this.db.platformInvoice.findUnique({ where: { id } });

    if (!fatura) throw new FaturaNaoEncontradaError();

    return fatura;
  }

  /**
   * O que a fatura da competencia corrente cobraria SE fosse emitida agora.
   *
   * LEITURA VIVA, e de proposito: e o unico ponto do fluxo que consulta a
   * contagem atual. O tenant precisa poder ver o numero antes da emissao --
   * e a mitigacao que o PI aceitou para o risco de a fatura ser dominada por
   * inativos (ADR-052, riscos).
   *
   * Competencia JA emitida devolve o que a fatura GRAVOU, e nao o calculo de
   * hoje: senao a previa deixaria de bater com a cobranca e o OWNER veria
   * dois numeros diferentes para o mesmo mes.
   */
  async previa(tenantId: string, agora: Date): Promise<PreviaDaFatura> {
    const contrato = await this.contratoVigente(tenantId);
    const competencia = competenciaDe(agora);

    const emitida = await this.db.platformInvoice.findUnique({
      where: { tenantId_competence: { tenantId, competence: competencia } },
    });

    if (emitida) {
      return {
        competencia: competencia.toISOString().slice(0, 7),
        emiteEm: vencimentoDaFatura(competencia, contrato.issueDay).toISOString(),
        vencimento: emitida.dueAt.toISOString(),
        model: emitida.model,
        activeCount: emitida.activeCount,
        inactiveCount: emitida.inactiveCount,
        activeStudentPriceMinor: emitida.activeStudentPriceMinor,
        inactiveStudentPriceMinor: emitida.inactiveStudentPriceMinor,
        totalMinor: emitida.totalMinor,
        currency: emitida.currency,
        jaEmitida: true,
      };
    }

    const valores = await this.valoresDoContrato(contrato, agora);
    const contagem = await this.contarAlunos(tenantId);
    const calculada = calcularFatura(valores, contagem);
    const emissao = proximaEmissao(agora, contrato.issueDay);
    const competenciaDaEmissao = competenciaDe(emissao);

    return {
      competencia: competenciaDaEmissao.toISOString().slice(0, 7),
      emiteEm: emissao.toISOString(),
      vencimento: vencimentoDaFatura(competenciaDaEmissao, contrato.issueDay).toISOString(),
      model: valores.model,
      activeCount: calculada.activeCount,
      inactiveCount: calculada.inactiveCount,
      activeStudentPriceMinor: calculada.activeStudentPriceMinor,
      inactiveStudentPriceMinor: calculada.inactiveStudentPriceMinor,
      totalMinor: calculada.totalMinor,
      currency: contrato.currency,
      jaEmitida: false,
    };
  }

  /**
   * Emite a fatura da competencia de `agora`, ou devolve a que ja existe.
   *
   * `contexto` opcional porque o JOB tambem emite, e job nao tem usuario de
   * painel -- `platform_audit_logs.actor_user_id` e anulavel exatamente para
   * isto (mesmo padrao do `EngagementRankingSchedulerService`).
   */
  async emitir(
    tenantId: string,
    agora: Date,
    contexto: PlatformContext | null,
    correlationId: string,
  ): Promise<{ fatura: PlatformInvoice; criada: boolean }> {
    const contrato = await this.contratoVigente(tenantId);
    const competencia = competenciaDe(agora);

    const valores = await this.valoresDoContrato(contrato, agora);
    const contagem = await this.contarAlunos(tenantId);
    const calculada = calcularFatura(valores, contagem);

    return this.gravar(contrato, competencia, calculada, contexto, correlationId);
  }

  /**
   * A escrita, isolada para a corrida ficar visivel.
   *
   * `create` dentro de `try`, e nao `upsert`: `upsert` na segunda execucao
   * ATUALIZARIA a fatura com a contagem de hoje -- exatamente o
   * descongelamento que esta fatia proibe. Colidir com a chave unica e o
   * comportamento certo: a fatura ja existe, devolve-se ela intacta.
   */
  private async gravar(
    contrato: TenantContract,
    competencia: Date,
    calculada: FaturaCalculada,
    contexto: PlatformContext | null,
    correlationId: string,
  ): Promise<{ fatura: PlatformInvoice; criada: boolean }> {
    try {
      const fatura = await this.db.$transaction(async (tx) => {
        const criada = await tx.platformInvoice.create({
          data: {
            tenantId: contrato.tenantId,
            contractId: contrato.id,
            competence: competencia,
            model: contrato.model,
            activeCount: calculada.activeCount,
            inactiveCount: calculada.inactiveCount,
            activeStudentPriceMinor: calculada.activeStudentPriceMinor,
            inactiveStudentPriceMinor: calculada.inactiveStudentPriceMinor,
            totalMinor: calculada.totalMinor,
            currency: contrato.currency,
            dueAt: vencimentoDaFatura(competencia, contrato.issueDay),
          },
        });

        await this.registrarAto(
          tx,
          contexto,
          {
            action: 'platform_invoice.issued',
            target: 'platform_invoice',
            targetId: criada.id,
            tenantId: contrato.tenantId,
            metadata: {
              competencia: competencia.toISOString().slice(0, 7),
              totalMinor: criada.totalMinor,
              activeCount: criada.activeCount,
              inactiveCount: criada.inactiveCount,
            },
          },
          correlationId,
        );

        return criada;
      });

      return { fatura, criada: true };
    } catch (erro: unknown) {
      if (!colidiuComFaturaExistente(erro)) throw erro;

      const existente = await this.db.platformInvoice.findUnique({
        where: {
          tenantId_competence: { tenantId: contrato.tenantId, competence: competencia },
        },
      });

      if (!existente) throw erro;

      return { fatura: existente, criada: false };
    }
  }

  /**
   * Registra o pagamento -- manual, pelo Super Admin (ADR-052).
   *
   * `updateMany` com o estado no `where`, e nao `update` por id: dois
   * registros simultaneos passam os dois pela leitura antes de qualquer
   * escrita, e o segundo sobrescreveria a data do primeiro. Mesmo padrao da
   * ativacao de contrato na F63.
   */
  /**
   * F65 -- pagar a ultima fatura vencida levanta o gate na mesma transacao
   * (regra de arquitetura no 5, ADR-053).
   *
   * `levantarGate` so e chamado se NAO sobrar fatura OVERDUE do tenant --
   * pagar uma com outra ainda vencida nao pode reabrir a catraca, senao o
   * inadimplente mantem o acesso pagando sempre a mais velha.
   */
  async registrarPagamento(
    contexto: PlatformContext,
    id: string,
    pagoEm: Date,
    correlationId: string,
  ): Promise<PlatformInvoice> {
    const fatura = await this.porId(id);

    if (fatura.status === 'PAID') throw new FaturaJaPagaError();

    await this.db.$transaction(async (tx) => {
      const alterados = await tx.platformInvoice.updateMany({
        where: { id: fatura.id, status: { in: ['OPEN', 'OVERDUE'] } },
        data: { status: 'PAID', paidAt: pagoEm },
      });

      if (alterados.count === 0) throw new FaturaJaPagaError();

      await this.auditoria.registrar(
        contexto,
        {
          action: 'platform_invoice.paid',
          target: 'platform_invoice',
          targetId: fatura.id,
          tenantId: fatura.tenantId,
          metadata: { pagoEm: pagoEm.toISOString(), totalMinor: fatura.totalMinor },
        },
        correlationId,
        tx,
      );

      const aindaVencida = await tx.platformInvoice.count({
        where: { tenantId: fatura.tenantId, status: 'OVERDUE' },
      });

      if (aindaVencida === 0) {
        await this.suspensao.levantarGate(fatura.tenantId, correlationId, tx);
      }
    });

    return this.porId(fatura.id);
  }

  /**
   * Marca `OVERDUE` toda fatura aberta cujo vencimento ja passou.
   *
   * ESCRITA e nao status derivado na leitura: a F65 (ADR-053) conta a
   * carencia a partir do vencimento, e um rotulo calculado na consulta nao
   * deixa rastro de QUANDO virou. Idempotente por construcao -- o `where`
   * exclui o que ja virou.
   */
  async marcarVencidas(agora: Date): Promise<number> {
    const { count } = await this.db.platformInvoice.updateMany({
      where: { status: 'OPEN', dueAt: { lt: agora } },
      data: { status: 'OVERDUE' },
    });

    return count;
  }

  /** Os contratos que o job precisa faturar: os vigentes. */
  async contratosVigentes(): Promise<TenantContract[]> {
    return this.db.tenantContract.findMany({ where: { status: 'ACTIVE' } });
  }

  private async contratoVigente(tenantId: string): Promise<TenantContract> {
    const contrato = await this.db.tenantContract.findFirst({
      where: { tenantId, status: 'ACTIVE' },
    });

    if (!contrato) throw new TenantSemContratoAtivoError();

    return contrato;
  }

  /**
   * Os valores que a fatura aplica.
   *
   * No modelo FIXO passa pela correcao por indice (ADR-052 §7) -- o contrato
   * guarda o valor da data-base, e o que se cobra e ele corrigido pelos
   * aniversarios ja vencidos. Sem valor de indice cadastrado a correcao NAO
   * roda e o erro sobe: faturar o valor nao corrigido cobraria a menos e
   * ninguem notaria.
   */
  private async valoresDoContrato(
    contrato: TenantContract,
    agora: Date,
  ): Promise<ValoresDoContrato> {
    if (contrato.model !== 'FIXED_MONTHLY') {
      return {
        model: contrato.model,
        activeStudentPriceMinor: contrato.activeStudentPriceMinor,
        inactiveStudentPriceMinor: contrato.inactiveStudentPriceMinor,
        fixedPriceMinor: null,
      };
    }

    const corrigido = await this.contratos.valorCorrigido(contrato.id, agora);

    return {
      model: contrato.model,
      activeStudentPriceMinor: null,
      inactiveStudentPriceMinor: null,
      fixedPriceMinor: corrigido.valorMinor,
    };
  }

  /**
   * O retrato dos alunos AGORA.
   *
   * Ativo = `ACTIVE`; inativo = TODOS os demais (`LEAD`, `TRIAL`,
   * `SUSPENDED`, `BLOCKED`, `CANCELLED`, `ARCHIVED`) -- ADR-052 §6, pendencia
   * fechada pelo PI em 08/09/2026.
   *
   * Contar por COMPLEMENTO (total menos ativos), e nao enumerando os seis: um
   * status novo cai em inativo sozinho. Enumerar deixaria o aluno fora das
   * duas contagens, e a fatura sairia a menos sem que nada falhasse.
   */
  private async contarAlunos(tenantId: string): Promise<ContagemDeAlunos> {
    // `comTenant`: `students` tem politica RLS (F66) e, fora de transacao
    // interceptada, o `set_config` nunca aplica -- sob o role restrito as
    // duas contagens voltam ZERO e a fatura do SaaS sai a MENOS, sem que
    // nada falhe (issue #306). Uma transacao so para os dois, e nao duas.
    //
    // `comContexto` EXPLICITO, e nao so o do interceptor: o
    // `PlatformInvoiceSchedulerService` emite a fatura por `@Cron`, onde nao
    // ha requisicao HTTP e o interceptor nunca roda. Pior, o job captura a
    // excecao por tenant e a transforma em log para nao derrubar os demais --
    // entao, sem este escopo, o faturamento mensal inteiro erraria para menos
    // uma vez por tenant, com o processo terminando "com sucesso".
    //
    // `system` e nao `platform`: a contagem e de UM tenant, dado no
    // argumento, e nao atravessa nenhum outro. `platform` e a excecao ao
    // isolamento, reservada a quem le entre tenants (ADR-052 SS3) -- usa-lo
    // aqui pediria mais alcance do que a operacao precisa.
    //
    // Aninhar sobre o escopo que o interceptor ja abriu na rota e inofensivo:
    // `comContexto` e `AsyncLocalStorage`, o de dentro vence enquanto dura, e
    // os dois nomeiam o mesmo tenant.
    const [total, ativos] = await comContexto({ kind: 'system', tenantId }, () =>
      this.db.comTenant((tx) =>
        Promise.all([
          tx.student.count({ where: { tenantId } }),
          tx.student.count({ where: { tenantId, status: 'ACTIVE' } }),
        ]),
      ),
    );

    return { ativos, inativos: total - ativos };
  }

  /** Auditoria dentro da transacao, com ou sem usuario de painel. */
  private async registrarAto(
    tx: Prisma.TransactionClient,
    contexto: PlatformContext | null,
    ato: Parameters<PlatformAuditService['registrar']>[1],
    correlationId: string,
  ): Promise<void> {
    // `null` significa "sem usuario agindo -- quem age e o job". Mesmo padrao
    // do `EngagementRankingSchedulerService.SEM_USUARIO`: `actor_user_id` e
    // anulavel exatamente para isto, e `registrar` aceita o nulo de verdade.
    await this.auditoria.registrar(contexto, ato, correlationId, tx);
  }
}

/**
 * A colisao com `(tenant_id, competence)` -- e SO ela.
 *
 * Prisma 7 com `adapter-pg` nao traz `meta.target` preenchido: o nome do
 * constraint vem no texto livre da mensagem. Conferir texto e feio, mas o
 * alternativo e tratar QUALQUER P2002 como "fatura ja existe" -- e engolir a
 * colisao de outra chave como se fosse idempotencia.
 */
function colidiuComFaturaExistente(erro: unknown): boolean {
  if (typeof erro !== 'object' || erro === null) return false;

  if ((erro as { code?: unknown }).code !== 'P2002') return false;

  const alvo = (erro as { meta?: { target?: unknown } }).meta?.target;
  const texto = `${JSON.stringify(alvo ?? '')} ${(erro as { message?: string }).message ?? ''}`;

  return texto.includes('tenant_id') && texto.includes('competence');
}
