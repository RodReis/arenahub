import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
 * ## Sincrono, e por que isso e correto AQUI
 *
 * A F11 e assincrona porque exporta ate 100 mil eventos de acesso. O
 * historico de UM aluno tem dezenas de avaliacoes -- o laudo real de
 * 03/08/2026 tem 15 medidas; cinco anos de avaliacoes trimestrais dao 300
 * linhas. Montar isso em background, com polling e segunda chamada para o
 * link, custaria mais ao operador do que a espera de menos de um segundo.
 *
 * O job continua sendo gravado: a auditoria precisa saber que o dado saiu, e
 * `M3-NFR-008` exige exportacao com politica LGPD testada.
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
  constructor(
    private readonly db: PrismaService,
    private readonly avaliacoes: AssessmentRepository,
    private readonly alunos: StudentRepository,
    private readonly unidades: GymUnitRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * Monta o CSV do historico do aluno e devolve o link de download.
   *
   * `idempotencyKey` por `(tenant, solicitante, chave)`, como na F11: clique
   * duplo no botao devolve o MESMO arquivo, nao dois.
   */
  async exportar(
    contexto: TenantContext,
    studentId: string,
    idempotencyKey: string,
    correlationId: string,
  ): Promise<{ job: DataExportJob; downloadUrl: string; expiresAt: string }> {
    const aluno = await this.alunos.encontrar(contexto, studentId);

    if (aluno === null) {
      throw new NotFoundException({ code: 'STUDENT_NOT_FOUND' });
    }

    const existente = await this.db.dataExportJob.findFirst({
      where: {
        tenantId: contexto.tenantId,
        requesterId: contexto.actorId,
        idempotencyKey,
      },
    });

    // Job repetido que ja completou devolve o MESMO arquivo. Um que falhou ou
    // ficou pelo caminho nao serve de resposta: quem clicou de novo quer o
    // dado, nao a lembranca de um erro.
    if (existente !== null && existente.status === 'COMPLETED' && existente.objectKey !== null) {
      if (existente.expiresAt !== null && existente.expiresAt <= new Date()) {
        throw new ConflictException({ code: 'EXPORT_EXPIRED' });
      }

      const url = await this.assinar(existente);

      return { job: existente, ...url };
    }

    const unidade = await this.unidades.encontrar(contexto, aluno.gymUnitId);

    if (unidade === null) {
      throw new NotFoundException({ code: 'GYM_UNIT_NOT_FOUND' });
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

    const agora = new Date();

    const job = await this.db.dataExportJob.upsert({
      where: {
        tenantId_requesterId_idempotencyKey: {
          tenantId: contexto.tenantId,
          requesterId: contexto.actorId,
          idempotencyKey,
        },
      },
      create: {
        tenantId: contexto.tenantId,
        requesterId: contexto.actorId,
        type: 'HEALTH_HISTORY',
        status: 'RUNNING',
        filters: { studentId },
        idempotencyKey,
        startedAt: agora,
      },
      update: { status: 'RUNNING', startedAt: agora, errorCode: null },
    });

    const chave = `exports/${contexto.tenantId}/health/${job.id}.csv`;

    try {
      await this.storage.putPrivateObject({
        key: chave,
        body: Buffer.from(BOM_UTF8 + pedacos.join(''), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      });
    } catch (erro: unknown) {
      await this.db.dataExportJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          // Codigo estavel, nunca a mensagem crua: ela carrega trecho de
          // query, e query de saude carrega id de aluno.
          errorCode: 'EXPORT_PROCESSING_FAILED',
          completedAt: new Date(),
        },
      });

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
    await this.db.auditLog.create({
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
    });

    const url = await this.assinar(completo);

    return { job: completo, ...url };
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
