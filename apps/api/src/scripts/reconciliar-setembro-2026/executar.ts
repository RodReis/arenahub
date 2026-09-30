/**
 * Aplica os planos de `dominio.ts` -- issue #450.
 *
 * As portas sao os casos de uso de sempre (`criar`, `alterarStatus`,
 * `ativarAssinatura`, `alterarAssinatura`, `abrirInvoiceDoPeriodo`,
 * `registrarPagamentoManual`), injetados pelo CLI. Nenhuma escrita direta:
 * outbox, auditoria e idempotencia vem de graca.
 *
 * Reexecutar e seguro: o plano e recalculado do banco a cada rodada, e o que
 * ja foi feito deixa de aparecer como acao.
 */
import type { PessoaDaCatraca, PlanoDaPessoa } from './dominio.js';

export interface FaturaAberta {
  id: string;
  totalMinor: number;
}

export interface PortasDaReconciliacao {
  criarAluno(pessoa: PessoaDaCatraca): Promise<string>;
  reativarAluno(studentId: string): Promise<void>;
  ativarAssinatura(studentId: string, planoId: string | null): Promise<void>;
  cancelarAssinatura(assinaturaId: string, versao: number): Promise<void>;
  abrirFatura(studentId: string): Promise<FaturaAberta>;
  darBaixa(faturaId: string, valorMinor: number, pagoEm: Date): Promise<void>;
}

export interface ResultadoDaExecucao {
  aplicados: number;
  falhas: { nome: string; erro: string }[];
}

async function aplicar(plano: PlanoDaPessoa, portas: PortasDaReconciliacao): Promise<void> {
  let studentId = plano.studentId;
  let fatura: FaturaAberta | null = null;

  for (const acao of plano.acoes) {
    switch (acao.tipo) {
      case 'CRIAR_ALUNO':
        studentId = await portas.criarAluno(plano.pessoa);
        break;
      case 'REATIVAR_ALUNO':
        await portas.reativarAluno(studentId!);
        break;
      case 'ATIVAR_ASSINATURA':
        await portas.ativarAssinatura(studentId!, acao.planoId);
        break;
      case 'CANCELAR_ORFA':
        await portas.cancelarAssinatura(acao.assinaturaId, acao.versao);
        break;
      case 'ABRIR_FATURA':
        fatura = await portas.abrirFatura(studentId!);
        break;
      case 'DAR_BAIXA': {
        const alvo = fatura ?? (acao.faturaId ? { id: acao.faturaId, totalMinor: acao.totalMinor! } : null);
        if (!alvo) throw new Error('sem fatura de set/2026 para dar baixa');
        // Decisao do PI (23/09, #386): so grava valor pago == valor da fatura.
        if (alvo.totalMinor !== acao.valorMinor) {
          throw new Error(`VALOR_DIVERGENTE: pago ${String(acao.valorMinor)}, fatura ${String(alvo.totalMinor)}`);
        }
        await portas.darBaixa(alvo.id, acao.valorMinor, acao.pagoEm);
        break;
      }
    }
  }
}

export async function executarReconciliacao(
  planos: readonly PlanoDaPessoa[],
  portas: PortasDaReconciliacao,
): Promise<ResultadoDaExecucao> {
  const falhas: ResultadoDaExecucao['falhas'] = [];
  let aplicados = 0;

  for (const plano of planos) {
    if (plano.pendencia || plano.acoes.length === 0) continue;

    try {
      await aplicar(plano, portas);
      aplicados += 1;
    } catch (erro: unknown) {
      falhas.push({ nome: plano.pessoa.nome, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  return { aplicados, falhas };
}
