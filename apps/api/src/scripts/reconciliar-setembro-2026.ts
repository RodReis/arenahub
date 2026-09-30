/**
 * Reconciliacao de setembro/2026 (Arena Positiva) -- issue #450.
 *
 *   RECONCILIAR_CATRACA_CSV=/caminho/Pessoas-26-09.csv \
 *   RECONCILIAR_PAGAMENTOS_JSON=/caminho/dados_pagamentos-26-09 \
 *   RECONCILIAR_OPERADOR_EMAIL=dono@arena.test \
 *   node dist/scripts/reconciliar-setembro-2026.js [--gravar]
 *
 * Sem `--gravar` SO LE e imprime o plano. Precisa de build antes (mesma razao
 * de `import-pagamentos-set2026.ts`: `tsx` nao emite `design:paramtypes`).
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
import { cpfEhValido } from '../modules/students/domain/identificacao.js';
import { StudentRepository, type ContatoDeEntrada } from '../modules/students/student.repository.js';
import { PrismaService } from '../persistence/prisma.service.js';
import {
  pagamentosSemPessoa,
  planejarReconciliacao,
  type AlunoDaBase,
  type Pagamento,
  type PessoaDaCatraca,
  type PlanoDaPessoa,
} from './reconciliar-setembro-2026/dominio.js';
import { executarReconciliacao, type PortasDaReconciliacao } from './reconciliar-setembro-2026/executar.js';

const TENANT_SLUG = 'arena-positiva';
const COMPETENCIA = new Date(Date.UTC(2026, 8, 1));
const MEIO_DA_COMPETENCIA = new Date(Date.UTC(2026, 8, 15));
// Mesma janela padrao do import-ativos (seed-ativos.ts): 12 meses a partir de 01/09.
const INICIO_DO_PLANO = new Date(Date.UTC(2026, 8, 1));
const FIM_DO_PLANO = new Date(Date.UTC(2027, 8, 1));
const MOTIVO = 'Reconciliacao de setembro/2026 (issue #450)';
const NOME_DO_PLANO_PADRAO = process.env['RECONCILIAR_PLANO'] ?? 'Plano Individuais - Protocolos';

function obrigatoria(nome: string): string {
  const valor = process.env[nome];
  if (!valor) throw new Error(`${nome} nao definida. Ver o cabecalho deste arquivo.`);
  return valor;
}

/** `AAAAMMDD` do Topdata; nascimento fora de 3..110 anos e lixo de digitacao. */
function nascimento(valor: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(valor.trim());
  if (!m) return null;
  const data = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (data.getUTCDate() !== Number(m[3])) return null;
  const anos = (COMPETENCIA.getTime() - data.getTime()) / (365.25 * 86_400_000);
  return anos >= 3 && anos <= 110 ? data : null;
}

/** `;` sem aspas -- conferido no arquivo real. Contagem de campos e a defesa. */
async function lerCatraca(caminho: string): Promise<PessoaDaCatraca[]> {
  const bruto = await readFile(caminho, 'utf8');
  const semBom = bruto.charCodeAt(0) === 0xfeff ? bruto.slice(1) : bruto;
  const linhas = semBom.split(/\r?\n/).filter((l) => l.trim());
  const cabecalho = linhas.shift()!.split(';').map((c) => c.trim());

  return linhas.map((linha, i) => {
    const campos = linha.split(';');
    if (campos.length !== cabecalho.length) {
      throw new Error(`Linha ${String(i + 2)} tem ${String(campos.length)} campos; cabecalho tem ${String(cabecalho.length)}.`);
    }
    const c = Object.fromEntries(cabecalho.map((nome, j) => [nome, campos[j]!.trim()]));
    return {
      nome: c['Nome']!,
      cpf: c['Cpf']!,
      permissao: c['Permissoes de Acesso']!,
      nascimento: nascimento(c['Data Nascimento']!),
      telefone: c['Celular'] || c['Telefone'] || '',
      email: c['Email']!,
    };
  });
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

function contatos(pessoa: PessoaDaCatraca): ContatoDeEntrada[] {
  const lista: ContatoDeEntrada[] = [];
  const fone = pessoa.telefone.replace(/\D/g, '');
  if (fone.length >= 10) lista.push({ type: 'WHATSAPP', value: fone, isPrimary: true });
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pessoa.email)) {
    lista.push({ type: 'EMAIL', value: pessoa.email.toLowerCase(), isPrimary: lista.length === 0 });
  }
  return lista;
}

function imprimir(planos: PlanoDaPessoa[], orfaos: Pagamento[]): void {
  const contar = (tipo: string) => planos.filter((p) => p.acoes.some((a) => a.tipo === tipo)).length;

  console.info(`\n[reconciliar] alunos na catraca        : ${String(planos.length)}`);
  console.info(`[reconciliar]   pagaram               : ${String(planos.filter((p) => p.pagou).length)}`);
  console.info(`[reconciliar] criar aluno             : ${String(contar('CRIAR_ALUNO'))}`);
  console.info(`[reconciliar] reativar aluno          : ${String(contar('REATIVAR_ALUNO'))}`);
  console.info(`[reconciliar] ativar assinatura       : ${String(contar('ATIVAR_ASSINATURA'))}`);
  console.info(`[reconciliar] cancelar orfa           : ${String(contar('CANCELAR_ORFA'))}`);
  console.info(`[reconciliar] abrir fatura set/2026   : ${String(contar('ABRIR_FATURA'))}`);
  console.info(`[reconciliar] dar baixa               : ${String(contar('DAR_BAIXA'))}`);
  console.info(`[reconciliar] ja corretos             : ${String(planos.filter((p) => !p.pendencia && p.acoes.length === 0).length)}`);

  const pendencias = planos.filter((p) => p.pendencia);
  console.info(`\n[reconciliar] PENDENCIAS (nao tocadas): ${String(pendencias.length)}`);
  console.table(pendencias.map((p) => ({ nome: p.pessoa.nome, motivo: p.pendencia, pagou: p.pagou })));

  console.info(`\n[reconciliar] pagamentos sem pessoa na catraca: ${String(orfaos.length)}`);
  if (orfaos.length > 0) console.table(orfaos);
}

async function principal(): Promise<void> {
  const gravar = process.argv.includes('--gravar');
  const pessoas = await lerCatraca(obrigatoria('RECONCILIAR_CATRACA_CSV'));
  const pagamentos = await lerPagamentos(obrigatoria('RECONCILIAR_PAGAMENTOS_JSON'));
  const email = obrigatoria('RECONCILIAR_OPERADOR_EMAIL');
  console.info(`[reconciliar] ${String(pessoas.length)} pessoas na catraca, ${String(pagamentos.length)} pagamentos`);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const db = app.get(PrismaService);
    const alunosRepo = app.get(StudentRepository);
    const membership = app.get(MembershipRepository);
    const billing = app.get(BillingRepository);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: TENANT_SLUG } });

    await comContexto({ kind: 'system', tenantId: tenant.id }, async () => {
      const brutos = await db.comTenant((tx) =>
        tx.student.findMany({
          where: { tenantId: tenant.id },
          select: {
            id: true,
            fullName: true,
            cpf: true,
            status: true,
            profile: true,
            subscriptions: {
              orderBy: { startsAt: 'desc' },
              select: {
                id: true,
                status: true,
                version: true,
                planId: true,
                entitlements: { where: { status: 'ACTIVE' }, select: { id: true } },
              },
            },
            invoices: { where: { billingPeriod: COMPETENCIA }, select: { id: true, status: true, totalMinor: true } },
          },
        }),
      );

      const alunos: AlunoDaBase[] = brutos.map((a) => ({
        id: a.id,
        nome: a.fullName,
        cpf: a.cpf,
        status: a.status,
        profile: a.profile,
        assinaturaAtivaId: a.subscriptions.find((s) => s.status === 'ACTIVE')?.id ?? null,
        planoId: a.subscriptions[0]?.planId ?? null,
        orfas: a.subscriptions
          .filter((s) => s.status !== 'ACTIVE' && s.entitlements.length > 0)
          .map((s) => ({ id: s.id, versao: s.version })),
        faturaSet: a.invoices.find((i) => i.status === 'PAID') ?? a.invoices[0] ?? null,
      }));

      const planos = planejarReconciliacao(pessoas, pagamentos, alunos);
      imprimir(planos, pagamentosSemPessoa(pessoas, pagamentos));

      if (!gravar) {
        console.info('\n[reconciliar] dry-run -- nada foi gravado. Rode com --gravar para aplicar.');
        return;
      }

      const operador = await db.user.findUniqueOrThrow({ where: { email } });
      const unidade = await db.gymUnit.findFirstOrThrow({ where: { tenantId: tenant.id, status: 'ACTIVE' } });
      const planoPadrao = await db.comTenant((tx) =>
        tx.plan.findFirstOrThrow({ where: { tenantId: tenant.id, name: NOME_DO_PLANO_PADRAO } }),
      );
      const contexto = {
        tenantId: tenant.id,
        actorId: operador.id,
        sessionId: randomUUID(),
        permissions: new Set<string>(),
        allowedUnitIds: 'ALL' as const,
      };
      const agora = new Date();

      const portas: PortasDaReconciliacao = {
        criarAluno: async (p) => {
          const aluno = await alunosRepo.criar(
            contexto,
            {
              fullName: p.nome.trim(),
              birthDate: p.nascimento!,
              gymUnitId: unidade.id,
              cpf: cpfEhValido(p.cpf) ? p.cpf.replace(/\D/g, '') : undefined,
              status: 'ACTIVE',
              contacts: contatos(p),
            },
            randomUUID(),
            2026,
          );
          return aluno.id;
        },
        reativarAluno: async (id) => {
          const aluno = await alunosRepo.encontrar(contexto, id);
          const feito = await alunosRepo.alterarStatus(contexto, id, aluno!.version, 'ACTIVE', randomUUID(), agora, {
            reason: null,
            reasonNote: null,
          });
          if (!feito) throw new Error('aluno alterado por outro caminho durante a reconciliacao');
        },
        ativarAssinatura: async (studentId, planoId) => {
          await membership.ativarAssinatura(
            contexto,
            { studentId, planId: planoId ?? planoPadrao.id, startsAt: INICIO_DO_PLANO, endsAt: FIM_DO_PLANO, reason: MOTIVO },
            randomUUID(),
          );
        },
        cancelarAssinatura: async (id, versao) => {
          const feito = await membership.alterarAssinatura(contexto, id, versao, 'CANCEL', MOTIVO, randomUUID(), agora);
          if (!feito) throw new Error(`assinatura ${id} mudou desde o planejamento`);
        },
        abrirFatura: async (studentId) => {
          const ativa = await db.comTenant((tx) =>
            tx.subscription.findFirstOrThrow({ where: { tenantId: tenant.id, studentId, status: 'ACTIVE' } }),
          );
          const fatura = await billing.abrirInvoiceDoPeriodo(contexto, { subscriptionId: ativa.id, emQue: MEIO_DA_COMPETENCIA });
          return { id: fatura.id, totalMinor: fatura.totalMinor };
        },
        darBaixa: async (faturaId, valorMinor, pagoEm) => {
          await billing.registrarPagamentoManual(
            contexto,
            // Relatorio de origem nao distingue canal -- mesmo rotulo da #386.
            { invoiceId: faturaId, amountMinor: valorMinor, reason: MOTIVO, paidAt: pagoEm, receivedVia: 'DINHEIRO' },
            randomUUID(),
          );
        },
      };

      const resultado = await executarReconciliacao(planos, portas);
      console.info(`\n[reconciliar] aplicados: ${String(resultado.aplicados)}`);
      console.info(`[reconciliar] falhas   : ${String(resultado.falhas.length)}`);
      if (resultado.falhas.length > 0) console.table(resultado.falhas);
    });
  } finally {
    await app.close();
  }
}

try {
  await principal();
} catch (erro: unknown) {
  console.error('[reconciliar] falhou:', erro);
  process.exitCode = 1;
}
