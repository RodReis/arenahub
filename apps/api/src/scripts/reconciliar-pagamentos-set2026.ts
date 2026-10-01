/**
 * Reconciliacao dos pagamentos de setembro/2026 (relatorio de 01 a 30/09).
 *
 *   RECONCILIAR_PESSOAS_CSV=/caminho/Pessoas-0110.csv \
 *   RECONCILIAR_PAGAMENTOS_JSON=/caminho/pagamentos-0109-3009.json \
 *   RECONCILIAR_OPERADOR_EMAIL=dono@arena.test \
 *   node dist/scripts/reconciliar-pagamentos-set2026.js [--gravar]
 *
 * Sem `--gravar` SO LE e imprime o plano. Precisa de build antes (mesma razao
 * de `reconciliar-setembro-2026.ts`: `tsx` nao emite `design:paramtypes`).
 * O JSON tem a forma `{ "pagamentos": [{ "nome", "data": "dd/mm/aaaa", "valor": 150 }] }`.
 *
 * Os arquivos sao DADO REAL DE ALUNO e nunca entram no repositorio.
 */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: join(process.cwd(), '../../.env') });

import { NestFactory } from '@nestjs/core';
import { comContexto } from '@arenahub/database';

import { AppModule } from '../app.module.js';
import { BillingRepository } from '../modules/billing/billing.repository.js';
import { MembershipRepository } from '../modules/membership/membership.repository.js';
import { PrismaService } from '../persistence/prisma.service.js';
import { normalizarNome } from './import-pagamentos-set2026/dominio.js';
import {
  planejarPagamentos,
  type Acao,
  type CpfsPorNome,
  type Pagamento,
  type PlanoDoPagamento,
  type PlanoPorValor,
} from './reconciliar-pagamentos-set2026/dominio.js';

const TENANT_SLUG = 'arena-positiva';
const COMPETENCIA = new Date(Date.UTC(2026, 8, 1));
const MEIO_DA_COMPETENCIA = new Date(Date.UTC(2026, 8, 15));
const MOTIVO = 'Reconciliacao dos pagamentos de setembro/2026 (relatorio de 01 a 30/09)';

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} nao definida. Ver o cabecalho deste arquivo.`);
  return valor;
}

/** So nome e CPF da catraca: e a ponte entre o relatorio (sem CPF) e a base. */
async function lerCpfsPorNome(caminho: string): Promise<CpfsPorNome> {
  const bruto = await readFile(caminho, 'utf8');
  const linhas = (bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto).split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas.shift()!.split(';').map((c) => c.trim());
  const iNome = cabecalho.indexOf('Nome');
  const iCpf = cabecalho.indexOf('Cpf');
  if (iNome < 0 || iCpf < 0) throw new Error('CSV da catraca sem as colunas Nome e Cpf.');

  const mapa = new Map<string, string[]>();
  for (const linha of linhas) {
    const campos = linha.split(';');
    if (campos.length !== cabecalho.length) throw new Error('Linha do CSV com numero de campos diferente do cabecalho.');
    const chave = normalizarNome(campos[iNome]!);
    mapa.set(chave, [...(mapa.get(chave) ?? []), campos[iCpf]!.trim()]);
  }
  return mapa;
}

async function lerPagamentos(caminho: string): Promise<Pagamento[]> {
  const bruto = JSON.parse(await readFile(caminho, 'utf8')) as { pagamentos?: unknown };
  if (!Array.isArray(bruto.pagamentos)) throw new Error('Arquivo de pagamentos sem a lista "pagamentos".');
  return bruto.pagamentos.map((p: { nome: string; data: string; valor: number }) => ({
    nome: String(p.nome),
    data: String(p.data),
    valor: Number(p.valor),
  }));
}

function imprimir(planos: PlanoDoPagamento[]): void {
  const contar = (tipo: Acao['tipo']) => planos.filter((p) => p.acoes.some((a) => a.tipo === tipo)).length;

  console.info(`\n[pagamentos-set] linhas do relatorio  : ${String(planos.length)}`);
  console.info(`[pagamentos-set] trocar plano         : ${String(contar('TROCAR_PLANO'))}`);
  console.info(`[pagamentos-set] corrigir valor       : ${String(contar('CORRIGIR_VALOR'))}`);
  console.info(`[pagamentos-set] abrir fatura set/2026: ${String(contar('ABRIR_FATURA'))}`);
  console.info(`[pagamentos-set] dar baixa            : ${String(contar('DAR_BAIXA'))}`);
  console.info(`[pagamentos-set] ja corretos          : ${String(planos.filter((p) => !p.pendencia && p.acoes.length === 0).length)}`);

  const pendencias = planos.filter((p) => p.pendencia);
  console.info(`\n[pagamentos-set] PENDENCIAS (nao tocadas): ${String(pendencias.length)}`);
  console.table(pendencias.map((p) => ({ nome: p.pagamento.nome, valor: p.pagamento.valor, motivo: p.pendencia })));
}

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');
  const cpfsPorNome = await lerCpfsPorNome(obrigatoria('RECONCILIAR_PESSOAS_CSV'));
  const pagamentos = await lerPagamentos(obrigatoria('RECONCILIAR_PAGAMENTOS_JSON'));
  const email = obrigatoria('RECONCILIAR_OPERADOR_EMAIL');
  console.info(`[pagamentos-set] ${String(pagamentos.length)} pagamentos no relatorio`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const db = app.get(PrismaService);
    const membership = app.get(MembershipRepository);
    const billing = app.get(BillingRepository);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

    await comContexto({ kind: 'system', tenantId: tenant.id }, async () => {
      const planosDb = await db.comTenant((tx) =>
        tx.plan.findMany({ where: { tenantId: tenant.id, isActive: true }, include: { prices: true } }),
      );
      const planosPorValor = new Map<number, PlanoPorValor>();
      for (const plano of planosDb) {
        const preco = plano.prices
          .filter((p) => p.validFrom.getTime() <= COMPETENCIA.getTime())
          .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0];
        if (!preco) continue;
        if (planosPorValor.has(preco.amountMinor)) throw new Error(`Dois planos com o mesmo preco ${String(preco.amountMinor)}.`);
        planosPorValor.set(preco.amountMinor, { id: plano.id, nome: plano.name });
      }
      console.info('[pagamentos-set] plano por valor:', [...planosPorValor].map(([v, p]) => `${String(v / 100)} -> ${p.nome}`));

      const brutos = await db.comTenant((tx) =>
        tx.student.findMany({
          where: { tenantId: tenant.id },
          select: {
            id: true,
            fullName: true,
            cpf: true,
            status: true,
            profile: true,
            subscriptions: { where: { status: 'ACTIVE' }, orderBy: { startsAt: 'desc' }, select: { id: true, planId: true } },
            invoices: { where: { billingPeriod: COMPETENCIA }, select: { id: true, status: true, totalMinor: true } },
          },
        }),
      );

      const alunos = brutos.map((a) => ({
        id: a.id,
        nome: a.fullName,
        cpf: a.cpf,
        status: a.status,
        profile: a.profile,
        assinaturaAtivaId: a.subscriptions[0]?.id ?? null,
        planoId: a.subscriptions[0]?.planId ?? null,
        faturaSet: a.invoices.find((i) => i.status === 'PAID') ?? a.invoices[0] ?? null,
      }));

      const planos = planejarPagamentos(pagamentos, cpfsPorNome, alunos, planosPorValor);
      imprimir(planos);

      if (!gravar) {
        console.info('\n[pagamentos-set] dry-run -- nada foi gravado. Rode com --gravar para aplicar.');
        return;
      }

      const operador = await db.user.findUniqueOrThrow({ where: { email } });
      const contexto = {
        tenantId: tenant.id,
        actorId: operador.id,
        sessionId: randomUUID(),
        permissions: new Set<string>(),
        allowedUnitIds: 'ALL' as const,
      };

      const ativa = (studentId: string) =>
        db.comTenant((tx) =>
          tx.subscription.findFirstOrThrow({ where: { tenantId: tenant.id, studentId, status: 'ACTIVE' }, select: { id: true, version: true } }),
        );

      let aplicados = 0;
      const falhas: { nome: string; erro: string }[] = [];

      for (const plano of planos) {
        if (plano.pendencia || plano.acoes.length === 0) continue;

        try {
          let fatura: { id: string; totalMinor: number } | null = null;

          for (const acao of plano.acoes) {
            const studentId = plano.studentId!;

            if (acao.tipo === 'TROCAR_PLANO') {
              const atual = await ativa(studentId);
              const feito = await membership.trocarPlanoDaAssinatura(
                contexto,
                atual.id,
                { planId: acao.planoId, versaoEsperada: atual.version, reason: MOTIVO },
                randomUUID(),
                new Date(),
              );
              if (!feito) throw new Error('assinatura mudou durante a reconciliacao');
            } else if (acao.tipo === 'CORRIGIR_VALOR') {
              const corrigida = await billing.corrigirValorDaInvoice(
                contexto,
                { invoiceId: acao.faturaId, novoValorUnitarioMinor: acao.valorMinor, reason: MOTIVO },
                randomUUID(),
              );
              fatura = { id: corrigida.id, totalMinor: corrigida.totalMinor };
            } else if (acao.tipo === 'ABRIR_FATURA') {
              const aberta = await billing.abrirInvoiceDoPeriodo(contexto, {
                subscriptionId: (await ativa(studentId)).id,
                emQue: MEIO_DA_COMPETENCIA,
              });
              fatura = { id: aberta.id, totalMinor: aberta.totalMinor };
            } else {
              const alvo = fatura ?? (acao.faturaId ? { id: acao.faturaId, totalMinor: acao.valorMinor } : null);
              if (!alvo) throw new Error('sem fatura de set/2026 para dar baixa');
              if (alvo.totalMinor !== acao.valorMinor) {
                throw new Error(`VALOR_DIVERGENTE: pago ${String(acao.valorMinor)}, fatura ${String(alvo.totalMinor)}`);
              }
              await billing.registrarPagamentoManual(
                contexto,
                { invoiceId: alvo.id, amountMinor: acao.valorMinor, reason: MOTIVO, paidAt: acao.pagoEm, receivedVia: 'DINHEIRO' },
                randomUUID(),
              );
            }
          }

          aplicados += 1;
        } catch (erro: unknown) {
          falhas.push({ nome: plano.pagamento.nome, erro: erro instanceof Error ? erro.message : String(erro) });
        }
      }

      console.info(`\n[pagamentos-set] aplicados: ${String(aplicados)}`);
      console.info(`[pagamentos-set] falhas   : ${String(falhas.length)}`);
      if (falhas.length > 0) console.table(falhas);
    });
  } finally {
    await app.close();
  }
}

try {
  await principal();
} catch (erro: unknown) {
  console.error('[pagamentos-set] falhou:', erro);
  process.exitCode = 1;
}
