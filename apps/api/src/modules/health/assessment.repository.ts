import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type BodyAssessment,
  type BodyMeasurement,
  type HealthContextFactor,
  type StudentHealthContext,
} from '@arenahub/database';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import {
  AvaliacaoImutavelError,
  AvaliacaoNaoEncontradaError,
  correcaoPermitida,
  publicar,
} from './domain/avaliacao.js';
import type { MedidaCanonica } from './domain/medida.js';

/** Avaliacao com as medidas que ela carrega. */
export type AvaliacaoComMedidas = BodyAssessment & { measurements: BodyMeasurement[] };

/**
 * Avaliacao publicada como a serie do historico precisa dela: com as medidas
 * e com a correcao que a substitui, quando existe (INV-102).
 */
export type AvaliacaoPublicada = AvaliacaoComMedidas & {
  supersededBy: { id: string } | null;
};

export interface DadosDaAvaliacao {
  assessedAt: Date;
  evaluatorUserId: string;
  notes?: string | undefined;
  medidas: readonly MedidaCanonica[];
  /**
   * De onde vieram os numeros. `MANUAL` por padrao -- o caminho que sempre
   * existiu.
   *
   * `IMPORT` entra pela F19, e nao e cosmetico: o aluno ve na ficha que
   * aquele numero veio de arquivo, e a auditoria chega ao arquivo pelo
   * `sourceReference` (o id da importacao).
   */
  source?: 'MANUAL' | 'DEVICE' | 'IMPORT' | undefined;
  sourceReference?: string | undefined;
  /**
   * Indice, classificacao ou sugestao do APARELHO (idade corporal,
   * pontuacao, tipo de corpo, achado de ECG). Nunca vira `BodyMeasurement`
   * -- e formula proprietaria que muda com firmware (spec §4.4) -- so
   * acompanha a avaliacao como referencia opaca (ADR-035).
   */
  deviceReport?: Record<string, unknown> | undefined;
  deviceModel?: string | undefined;
  deviceSerial?: string | undefined;
}

/** Unidade do dominio (minuscula) para o enum do Prisma (maiuscula). */
function unidadeParaBanco(unidade: MedidaCanonica['originalUnit']): 'KG' | 'G' | 'LB' | 'CM' | 'M' | 'IN' | 'PERCENT' | 'KCAL' | 'L' | null {
  if (unidade === null) return null;

  return unidade.toUpperCase() as 'KG' | 'G' | 'LB' | 'CM' | 'M' | 'IN' | 'PERCENT' | 'KCAL' | 'L';
}

/**
 * Acesso a avaliacao fisica, medidas e contexto de saude.
 *
 * TODO METODO recebe `TenantContext` como PRIMEIRO argumento -- INV-003 e
 * regra de arquitetura no 2.
 *
 * As escritas que mudam mais de uma tabela rodam em transacao: avaliacao sem
 * as medidas dela e uma linha no historico que nao mede nada.
 */
@Injectable()
export class AssessmentRepository {
  constructor(private readonly db: PrismaService) {}

  /** Cria o rascunho com as medidas ja convertidas. */
  async criarRascunho(
    contexto: TenantContext,
    studentId: string,
    dados: DadosDaAvaliacao,
  ): Promise<AvaliacaoComMedidas> {
    return this.db.$transaction(async (tx) => {
      const avaliacao = await tx.bodyAssessment.create({
        data: {
          tenantId: contexto.tenantId,
          studentId,
          status: 'DRAFT',
          assessedAt: dados.assessedAt,
          source: dados.source ?? 'MANUAL',
          sourceReference: dados.sourceReference ?? null,
          evaluatorUserId: dados.evaluatorUserId,
          notes: dados.notes ?? null,
          deviceReport:
            dados.deviceReport === undefined
              ? Prisma.JsonNull
              : (dados.deviceReport as Prisma.InputJsonValue),
          deviceModel: dados.deviceModel ?? null,
          deviceSerial: dados.deviceSerial ?? null,
        },
      });

      await this.gravarMedidas(tx, contexto, avaliacao.id, dados.medidas);

      return this.exigirComMedidas(tx, contexto, avaliacao.id);
    });
  }

  /**
   * Substitui as medidas de um RASCUNHO.
   *
   * Le o status DENTRO da transacao e falha se ja publicou: sem isso, duas
   * requisicoes concorrentes -- uma publicando, outra editando -- deixariam a
   * edicao passar depois da publicacao, e a avaliacao oficial mudaria de
   * valor sem virar correcao (INV-102).
   */
  async substituirMedidasDoRascunho(
    contexto: TenantContext,
    assessmentId: string,
    medidas: readonly MedidaCanonica[],
    notes: string | null | undefined,
  ): Promise<AvaliacaoComMedidas> {
    return this.db.$transaction(async (tx) => {
      // TRAVA a linha antes de ler o status: sem ela, publicar commita entre
      // este SELECT e o `createMany` das medidas, e a avaliacao publicada
      // termina com o valor do rascunho (medido: 25/25).
      const atual = await this.travarAvaliacao(tx, contexto, assessmentId);

      if (!atual) throw new AvaliacaoNaoEncontradaError();

      if (atual.status !== 'DRAFT') {
        throw new AvaliacaoImutavelError('avaliacao ja publicada');
      }

      await tx.bodyMeasurement.deleteMany({
        where: { assessmentId, tenantId: contexto.tenantId },
      });

      await this.gravarMedidas(tx, contexto, assessmentId, medidas);

      if (notes !== undefined) {
        await tx.bodyAssessment.update({
          where: { id: assessmentId },
          data: { notes },
        });
      }

      return this.exigirComMedidas(tx, contexto, assessmentId);
    });
  }

  /**
   * Publica o rascunho.
   *
   * A transicao passa pela regra pura (`publicar`), e o `WHERE` inclui
   * `status: 'DRAFT'`: duas publicacoes simultaneas fazem a segunda achar
   * zero linhas em vez de mover `published_at` de novo.
   */
  async publicar(
    contexto: TenantContext,
    assessmentId: string,
    agora: Date,
  ): Promise<AvaliacaoComMedidas> {
    return this.db.$transaction(async (tx) => {
      // Mesma trava do lado da edicao -- e o que faz as duas transacoes
      // serializarem em vez de se atropelarem.
      const atual = await this.travarAvaliacao(tx, contexto, assessmentId);

      if (!atual) throw new AvaliacaoNaoEncontradaError();

      // Conta as medidas DEPOIS da trava: contar antes leria um numero que a
      // edicao concorrente ainda pode mudar.
      const medidas = await tx.bodyMeasurement.count({
        where: { assessmentId, tenantId: contexto.tenantId },
      });

      const publicada = publicar(atual, medidas, agora);

      const afetadas = await tx.bodyAssessment.updateMany({
        where: { id: assessmentId, tenantId: contexto.tenantId, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: publicada.publishedAt },
      });

      if (afetadas.count === 0) {
        // Outra requisicao publicou entre o SELECT e o UPDATE.
        throw new AvaliacaoImutavelError('avaliacao ja publicada');
      }

      return this.exigirComMedidas(tx, contexto, assessmentId);
    });
  }

  /**
   * Cria a correcao de uma avaliacao publicada (INV-102).
   *
   * A correcao nasce JA PUBLICADA: ela existe para substituir um numero
   * oficial errado, e deixa-la em rascunho manteria o errado valendo por
   * tempo indeterminado. A original permanece publicada e visivel.
   *
   * O `@unique` de `supersedesAssessmentId` no banco e o que impede duas
   * correcoes concorrentes do mesmo original -- a checagem em codigo da a
   * mensagem, o indice da a garantia.
   */
  async criarCorrecao(
    contexto: TenantContext,
    originalId: string,
    dados: DadosDaAvaliacao,
    agora: Date,
  ): Promise<AvaliacaoComMedidas> {
    return this.db.$transaction(async (tx) => {
      // Trava a ORIGINAL: duas correcoes simultaneas do mesmo original
      // chegariam as duas ao `create`, e uma levaria `P2002` cru em vez do
      // 409 de dominio. O `@unique` continua sendo a garantia; a trava e o
      // que torna a mensagem previsivel.
      const travada = await this.travarAvaliacao(tx, contexto, originalId);

      if (!travada) throw new AvaliacaoNaoEncontradaError();

      const original = await tx.bodyAssessment.findFirstOrThrow({
        where: { id: originalId, tenantId: contexto.tenantId },
        include: { supersededBy: { select: { id: true } } },
      });

      correcaoPermitida(travada, original.supersededBy?.id ?? null);

      const correcao = await tx.bodyAssessment.create({
        data: {
          tenantId: contexto.tenantId,
          studentId: original.studentId,
          status: 'PUBLISHED',
          assessedAt: dados.assessedAt,
          publishedAt: agora,
          source: 'MANUAL',
          evaluatorUserId: dados.evaluatorUserId,
          notes: dados.notes ?? null,
          supersedesAssessmentId: originalId,
        },
      });

      await this.gravarMedidas(tx, contexto, correcao.id, dados.medidas);

      return this.exigirComMedidas(tx, contexto, correcao.id);
    });
  }

  /**
   * Apaga um RASCUNHO -- nunca uma avaliacao publicada.
   *
   * Existe para a sessao multiarquivo (Task 5, fix Critical 2): quando duas
   * confirmacoes concorrentes da mesma sessao criam cada uma o proprio
   * rascunho e so uma consegue LIGAR os imports a ele (indice parcial), a
   * perdedora precisa desfazer o proprio rascunho -- senao ele fica orfao,
   * visivel em `listarDoAluno` (todos os status) como uma avaliacao fantasma
   * que nenhum arquivo referencia. `BodyMeasurement` cascade-apaga junto
   * (`onDelete: Cascade` no schema).
   *
   * Filtra por `status: 'DRAFT'`: apagar avaliacao PUBLICADA destruiria
   * historico oficial, e isso nunca e o caso de uso desta funcao.
   */
  async excluirRascunho(contexto: TenantContext, assessmentId: string): Promise<void> {
    await this.db.bodyAssessment.deleteMany({
      where: { id: assessmentId, tenantId: contexto.tenantId, status: 'DRAFT' },
    });
  }

  async encontrar(
    contexto: TenantContext,
    assessmentId: string,
  ): Promise<AvaliacaoComMedidas | null> {
    return this.db.bodyAssessment.findFirst({
      where: { id: assessmentId, tenantId: contexto.tenantId },
      include: { measurements: true },
    });
  }

  /** Historico do aluno, do mais recente para o mais antigo. */
  async listarDoAluno(
    contexto: TenantContext,
    studentId: string,
  ): Promise<AvaliacaoComMedidas[]> {
    return this.db.bodyAssessment.findMany({
      where: { tenantId: contexto.tenantId, studentId },
      include: { measurements: true },
      orderBy: [{ assessedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Serie PUBLICADA do aluno para o grafico de historico (F18).
   *
   * Tres diferencas de `listarDoAluno`, e cada uma existe por um motivo:
   *
   * - so `PUBLISHED`: rascunho e numero que ninguem conferiu ainda, e um
   *   ponto no grafico e oficial por definicao;
   * - ordem CRESCENTE por `assessedAt`: a serie e lida da esquerda para a
   *   direita, e desempata por `id` para que a mesma entrada gere sempre o
   *   mesmo grafico (aceite da Slice 3.2);
   * - corte por periodo (`M3-FR-008`), quando houver.
   *
   * `supersededBy` vem junto porque a correcao SUBSTITUI a original na serie
   * (INV-102) -- as duas seguem publicadas, e quem filtra e
   * `selecionarFolhas`, no dominio. Fazer o filtro aqui no `WHERE`
   * esconderia do dominio a informacao de que houve correcao.
   *
   * ## O CORTE DE PERIODO E POR CADEIA, NAO POR LINHA
   *
   * DEFEITO REAL, achado na revisao adversarial desta fatia -- e do pior
   * tipo, porque o dado nao aparecia errado: ele DESAPARECIA.
   *
   * `POST /assessments/:id/corrections` aceita `assessedAt` livre do corpo,
   * entao a correcao pode carimbar data diferente da original (o caso real e
   * perceber o erro meses depois e REMEDIR o aluno). Com o corte aplicado
   * linha a linha, bastava a original cair dentro da janela e a correcao
   * fora: a consulta trazia a original ja marcada como corrigida, sem a
   * folha; `selecionarFolhas` descartava a original -- correto, ela foi
   * corrigida -- e o tipo sumia INTEIRO da tela, como se o aluno nunca
   * tivesse sido medido.
   *
   * O `OR` abaixo mantem a cadeia junta: a avaliacao entra se ELA ou a
   * CORRECAO dela cai no periodo. A folha sempre chega acompanhada, e o
   * dominio decide com a cadeia completa na mao.
   *
   * Os indices que esta consulta usa ja existem no schema:
   * `(tenant_id, student_id, assessed_at)` e
   * `(tenant_id, student_id, status, published_at)`.
   */
  async listarPublicadasDoAluno(
    contexto: TenantContext,
    studentId: string,
    desde: Date | null,
  ): Promise<AvaliacaoPublicada[]> {
    return this.db.bodyAssessment.findMany({
      where: {
        tenantId: contexto.tenantId,
        studentId,
        status: 'PUBLISHED',
        // `null` = periodo ALL, sem corte. `new Date(0)` filtraria por 1970
        // sem necessidade.
        ...(desde !== null
          ? {
              OR: [
                { assessedAt: { gte: desde } },
                // A correcao esta na janela: traz a original junto, senao a
                // folha chegaria orfa e o dominio nao saberia o que ela
                // substitui.
                { supersededBy: { assessedAt: { gte: desde } } },
                // A original esta na janela: traz a correcao junto, senao a
                // original seria descartada por `selecionarFolhas` e o tipo
                // sumiria da tela.
                { supersedes: { assessedAt: { gte: desde } } },
              ],
            }
          : {}),
      },
      include: {
        measurements: true,
        supersededBy: { select: { id: true } },
      },
      orderBy: [{ assessedAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Fatores ATIVOS do aluno (ADR-037). */
  async listarContextoAtivo(
    contexto: TenantContext,
    studentId: string,
  ): Promise<StudentHealthContext[]> {
    return this.db.studentHealthContext.findMany({
      where: { tenantId: contexto.tenantId, studentId, deactivatedAt: null },
      orderBy: [{ recordedAt: 'desc' }],
    });
  }

  /**
   * Ativa um fator. Repetir o mesmo fator ativo nao cria linha nova.
   *
   * Sem essa checagem, clicar duas vezes produziria dois registros do mesmo
   * fator e a lista da tela mostraria "atleta competitivo" duplicado.
   */
  async ativarFator(
    contexto: TenantContext,
    studentId: string,
    factor: HealthContextFactor,
    recordedByUserId: string,
    agora: Date,
  ): Promise<StudentHealthContext> {
    const jaAtivo = await this.db.studentHealthContext.findFirst({
      where: { tenantId: contexto.tenantId, studentId, factor, deactivatedAt: null },
    });

    if (jaAtivo) return jaAtivo;

    try {
      return await this.db.studentHealthContext.create({
        data: {
          tenantId: contexto.tenantId,
          studentId,
          factor,
          recordedByUserId,
          recordedAt: agora,
        },
      });
    } catch (erro: unknown) {
      // A leitura acima e ATALHO, nao garantia: duas requisicoes concorrentes
      // leem as duas `null` e as duas chegam aqui. Quem garante e o indice
      // parcial `student_health_context_um_fator_ativo_por_aluno` -- mesma
      // classe do bug da F14, onde `if (jaExiste)` perdia a corrida.
      //
      // `P2002` aqui NAO e erro: significa que o fator ficou ativo, que e
      // exatamente o que o chamador pediu. Devolve a linha vencedora.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        return this.db.studentHealthContext.findFirstOrThrow({
          where: { tenantId: contexto.tenantId, studentId, factor, deactivatedAt: null },
        });
      }

      throw erro;
    }
  }

  /**
   * Desativa um fator sem apagar a linha.
   *
   * O snapshot da F21 precisa saber o que valia NA DATA da analise; apagar
   * faria uma analise antiga parecer ter sido feita sem o fator que a
   * explicava.
   */
  async desativarFator(
    contexto: TenantContext,
    studentId: string,
    factor: HealthContextFactor,
    agora: Date,
  ): Promise<number> {
    const resultado = await this.db.studentHealthContext.updateMany({
      where: { tenantId: contexto.tenantId, studentId, factor, deactivatedAt: null },
      data: { deactivatedAt: agora },
    });

    return resultado.count;
  }

  /**
   * Trava a linha da avaliacao ate o fim da transacao (`SELECT ... FOR UPDATE`).
   *
   * **Por que existe.** As medidas moram em OUTRA tabela, entao
   * `deleteMany`/`createMany` em `body_measurements` nao colide com o
   * `UPDATE` de `body_assessments`. Em READ COMMITTED -- o padrao do Postgres
   * -- nada serializa as duas transacoes por conta propria: publicar pode
   * commitar no meio da edicao, e a edicao termina gravando medida numa
   * avaliacao que ja virou oficial. Ler o status DEPOIS da trava e o que
   * torna a checagem confiavel: quem chegou primeiro termina, e o segundo
   * enxerga o estado ja commitado.
   *
   * ⚠️ **NENHUM TESTE DEFENDE ESTA TRAVA. Remover nao quebra nada, e mesmo
   * assim ela FICA -- decisao do PI em 20/08/2026.**
   *
   * Nao e descuido: escrevi tres testes para ela e os tres estavam errados.
   *
   *   1. reprovava toda avaliacao publicada com o valor da edicao -- mas ha
   *      ordem LEGITIMA que produz isso (a edicao commita enquanto ainda e
   *      rascunho, e publicar congela o valor dela). Falso positivo no CI;
   *   2. tentou separar as ordens por `medida.createdAt` vs `publishedAt` --
   *      irrecuperavel, porque um vem de `now()` do POSTGRES e o outro de
   *      `new Date()` do NODE, e o skew entre containers inverte a comparacao;
   *   3. tentou deduzir a ordem do par de status HTTP -- e PASSOU NA MUTACAO,
   *      ou seja, virou guarda decorativa.
   *
   * A raiz e que as duas ordens produzem estado final IDENTICO visto de fora.
   * O que resta provado, por teste sequencial e determinista, e o essencial:
   * **publicada, nada muda** -- a edicao que chega depois recebe 409.
   *
   * Se for remover isto algum dia, saiba o que esta removendo: a janela e
   * real, so nao e observavel pela API.
   *
   * Devolve `null` quando a avaliacao nao existe no tenant -- 404, nao 409.
   */
  private async travarAvaliacao(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    assessmentId: string,
  ): Promise<{ status: 'DRAFT' | 'PUBLISHED'; publishedAt: Date | null } | null> {
    const linhas = await tx.$queryRaw<
      { status: 'DRAFT' | 'PUBLISHED'; published_at: Date | null }[]
    >`
      SELECT status, published_at
        FROM body_assessments
       WHERE id = ${assessmentId}::uuid
         AND tenant_id = ${contexto.tenantId}::uuid
         FOR UPDATE
    `;

    const linha = linhas[0];

    if (!linha) return null;

    return { status: linha.status, publishedAt: linha.published_at };
  }

  private async gravarMedidas(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    assessmentId: string,
    medidas: readonly MedidaCanonica[],
  ): Promise<void> {
    if (medidas.length === 0) return;

    await tx.bodyMeasurement.createMany({
      data: medidas.map((medida) => ({
        tenantId: contexto.tenantId,
        assessmentId,
        type: medida.type,
        originalValue: new Prisma.Decimal(medida.originalValue),
        originalUnit: unidadeParaBanco(medida.originalUnit),
        canonicalValue: new Prisma.Decimal(medida.canonicalValue),
        canonicalUnit: unidadeParaBanco(medida.canonicalUnit),
        source: 'MANUAL' as const,
      })),
    });
  }

  private async exigirComMedidas(
    tx: Prisma.TransactionClient,
    contexto: TenantContext,
    assessmentId: string,
  ): Promise<AvaliacaoComMedidas> {
    const avaliacao = await tx.bodyAssessment.findFirst({
      where: { id: assessmentId, tenantId: contexto.tenantId },
      include: { measurements: true },
    });

    if (!avaliacao) throw new AvaliacaoNaoEncontradaError();

    return avaliacao;
  }
}
