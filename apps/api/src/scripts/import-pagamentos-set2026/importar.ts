/**
 * Nucleo da importacao de pagamentos de setembro/2026 -- separado do script
 * CLI (`scripts/import-pagamentos-set2026.ts`) para ser testavel com client
 * injetado, sem depender de `process.env` nem de arquivo em disco.
 *
 * DUAS FASES deliberadamente separadas (decisao do PI, 23/09/2026): o dry-run
 * nunca grava, so classifica cada linha do relatorio contra o banco e devolve
 * os baldes para revisao humana. A gravacao (`gravarPagamentosProntos`) e
 * uma chamada a parte, e so processa o balde `PRONTO` que a pessoa confirmou.
 */
import type { PrismaService } from '../../persistence/prisma.service.js';
import { agruparPorNome, decidirVeredito, normalizarNome, type LinhaDeRelatorio, type VereditoDaLinha } from './dominio.js';

export interface RelatorioDoDryRun {
  prontos: Extract<VereditoDaLinha, { tipo: 'PRONTO' }>[];
  duplicadosNoArquivo: { nome: string; ocorrencias: number }[];
  ambiguos: { nome: string }[];
  naoEncontrados: { nome: string }[];
  semInvoiceAberta: { nome: string; studentId: string }[];
}

/**
 * So LE o banco -- nenhum `create`/`update` aqui. Um nome que se repete
 * EXATAMENTE no arquivo (`agruparPorNome`) vira pendencia antes mesmo de
 * consultar o banco: nao da pra saber, so pelo nome, se e erro de digitacao
 * do relatorio de origem ou pagamento em duplicata real.
 *
 * `db.comTenant(...)` -- `Student` tem RLS ativa (F66) e `findMany`/
 * `findFirst` soltos so recebem o `set_config` de tenant DENTRO de uma
 * transacao interativa (`PrismaService.$transaction`, ver comentario ali).
 * Sem isso o role restrito enxerga ZERO linhas, em silencio: nao e erro,
 * e o resultado (base vazia) e indistinguivel de "banco sem esse aluno" --
 * exatamente o que levou a classificar 221 alunos reais como
 * NAO_ENCONTRADO na primeira rodada desta fatia.
 */
export async function planejarImportacao(
  db: PrismaService,
  tenantId: string,
  linhas: readonly LinhaDeRelatorio[],
): Promise<RelatorioDoDryRun> {
  const grupos = agruparPorNome(linhas);

  const relatorio: RelatorioDoDryRun = {
    prontos: [],
    duplicadosNoArquivo: [],
    ambiguos: [],
    naoEncontrados: [],
    semInvoiceAberta: [],
  };

  // Uma busca so para todo o tenant, fora do loop -- 231 nomes unicos contra
  // 2001 alunos em memoria e mais barato e mais simples que um `findMany` por
  // linha (N+1).
  const alunosDoTenant = await db.comTenant((tx) =>
    tx.student.findMany({ where: { tenantId }, select: { id: true, fullName: true } }),
  );

  const porNomeNormalizado = new Map<string, { id: string; fullName: string }[]>();
  for (const aluno of alunosDoTenant) {
    const chave = normalizarNome(aluno.fullName);
    const grupo = porNomeNormalizado.get(chave);
    if (grupo) grupo.push(aluno);
    else porNomeNormalizado.set(chave, [aluno]);
  }

  for (const [nomeNormalizado, ocorrencias] of grupos) {
    if (ocorrencias.length > 1) {
      relatorio.duplicadosNoArquivo.push({
        nome: ocorrencias[0]!.nome,
        ocorrencias: ocorrencias.length,
      });
      continue;
    }

    const linha = ocorrencias[0]!;
    const alunosCandidatos = porNomeNormalizado.get(nomeNormalizado) ?? [];

    const comInvoice = await Promise.all(
      alunosCandidatos.map(async (aluno) => {
        const invoice = await db.comTenant((tx) =>
          tx.invoice.findFirst({
            where: { tenantId, studentId: aluno.id, status: { in: ['OPEN', 'OVERDUE'] } },
            orderBy: { dueAt: 'asc' },
            select: { id: true, totalMinor: true },
          }),
        );

        return {
          studentId: aluno.id,
          nomeNormalizado: normalizarNome(aluno.fullName),
          invoiceAberta: invoice ? { id: invoice.id, totalMinor: invoice.totalMinor } : null,
        };
      }),
    );

    const veredito = decidirVeredito(linha, comInvoice);

    if (veredito.tipo === 'PRONTO') relatorio.prontos.push(veredito);
    else if (veredito.tipo === 'AMBIGUO') relatorio.ambiguos.push({ nome: veredito.nome });
    else if (veredito.tipo === 'NAO_ENCONTRADO') relatorio.naoEncontrados.push({ nome: veredito.nome });
    else relatorio.semInvoiceAberta.push({ nome: veredito.nome, studentId: veredito.studentId });
  }

  return relatorio;
}

export interface ResultadoDaGravacao {
  reconciliados: number;
  falhas: { nome: string; erro: string }[];
}

/**
 * Grava so o balde `PRONTO`, um por um, via a funcao `registrar` injetada
 * pelo chamador -- o script CLI passa
 * `billing.registrarPagamentoManual.bind(billing)`, o MESMO caminho que a
 * recepcao usa na tela (fecha invoice, credita sobrepagamento, promove
 * entitlement, escreve outbox), em vez de reimplementar a transacao
 * financeira aqui.
 *
 * Falha de uma linha NAO aborta as demais: cada pagamento e independente,
 * e uma invoice que virou PAID por outro caminho entre o dry-run e a
 * gravacao (corrida improvavel, mas possivel numa base de producao) nao
 * pode travar as demais.
 */
export async function gravarPagamentosProntos(
  registrar: (entrada: {
    invoiceId: string;
    amountMinor: number;
    reason: string;
    paidAt: Date;
  }) => Promise<unknown>,
  prontos: readonly Extract<VereditoDaLinha, { tipo: 'PRONTO' }>[],
): Promise<ResultadoDaGravacao> {
  const falhas: { nome: string; erro: string }[] = [];
  let reconciliados = 0;

  for (const item of prontos) {
    try {
      await registrar({
        invoiceId: item.invoiceId,
        amountMinor: item.amountMinor,
        reason: 'Importado do relatorio de pagamentos de setembro/2026 (issue #386)',
        paidAt: item.paidAt,
      });
      reconciliados += 1;
    } catch (erro: unknown) {
      falhas.push({ nome: item.nome, erro: erro instanceof Error ? erro.message : String(erro) });
    }
  }

  return { reconciliados, falhas };
}
