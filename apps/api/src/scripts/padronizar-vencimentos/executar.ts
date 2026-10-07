import { comContexto } from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { BillingRepository } from '../../modules/billing/billing.repository.js';
import { assinaturasElegiveisParaFaturaMensal } from '../../modules/billing/gerar-faturas-do-mes.use-case.js';
import type { PrismaService } from '../../persistence/prisma.service.js';
import { coberturasDosPagos, planejarFaturaAberta, type FaturaPaga } from './dominio.js';

/** O saneamento assume o ciclo da Arena Positiva (SPEC-088): para se o tenant for outro. */
const DIA_DO_VENCIMENTO = 10;
const CARENCIA = 5;
const COMPETENCIA_OUT = new Date(Date.UTC(2026, 9, 1));
/** Meio de outubro: a competencia sai 2026-10 e o vencimento 10/10/2026. */
const EM_QUE_OUT = new Date('2026-10-15T12:00:00Z');
const ABERTAS: ('OPEN' | 'OVERDUE')[] = ['OPEN', 'OVERDUE'];

export interface PortasDoSaneamento {
  readonly db: PrismaService;
  readonly billing: BillingRepository;
}

export interface OpcoesDoSaneamento {
  readonly slug: string;
  readonly gravar: boolean;
  readonly agora: Date;
  readonly escrever?: (linha: string) => void;
}

/** Contadores de MUDANCA (com `--gravar` o que foi aplicado; sem, o que seria) + o relatorio. */
export interface ResultadoDoSaneamento {
  readonly carenciaAjustada: number;
  readonly faturasRedatadas: number;
  readonly overdueParaOpen: number;
  readonly assinaturasReativadas: number;
  readonly outubroCriadas: number;
  readonly coberturasPreenchidas: number;
  readonly falhas: number;
  readonly pagasSemData: number;
  /** Matriculas (nunca nome/CPF). */
  readonly semAssinaturaVigente: readonly string[];
  readonly seriamBloqueados: readonly string[];
}

function jaBloqueia(blockAt: Date | null, agora: Date): boolean {
  return blockAt !== null && blockAt.getTime() <= agora.getTime();
}

export async function executarSaneamento(
  { db, billing }: PortasDoSaneamento,
  { slug, gravar, agora, escrever = console.info }: OpcoesDoSaneamento,
): Promise<ResultadoDoSaneamento> {
  const linha = (rotulo: string, valor: number | string): void =>
    escrever(`[padronizar] ${rotulo.padEnd(36)}: ${String(valor)}`);

  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug } });
  const tenantId = tenant.id;

  return comContexto({ kind: 'tenant', tenantId }, async () => {
    const config = await db.billingSettings.findUniqueOrThrow({ where: { tenantId } });

    if (config.dueDay !== DIA_DO_VENCIMENTO) {
      throw new Error(
        `dueDay do tenant e ${String(config.dueDay)}, e o saneamento assume ${String(DIA_DO_VENCIMENTO)}. Nada foi feito.`,
      );
    }

    escrever(`[padronizar] ${gravar ? 'GRAVANDO' : 'dry-run (nada sera gravado)'} -- tenant ${slug}`);
    let falhas = 0;

    // 1. Carencia ------------------------------------------------------------
    let carenciaAjustada = 0;

    if (config.graceDays !== CARENCIA) {
      linha('graceDays', `${String(config.graceDays)} -> ${String(CARENCIA)}`);
      if (gravar) {
        const r = await db.billingSettings.updateMany({
          where: { tenantId, graceDays: config.graceDays },
          data: { graceDays: CARENCIA },
        });
        carenciaAjustada = r.count;
      } else {
        carenciaAjustada = 1;
      }
    }

    // 2. Faturas abertas -------------------------------------------------------
    // Diaria nao e contrato: `dueAt`/`blockAt` dela sao explicitos (F86).
    // `comTenant`: o `select` traz `student`, que tem RLS (issue #306).
    const abertas = await db.comTenant((tx) =>
      tx.invoice.findMany({
        where: {
          tenantId,
          status: { in: ABERTAS },
          subscription: { plan: { billingMode: { not: 'DIARIA' } } },
        },
        select: {
          id: true,
          billingPeriod: true,
          status: true,
          dueAt: true,
          blockAt: true,
          subscriptionId: true,
          subscription: { select: { status: true } },
          student: { select: { membershipNumber: true, profile: true, gymUnit: { select: { timezone: true } } } },
        },
        orderBy: { id: 'asc' },
      }),
    );

    const planejadas = abertas.map((f) => ({
      f,
      plano: planejarFaturaAberta(
        { billingPeriod: f.billingPeriod, status: f.status as 'OPEN' | 'OVERDUE', dueAt: f.dueAt, blockAt: f.blockAt },
        { dueDay: DIA_DO_VENCIMENTO, graceDays: CARENCIA, fuso: f.student.gymUnit.timezone },
        agora,
      ),
    }));

    const aMudar = planejadas.flatMap(({ f, plano }) => (plano ? [{ f, plano }] : []));
    const virariaOpen = ({ f, plano }: (typeof aMudar)[number]): boolean =>
      f.status === 'OVERDUE' && plano.status === 'OPEN';
    let faturasRedatadas = aMudar.length;
    let overdueParaOpen = aMudar.filter(virariaOpen).length;

    if (gravar) {
      faturasRedatadas = 0;
      overdueParaOpen = 0;

      for (const item of aMudar) {
        const { f, plano } = item;
        // Condicionado ao estado lido: pagamento que entrou no meio nao e sobrescrito.
        const r = await db.invoice.updateMany({
          where: { id: f.id, status: f.status },
          data: { dueAt: plano.dueAt, blockAt: plano.blockAt, status: plano.status, version: { increment: 1 } },
        });

        if (r.count === 0) {
          falhas += 1;
          escrever(`[padronizar] fatura ${f.id} mudou durante a execucao -- pulada`);
          continue;
        }

        faturasRedatadas += 1;
        if (virariaOpen(item)) overdueParaOpen += 1;
      }
    }

    linha('faturas abertas re-datadas', faturasRedatadas);
    linha('  das quais OVERDUE -> OPEN', overdueParaOpen);

    // 3. Reativar --------------------------------------------------------------
    // Estado, nao evento: assinatura PAST_DUE que, com as datas novas, nao tem
    // mais fatura vencida alem da carencia. Idempotente, e refaz o que uma
    // execucao interrompida entre 2 e 3 deixou.
    const bloqueadas = new Set(
      planejadas.filter(({ f, plano }) => jaBloqueia(plano?.blockAt ?? f.blockAt, agora)).map(({ f }) => f.subscriptionId),
    );
    const aReativar = [
      ...new Set(
        planejadas
          .filter(({ f }) => f.subscription.status === 'PAST_DUE' && !bloqueadas.has(f.subscriptionId))
          .map(({ f }) => f.subscriptionId),
      ),
    ];
    let assinaturasReativadas = gravar ? 0 : aReativar.length;

    if (gravar) {
      for (const subscriptionId of aReativar) {
        const feito = await db.$transaction(async (tx) => {
          const [ainda, vencidas] = await Promise.all([
            tx.subscription.count({ where: { id: subscriptionId, tenantId, status: 'PAST_DUE' } }),
            tx.invoice.count({
              where: { tenantId, subscriptionId, status: { in: ABERTAS }, blockAt: { lte: agora } },
            }),
          ]);

          if (ainda === 0 || vencidas > 0) return false;

          await billing.ativarDireitoDeAcessoSePendente(tx, { tenantId, subscriptionId });
          return true;
        });

        if (feito) assinaturasReativadas += 1;
      }
    }

    linha('assinaturas reativadas', assinaturasReativadas);

    // 4. Out/26 faltante --------------------------------------------------------
    // Mesma elegibilidade do job mensal (`assinaturasElegiveisParaFaturaMensal`).
    const elegiveis = await db.comTenant((tx) =>
      tx.subscription.findMany({
        where: assinaturasElegiveisParaFaturaMensal(tenantId),
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
    );
    const comOutubro = new Set(
      (
        await db.invoice.findMany({
          where: { tenantId, billingPeriod: COMPETENCIA_OUT, subscriptionId: { in: elegiveis.map((e) => e.id) } },
          select: { subscriptionId: true },
        })
      ).map((i) => i.subscriptionId),
    );
    const semOutubro = elegiveis.filter((e) => !comOutubro.has(e.id));
    let outubroCriadas = gravar ? 0 : semOutubro.length;

    if (gravar) {
      const contexto: TenantContext = {
        tenantId,
        actorId: 'sistema:padronizar-vencimentos',
        sessionId: 'padronizar-vencimentos',
        permissions: new Set<string>(),
        allowedUnitIds: 'ALL',
      };

      for (const { id } of semOutubro) {
        try {
          await billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: id, emQue: EM_QUE_OUT });
          outubroCriadas += 1;
        } catch (erro: unknown) {
          falhas += 1;
          escrever(
            `[padronizar] falha ao abrir out/26 da assinatura ${id}: ${erro instanceof Error ? erro.message : 'erro desconhecido'}`,
          );
        }
      }
    }

    linha('faturas de out/26 criadas', outubroCriadas);

    // 5. Cobertura das pagas -----------------------------------------------------
    const cobertura = await preencherCoberturas(db, tenantId, gravar);
    falhas += cobertura.falhas;
    linha('coberturas preenchidas', cobertura.preenchidas);
    linha('pagas sem data de pagamento', cobertura.semData);

    // 6. Relatorio (so matriculas) -------------------------------------------------
    const semAssinaturaVigente = (
      await db.comTenant((tx) =>
        tx.student.findMany({
          where: {
            tenantId,
            profile: 'STUDENT',
            status: 'ACTIVE',
            subscriptions: { none: { status: { in: ['ACTIVE', 'PAST_DUE'] } } },
          },
          select: { membershipNumber: true },
          orderBy: { membershipNumber: 'asc' },
        }),
      )
    ).map((s) => s.membershipNumber);

    const seriamBloqueados = [
      ...new Set(
        planejadas
          .filter(({ f, plano }) => f.student.profile === 'STUDENT' && jaBloqueia(plano?.blockAt ?? f.blockAt, agora))
          .map(({ f }) => f.student.membershipNumber),
      ),
    ].sort();

    linha('STUDENT ativo sem assinatura vigente', semAssinaturaVigente.length);
    if (semAssinaturaVigente.length > 0) escrever(`[padronizar]   matriculas: ${semAssinaturaVigente.join(', ')}`);
    linha('seriam bloqueados no 1o job', seriamBloqueados.length);
    if (seriamBloqueados.length > 0) escrever(`[padronizar]   matriculas: ${seriamBloqueados.join(', ')}`);
    linha('falhas', falhas);

    if (!gravar) escrever('[padronizar] dry-run -- nada foi gravado. Rode com --gravar para aplicar.');

    return {
      carenciaAjustada,
      faturasRedatadas,
      overdueParaOpen,
      assinaturasReativadas,
      outubroCriadas,
      coberturasPreenchidas: cobertura.preenchidas,
      falhas,
      pagasSemData: cobertura.semData,
      semAssinaturaVigente,
      seriamBloqueados,
    };
  });
}

/**
 * A posicao de cada mes depende do LOTE inteiro, inclusive de quem ja tem
 * cobertura (ou teve o pagamento cancelado depois): le todos os pagamentos
 * dos lotes afetados e so grava nas faturas PAID ainda sem `coverageEndsAt`.
 */
async function preencherCoberturas(
  db: PrismaService,
  tenantId: string,
  gravar: boolean,
): Promise<{ preenchidas: number; semData: number; falhas: number }> {
  const alvo = await db.invoice.findMany({
    where: { tenantId, status: 'PAID', coverageEndsAt: null },
    select: {
      id: true,
      billingPeriod: true,
      paidAt: true,
      payments: {
        where: { status: 'CONFIRMED' },
        orderBy: { createdAt: 'asc' },
        take: 1,
        select: { paidAt: true, batchId: true },
      },
    },
    orderBy: { id: 'asc' },
  });

  const lotes = [
    ...new Set(alvo.flatMap((i) => i.payments.map((p) => p.batchId)).filter((b): b is string => b !== null)),
  ];
  const doLote =
    lotes.length === 0
      ? []
      : await db.payment.findMany({
          where: { tenantId, batchId: { in: lotes }, status: { in: ['CONFIRMED', 'CANCELLED'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            invoiceId: true,
            batchId: true,
            paidAt: true,
            status: true,
            invoice: { select: { billingPeriod: true, paidAt: true } },
          },
        });

  const pagas = new Map<string, FaturaPaga>();
  let semData = 0;

  // Lote: um registro por fatura -- o primeiro CONFIRMED, senao o primeiro CANCELLED
  // (a fatura cancelada ainda ocupou posicao quando o lote foi pago).
  const confirmadosPrimeiro = [...doLote].sort(
    (a, b) => Number(b.status === 'CONFIRMED') - Number(a.status === 'CONFIRMED'),
  );

  for (const p of confirmadosPrimeiro) {
    const paidAt = p.paidAt ?? p.invoice.paidAt;
    if (!paidAt || pagas.has(p.invoiceId)) continue;
    pagas.set(p.invoiceId, { invoiceId: p.invoiceId, billingPeriod: p.invoice.billingPeriod, paidAt, batchId: p.batchId });
  }

  for (const i of alvo) {
    if (pagas.has(i.id)) continue;
    const paidAt = i.payments[0]?.paidAt ?? i.paidAt;

    if (!paidAt) {
      semData += 1;
      continue;
    }

    pagas.set(i.id, { invoiceId: i.id, billingPeriod: i.billingPeriod, paidAt, batchId: i.payments[0]?.batchId ?? null });
  }

  const coberturas = coberturasDosPagos([...pagas.values()]);
  const aPreencher = alvo.filter((i) => coberturas.has(i.id));
  if (!gravar) return { preenchidas: aPreencher.length, semData, falhas: 0 };

  let preenchidas = 0;
  let falhas = 0;

  for (const i of aPreencher) {
    const r = await db.invoice.updateMany({
      where: { id: i.id, status: 'PAID', coverageEndsAt: null },
      data: { coverageEndsAt: coberturas.get(i.id)! },
    });

    if (r.count === 1) preenchidas += 1;
    else falhas += 1;
  }

  return { preenchidas, semData, falhas };
}
