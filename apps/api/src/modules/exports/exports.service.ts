import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DataExportJob } from '@arenahub/database';
import { createHash } from 'node:crypto';

import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../common/storage/object-storage.port.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { AccessQueryRepository, type FiltroDeEventos } from '../access-query/access-query.repository.js';
import { cabecalhoDeEvento, linhaDeEvento } from './domain/csv.js';

/**
 * Exportacao assincrona de eventos -- `M1-FR-024`, `M1-NFR-009`.
 *
 * ASSINCRONA POR EXIGENCIA do `M1-NFR-009`: "exportacoes grandes sao
 * assincronas e nao bloqueiam a API". Uma exportacao de 100 mil eventos numa
 * requisicao HTTP prenderia um worker do Node e deixaria a operacao esperando
 * -- com uma pessoa parada na catraca.
 *
 * SEM BullMQ, decisao do PI: o job vive no Postgres, como a fila de F8. O
 * processamento comeca em background no mesmo processo que recebeu o pedido.
 * Isso tem um limite conhecido e declarado abaixo.
 */

/** Depois disto o objeto e apagado. */
const VALIDADE_DO_ARQUIVO_HORAS = 24;

/** Vida da URL de download. Curta: o link carrega dado de acesso de aluno. */
const VALIDADE_DA_URL_SEGUNDOS = 300;

/** Linhas por lote lido do banco. */
const TAMANHO_DA_PAGINA = 500;

/**
 * Marca de ordem de byte do UTF-8.
 *
 * Escrito por codigo, nao como caractere literal: o literal e invisivel no
 * editor, e o lint o barra (`no-irregular-whitespace`) exatamente por isso --
 * caractere que ninguem ve e caractere que ninguem revisa.
 *
 * Sem ele, o Excel em portugues abre a acentuacao errada e "Nao" vira
 * "NA£o" numa planilha que a academia manda por e-mail.
 */
const BOM_UTF8 = String.fromCharCode(0xfeff);

@Injectable()
export class ExportsService {
  private readonly log = new Logger(ExportsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly consulta: AccessQueryRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  /**
   * Cria o job e devolve na hora. O arquivo fica pronto depois.
   *
   * Chave de idempotencia por `(tenant, solicitante, chave)`: clique duplo no
   * botao de exportar devolve o MESMO job, nao dois arquivos.
   */
  async solicitar(
    contexto: TenantContext,
    entrada: {
      filtro: Omit<FiltroDeEventos, 'cursor' | 'limite'>;
      /** `false` quando o periodo veio do padrao, nao do cliente. */
      periodoExplicito: boolean;
      idempotencyKey: string;
      correlationId: string;
    },
  ): Promise<{ job: DataExportJob; jaExistia: boolean }> {
    const filtrosNormalizados = {
      de: entrada.filtro.de.toISOString(),
      ate: entrada.filtro.ate.toISOString(),
      gymUnitId: entrada.filtro.gymUnitId ?? null,
      studentId: entrada.filtro.studentId ?? null,
      outcome: entrada.filtro.outcome ?? null,
      mode: entrada.filtro.mode ?? null,
    };

    const existente = await this.db.dataExportJob.findUnique({
      where: {
        tenantId_requesterId_idempotencyKey: {
          tenantId: contexto.tenantId,
          requesterId: contexto.actorId,
          idempotencyKey: entrada.idempotencyKey,
        },
      },
    });

    if (existente) {
      // Mesma chave com filtro DIFERENTE e bug do cliente ou tentativa de
      // reaproveitar um job alheio. Devolver o antigo em silencio entregaria
      // um arquivo que nao corresponde ao que foi pedido.
      //
      // O PERIODO FICA DE FORA da comparacao quando o cliente nao o informou.
      // Motivo: sem `from`/`to` explicitos, o padrao e "ultimas 24 h", e as
      // duas chamadas de um clique duplo caem em instantes diferentes por
      // milissegundos. Comparar o periodo derivado faria todo retry legitimo
      // virar 409 -- exatamente o caso que a idempotencia existe para
      // resolver.
      const hashAtual = this.hashDoFiltro(filtrosNormalizados, entrada.periodoExplicito);
      const hashAnterior = this.hashDoFiltro(
        existente.filters as Record<string, unknown>,
        entrada.periodoExplicito,
      );

      if (hashAtual !== hashAnterior) {
        throw new ConflictException({ code: 'EXPORT_IDEMPOTENCY_CONFLICT' });
      }

      return { job: existente, jaExistia: true };
    }

    const job = await this.db.$transaction(async (tx) => {
      const criado = await tx.dataExportJob.create({
        data: {
          tenantId: contexto.tenantId,
          requesterId: contexto.actorId,
          type: 'ACCESS_EVENTS',
          status: 'PENDING',
          filters: filtrosNormalizados,
          idempotencyKey: entrada.idempotencyKey,
          expiresAt: new Date(Date.now() + VALIDADE_DO_ARQUIVO_HORAS * 3_600_000),
        },
      });

      // Exportacao e a via mais facil de dado sair da empresa: quem pediu, o
      // que pediu e quando fica registrado antes de o arquivo existir.
      await tx.auditLog.create({
        data: {
          tenantId: contexto.tenantId,
          actorType: 'USER',
          actorId: contexto.actorId,
          action: 'exports.requested',
          target: 'data_export_job',
          targetId: criado.id,
          correlationId: entrada.correlationId,
          metadata: filtrosNormalizados,
        },
      });

      return criado;
    });

    // Dispara e NAO espera -- e o que torna a resposta imediata.
    //
    // ⚠️ LIMITE CONHECIDO: se o processo cair no meio, o job fica `RUNNING`
    // para sempre e ninguem o retoma. Aceitavel enquanto ha uma instancia e
    // exportacao e ato manual e raro; quando houver varias instancias ou
    // exportacao agendada, isto vira job duravel com lease, como a fila de
    // F8. Registrado para nao ser descoberto em producao.
    void this.processar(contexto, job.id).catch((erro: unknown) => {
      this.log.error(
        `exportacao ${job.id} falhou: ${erro instanceof Error ? erro.message : 'erro'}`,
      );
    });

    return { job, jaExistia: false };
  }

  /**
   * Monta o CSV em lotes e grava no storage privado.
   *
   * Pagina o banco em vez de carregar tudo: uma exportacao de 100 mil eventos
   * numa consulta so estouraria a memoria do processo que a operacao esta
   * usando ao mesmo tempo.
   */
  async processar(contexto: TenantContext, jobId: string): Promise<void> {
    const job = await this.db.dataExportJob.findFirst({
      where: { id: jobId, tenantId: contexto.tenantId },
    });

    if (!job || job.status !== 'PENDING') return;

    await this.db.dataExportJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      const filtros = job.filters as {
        de: string;
        ate: string;
        gymUnitId: string | null;
        studentId: string | null;
        outcome: 'ALLOW' | 'DENY' | null;
        mode: 'ONLINE' | 'OFFLINE' | 'OVERRIDE' | null;
      };

      const fusosPorUnidade = await this.carregarFusos(contexto.tenantId);

      const pedacos: string[] = [cabecalhoDeEvento()];
      let linhas = 0;

      const iterador = this.consulta.paginarParaExportacao(
        contexto,
        {
          de: new Date(filtros.de),
          ate: new Date(filtros.ate),
          gymUnitId: filtros.gymUnitId ?? undefined,
          studentId: filtros.studentId ?? undefined,
          outcome: filtros.outcome ?? undefined,
          mode: filtros.mode ?? undefined,
        },
        TAMANHO_DA_PAGINA,
      );

      for await (const pagina of iterador) {
        for (const evento of pagina) {
          pedacos.push(
            linhaDeEvento(evento, fusosPorUnidade.get(evento.gymUnitId) ?? 'America/Sao_Paulo'),
          );
        }

        linhas += pagina.length;

        // Progresso visivel enquanto roda: sem isso a tela mostraria "0" ate
        // o fim, e o operador nao saberia distinguir "processando" de
        // "travado".
        await this.db.dataExportJob.update({
          where: { id: jobId },
          data: { rowCount: linhas },
        });

        const cancelado = await this.db.dataExportJob.findUnique({
          where: { id: jobId },
          select: { status: true },
        });

        if (cancelado?.status === 'CANCELLED') return;
      }

      const chave = `exports/${contexto.tenantId}/${jobId}.csv`;

      await this.storage.putPrivateObject({
        key: chave,
        // BOM UTF-8 -- escrito como escape, nao como caractere literal: o
        // literal e invisivel no editor e o lint o barra justamente por isso.
        //
        // Sem o BOM, o Excel em portugues abre a acentuacao errada, e "Não"
        // vira "NÃ£o" numa planilha que a academia manda por e-mail.
        body: Buffer.from(BOM_UTF8 + pedacos.join(''), 'utf8'),
        contentType: 'text/csv; charset=utf-8',
      });

      await this.db.dataExportJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          objectKey: chave,
          rowCount: linhas,
          completedAt: new Date(),
        },
      });
    } catch (erro: unknown) {
      await this.db.dataExportJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          // Codigo estavel, nunca a mensagem crua: ela carrega trecho de
          // query, e query de eventos carrega id de aluno.
          errorCode: 'EXPORT_PROCESSING_FAILED',
          completedAt: new Date(),
        },
      });

      throw erro;
    }
  }

  async encontrar(contexto: TenantContext, id: string): Promise<DataExportJob | null> {
    return this.db.dataExportJob.findFirst({ where: { id, tenantId: contexto.tenantId } });
  }

  async cancelar(contexto: TenantContext, id: string): Promise<DataExportJob | null> {
    const job = await this.encontrar(contexto, id);

    if (!job) return null;

    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') return job;

    return this.db.dataExportJob.update({
      where: { id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });
  }

  /**
   * URL de download, curta e assinada.
   *
   * A AUTORIZACAO E RECONFERIDA AQUI, nao so na criacao: quem perdeu a
   * permissao entre pedir e baixar nao baixa. Sem esta segunda checagem, um
   * job criado por alguem que saiu da academia continuaria entregando dado.
   */
  async gerarDownload(
    contexto: TenantContext,
    id: string,
    correlationId: string,
  ): Promise<{ downloadUrl: string; expiresAt: string }> {
    const job = await this.encontrar(contexto, id);

    if (!job) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });

    if (job.status !== 'COMPLETED' || !job.objectKey) {
      throw new ConflictException({ code: 'EXPORT_NOT_READY' });
    }

    if (job.expiresAt && job.expiresAt <= new Date()) {
      throw new ConflictException({ code: 'EXPORT_EXPIRED' });
    }

    const url = await this.storage.createPrivateDownload({
      key: job.objectKey,
      expiresInSeconds: VALIDADE_DA_URL_SEGUNDOS,
      fileName: `acessos-${job.id}.csv`,
    });

    // O DOWNLOAD tambem e auditado, nao so o pedido: o que importa para a
    // LGPD e quando o dado saiu, e ele sai aqui.
    await this.db.auditLog.create({
      data: {
        tenantId: contexto.tenantId,
        actorType: 'USER',
        actorId: contexto.actorId,
        action: 'exports.downloaded',
        target: 'data_export_job',
        targetId: job.id,
        correlationId,
        metadata: { rowCount: job.rowCount },
      },
    });

    return url;
  }

  /** Apaga arquivos vencidos. Chamado pelo agendador. */
  async expurgarVencidos(agora: Date): Promise<number> {
    const vencidos = await this.db.dataExportJob.findMany({
      where: { status: 'COMPLETED', expiresAt: { lte: agora }, objectKey: { not: null } },
      select: { id: true, objectKey: true },
    });

    for (const job of vencidos) {
      if (!job.objectKey) continue;

      await this.storage.deletePrivateObject(job.objectKey);

      // A LINHA FICA, o objeto some: a auditoria precisa saber que a
      // exportacao existiu e quem a pediu, mesmo depois de o arquivo sumir.
      await this.db.dataExportJob.update({
        where: { id: job.id },
        data: { objectKey: null },
      });
    }

    return vencidos.length;
  }

  private async carregarFusos(tenantId: string): Promise<Map<string, string>> {
    const unidades = await this.db.gymUnit.findMany({
      where: { tenantId },
      select: { id: true, timezone: true },
    });

    return new Map(unidades.map((u) => [u.id, u.timezone]));
  }

  private hashDoFiltro(filtros: Record<string, unknown>, periodoExplicito: boolean): string {
    // Chaves ordenadas: `{a,b}` e `{b,a}` sao o mesmo filtro, e sem ordenar
    // eles gerariam hashes diferentes e um 409 falso.
    const relevantes = periodoExplicito
      ? filtros
      : Object.fromEntries(Object.entries(filtros).filter(([k]) => k !== 'de' && k !== 'ate'));

    const ordenado = Object.keys(relevantes)
      .sort()
      .map((k) => [k, relevantes[k]]);

    return createHash('sha256').update(JSON.stringify(ordenado)).digest('hex');
  }
}
