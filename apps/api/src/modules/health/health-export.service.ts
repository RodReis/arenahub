import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DataExportJob } from '@arenahub/database';

import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { StudentRepository } from '../students/student.repository.js';
import { GymUnitRepository } from '../tenancy/gym-unit.repository.js';
import { AssessmentRepository } from './assessment.repository.js';
import { cabecalhoDeMedida, linhaDeMedida } from './domain/csv-de-saude.js';

/**
 * Exportacao do historico corporal do aluno (`M3-FR-017`, `M3-AC-010`).
 *
 * ## Por que um servico proprio, e nao o `ExportsService` da F11
 *
 * Aquele servico e otimo -- job no Postgres, storage privado, URL curta,
 * idempotencia -- e este REUSA a mesma tabela (`data_export_jobs` ja tem
 * `type` e `filters` genericos) e o mesmo `csv.ts`. O que NAO reusa e o
 * `processar`, soldado a evento de acesso: `AccessQueryRepository`,
 * `linhaDeEvento`, `carregarFusos`. Torna-lo generico mexeria em F11 ja
 * entregue e testada, contra a regra de alteracao cirurgica do `CLAUDE.md`.
 *
 * ## Assincrono desde a F26 -- e por que MUDOU
 *
 * Ate 12/09/2026 este servico montava o CSV dentro da requisicao, e o
 * comentario aqui defendia a escolha: o historico de UM aluno tem dezenas de
 * avaliacoes, e a espera era de menos de um segundo.
 *
 * O que mudou nao foi o volume, foi QUEM PEDE. Pelo painel, quem exporta e a
 * recepcao, numa rede boa, olhando a tela ate o download comecar. Pelo app
 * (`M4-FR-013`, Slice 4.4) quem pede e o aluno, no celular, e a Slice exige
 * "exportacao solicitada de forma ASSINCRONA" -- decisao do PI em
 * 12/09/2026. Segurar a resposta HTTP enquanto o arquivo sobe para o storage
 * amarra a tela do aluno a uma latencia que nao e dele.
 *
 * O caminho passa a ser o mesmo da F11: `solicitar` grava `PENDING` e
 * devolve na hora; `processar` roda em background; o cliente consulta o job
 * ate `COMPLETED` e so entao pede o link. Os dois chamadores -- painel e app
 * -- usam o mesmo fluxo, porque duas politicas de exportacao para o mesmo
 * dado dariam dois lugares para o expurgo errar.
 */

/** Vida da URL de download. Curta: o arquivo carrega dado de saude. */
const VALIDADE_DA_URL_SEGUNDOS = 300;

/** Depois disto o objeto e apagado pelo expurgo da F11. */
const VALIDADE_DO_ARQUIVO_HORAS = 24;

/**
 * Marca de ordem de byte do UTF-8.
 *
 * Escrito por codigo, nao como caractere literal -- o literal e invisivel no
 * editor e o lint o barra. Sem ele, o Excel em portugues abre a acentuacao
 * errada e "Avaliacao" vira lixo numa planilha que a academia manda por
 * e-mail.
 */
const BOM_UTF8 = String.fromCharCode(0xfeff);

@Injectable()
export class HealthExportService {
  private readonly log = new Logger(HealthExportService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly avaliacoes: AssessmentRepository,
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * Registra o pedido e devolve o job SEM esperar o arquivo (`M4-FR-013`).
   *
   * `idempotencyKey` por `(tenant, solicitante, chave)`, como na F11: clique
   * duplo no botao devolve o MESMO job, nao dois arquivos.
   *
   * `requesterId` e o solicitante -- o usuario do painel, ou o PROPRIO ALUNO
   * quando o pedido vem do app. A coluna nao tem FK para `users` (nunca
   * teve), entao o id do aluno cabe ali, e a unique passa a isolar por
   * titular: dois alunos podem usar a mesma `idempotencyKey` sem colidir.
   */
  async solicitar(
    contexto: TenantContext,
    studentId: string,
    requesterId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<DataExportJob> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    const existente = await this.db.dataExportJob.findFirst({
      where: { tenantId: contexto.tenantId, requesterId, idempotencyKey },
    });

    // Pedido repetido devolve o MESMO job, em qualquer estado: quem clicou de
    // novo acompanha o que ja esta rodando. Reprocessar um `FAILED` seria
    // pedido novo, com chave nova -- reusar a chave para tentar de novo
    // apagaria o registro da falha, que a auditoria precisa ver.
    if (existente !== null) return existente;

    const job = await this.db.$transaction(async (tx) => {
      const criado = await tx.dataExportJob.create({
        data: {
          tenantId: contexto.tenantId,
          requesterId,
          type: 'HEALTH_HISTORY',
          status: 'PENDING',
          filters: { studentId },
          idempotencyKey,
          expiresAt: new Date(Date.now() + VALIDADE_DO_ARQUIVO_HORAS * 3_600_000),
        },
      });

      // Quem pediu, o que pediu e quando -- ANTES de o arquivo existir. Dado
      // de saude saindo da empresa e o evento que a auditoria precisa ver
      // mesmo quando a geracao falha depois.
      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'health.export_requested',
          target: 'data_export_job',
          targetId: criado.id,
          correlationId,
          metadata: { studentId },
        },
      });

      return criado;
    });

    // Dispara e NAO espera -- e o que torna a resposta imediata.
    //
    // ⚠️ LIMITE CONHECIDO, o mesmo da F11: se o processo cair no meio, o job
    // fica `RUNNING` para sempre e ninguem o retoma. Aceitavel enquanto ha
    // uma instancia e exportacao e ato manual; com varias instancias isto
    // vira job duravel com lease. Registrado para nao ser descoberto em
    // producao.
    void this.processar(contexto, job.id, correlationId).catch((erro: unknown) => {
      this.log.error(
        `exportacao de saude ${job.id} falhou: ${erro instanceof Error ? erro.message : 'erro'}`,
      );
    });

    return job;
  }

  /**
   * Estado do job, para o cliente acompanhar ate `COMPLETED`.
   *
   * `requesterId` RESTRINGE ao solicitante quando informado, e o app SEMPRE o
   * informa: sem ele, um id de job adivinhado dentro do mesmo tenant daria o
   * historico de saude de outro aluno. O painel omite de proposito -- quem
   * tem `health.read` acompanha a exportacao que a colega pediu.
   */
  async consultar(
    contexto: TenantContext,
    jobId: string,
    requesterId?: string,
  ): Promise<DataExportJob> {
    const job = await this.db.dataExportJob.findFirst({
      where: {
        id: jobId,
        tenantId: contexto.tenantId,
        type: 'HEALTH_HISTORY',
        ...(requesterId === undefined ? {} : { requesterId }),
      },
    });

    // 404 e nao 403 para job de outro solicitante: responder "existe, mas nao
    // e seu" confirmaria a existencia de uma exportacao alheia.
    if (job === null) {
      throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });
    }

    return job;
  }

  /**
   * Link de download do job pronto.
   *
   * Separado da consulta de proposito: a URL assinada vive 300 segundos, e
   * gera-la a cada polling produziria uma fila de links vivos para dado de
   * saude. O cliente pede o link uma vez, quando vai baixar.
   */
  async baixar(
    contexto: TenantContext,
    jobId: string,
    requesterId?: string,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    const job = await this.consultar(contexto, jobId, requesterId);

    if (job.status !== 'COMPLETED') {
      throw new ConflictException({ code: 'EXPORT_NOT_READY' });
    }

    if (job.expiresAt !== null && job.expiresAt <= new Date()) {
      throw new ConflictException({ code: 'EXPORT_EXPIRED' });
    }

    return this.assinar(job);
  }

  /** Monta o CSV e grava no storage privado. Roda FORA da requisicao. */
  async processar(contexto: TenantContext, jobId: string, correlationId: string): Promise<void> {
    const job = await this.db.dataExportJob.findFirst({
      where: { id: jobId, tenantId: contexto.tenantId },
    });

    // Job que nao esta `PENDING` ja foi processado, ou esta sendo agora: nao
    // ha o que refazer, e refazer sobrescreveria o arquivo que alguem pode
    // estar baixando.
    if (!job || job.status !== 'PENDING') return;

    const studentId = (job.filters as { studentId: string }).studentId;

    await this.db.dataExportJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      await this.falhar(jobId, 'STUDENT_NOT_FOUND');

      return;
    }

    const unidade = await this.unidades.encontrar(contexto, aluno.gymUnitId);

    if (unidade === null) {
      await this.falhar(jobId, 'GYM_UNIT_NOT_FOUND');

      return;
    }

    // TODAS as publicadas, sem corte de periodo: a exportacao e a prova
    // completa do historico (`M3-AC-010` fala em "avaliacoes, medidas, origem
    // e datas", sem recorte). O grafico e que filtra.
    const publicadas = await this.avaliacoes.listarPublicadasDoAluno(contexto, studentId, null);

    const pedacos: string[] = [cabecalhoDeMedida()];
    let linhas = 0;

    for (const avaliacao of publicadas) {
      for (const medida of avaliacao.measurements) {
        pedacos.push(
          linhaDeMedida({
            assessmentId: avaliacao.id,
            studentId,
            studentName: aluno.fullName,
            assessedAt: avaliacao.assessedAt.toISOString(),
            assessedAtLocal: instanteLocal(avaliacao.assessedAt, unidade.timezone),
            publishedAt: avaliacao.publishedAt?.toISOString() ?? null,
            status: avaliacao.status,
            source: avaliacao.source,
            correctsAssessmentId: avaliacao.supersedesAssessmentId,
            superseded: avaliacao.supersededBy !== null,
            type: medida.type,
            // `Decimal` vira STRING, nunca `number` (INV-106): a conversao
            // introduziria erro binario no arquivo que serve de prova.
            originalValue: medida.originalValue.toString(),
            originalUnit: medida.originalUnit,
            canonicalValue: medida.canonicalValue.toString(),
            canonicalUnit: medida.canonicalUnit,
            evaluatorUserId: avaliacao.evaluatorUserId,
          }),
        );

        linhas += 1;
      }
    }

    const chave = `exports/${contexto.tenantId}/health/${job.id}.csv`;

    try {
      await this.storage.putPrivateObject({
        key: chave,
        body: Buffer.from(BOM_UTF8 + pedacos.join(''), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      });
    } catch (erro: unknown) {
      await this.falhar(job.id, 'EXPORT_PROCESSING_FAILED');

      throw erro;
    }

    const completo = await this.db.dataExportJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        objectKey: chave,
        rowCount: linhas,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + VALIDADE_DO_ARQUIVO_HORAS * 3_600_000),
      },
    });

    // O QUE SAIU, e quando. Para a LGPD o que importa e o instante em que o
    // dado deixou o sistema -- e ele sai aqui, nao no pedido.
    // `comTenant`: `audit_logs` tem politica RLS (F66). ESCRITA fora de
    // transacao interceptada nao volta vazia -- FALHA com `42501`, o mesmo
    // erro que originou a #302. Aqui derrubaria a exportacao de saude
    // depois de o arquivo ja ter sido gerado (issue #306).
    await this.db.comTenant((tx) =>
      tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'health.exported',
          target: 'student',
          targetId: studentId,
          correlationId,
          metadata: { rowCount: linhas, jobId: completo.id },
        },
      }),
    );

  }

  /**
   * Marca o job como falho com codigo ESTAVEL.
   *
   * Nunca a mensagem crua: ela carrega trecho de query, e query de saude
   * carrega id de aluno.
   */
  private async falhar(jobId: string, errorCode: string): Promise<void> {
    await this.db.dataExportJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', errorCode, completedAt: new Date() },
    });
  }

  private async assinar(job: DataExportJob): Promise<{ downloadUrl: string; expiresAt: string }> {
    if (job.objectKey === null) {
      throw new ConflictException({ code: 'EXPORT_NOT_READY' });
    }

    return this.storage.createPrivateDownload({
      key: job.objectKey,
      expiresInSeconds: VALIDADE_DA_URL_SEGUNDOS,
      // Sem nome de aluno no nome do arquivo: ele aparece na pasta de
      // downloads e em anexo de e-mail, onde ninguem controla quem ve.
      fileName: `historico-corporal-${job.id}.csv`,
    });
  }
}

/**
 * Instante no fuso da unidade, em formato legivel por planilha.
 *
 * `sv-SE` produz `AAAA-MM-DD HH:mm:ss`, que Excel e LibreOffice reconhecem
 * como data sem depender do idioma da maquina -- mesma escolha do
 * `formatarLocal` da F11. `pt-BR` daria `DD/MM/AAAA`, que vira texto numa
 * planilha configurada em ingles.
 */
function instanteLocal(instante: Date, fuso: string): string {
  try {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: fuso,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(instante)
      .replace(',', '');
  } catch {
    // Fuso invalido nao derruba a exportacao inteira: a coluna UTC continua
    // correta, e um arquivo com uma coluna vazia e melhor que nenhum arquivo.
    return '';
  }
}
