import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import { inicioDoDiaLocal } from '../health/domain/periodo.js';
import {
  PORTA_DE_UNIDADES_DE_RETENCAO,
  type PortaDeUnidadesDeRetencao,
} from './retention-scheduler.repository.js';
import { RetentionSnapshotsService } from './retention-snapshots.service.js';
import { RetentionScoresService } from './retention-scores.service.js';
import { RetentionTasksService } from './retention-tasks.service.js';

/** Sem usuario de painel agindo -- quem "age" e o proprio job. Mesmo padrao
 * de `EngagementRankingSchedulerService.SEM_USUARIO`. */
const SEM_USUARIO = null as unknown as string;

/** Versoes do catalogo de features usadas pela materializacao diaria. */
const VERSAO_DE_ALVO = 'v1';
const VERSAO_DE_FEATURES = 'v1';

export interface ResultadoDoCiclo {
  readonly tenants: number;
  readonly processados: number;
  readonly falhas: number;
}

/**
 * Job diario do pipeline de retencao -- fecha snapshot -> score -> fila
 * (F75, SPEC-075, #341).
 *
 * ESPELHA `EngagementRankingSchedulerService` (F35) de proposito -- mesmo
 * precedente, mesmas quatro garantias: `@Cron` ja ligado em `app.module.ts`;
 * trava de reentrada NO PROCESSO; `agora` INJETADO; falha de um tenant NAO
 * derruba os outros.
 *
 * UM TENANT, UMA EXECUCAO -- nao uma por unidade. Os services de retention
 * (`elegiveis`, `calcular`, `pontuarDia`, `gerarFila`) operam por TENANT
 * inteiro (a politica de capacidade da fila e por unidade DENTRO deles), e
 * repetir por unidade reprocessaria o mesmo aluno. O fuso usado para o dia
 * civil e o da PRIMEIRA unidade ativa do tenant (decisao do PI, SPEC-075 §2)
 * -- a imensa maioria dos tenants tem uma unidade so ou o mesmo fuso.
 */
@Injectable()
export class RetentionSchedulerService {
  private readonly log = new Logger(RetentionSchedulerService.name);

  /** Trava de reentrada -- ver `AlertSchedulerService.avaliando`. */
  private executando = false;

  constructor(
    @Inject(PORTA_DE_UNIDADES_DE_RETENCAO) private readonly unidades: PortaDeUnidadesDeRetencao,
    private readonly snapshots: RetentionSnapshotsService,
    private readonly scores: RetentionScoresService,
    private readonly tasks: RetentionTasksService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'pipeline-diario-de-retencao' })
  async executarCicloComTrava(): Promise<void> {
    if (this.executando) {
      this.log.warn('ciclo anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.executando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.executando = false;
    }
  }

  /**
   * Um ciclo completo. `agora` injetado -- o teste nao espera um dia.
   *
   * Sequencia por tenant, no dia civil local dele: `elegiveis` -> `calcular`
   * (aluno a aluno, falha isolada) -> `pontuarDia` -> `gerarFila`. Nenhum
   * passo novo de idempotencia: os tres services ja sao idempotentes por
   * construcao (chave unica / kill switch das F36-F38).
   */
  async executarCiclo(agora: Date): Promise<ResultadoDoCiclo> {
    const unidades = await this.unidades.unidadesAtivasComTimezone();

    const primeiraUnidadePorTenant = new Map<string, { gymUnitId: string; timezone: string }>();
    for (const unidade of unidades) {
      if (!primeiraUnidadePorTenant.has(unidade.tenantId)) {
        primeiraUnidadePorTenant.set(unidade.tenantId, unidade);
      }
    }

    let processados = 0;
    let falhas = 0;

    for (const [tenantId, unidade] of primeiraUnidadePorTenant) {
      try {
        await this.processarTenant(tenantId, unidade.timezone, agora);
        processados += 1;
      } catch (erro: unknown) {
        falhas += 1;

        // Sem o objeto de erro cru: pode carregar trecho de query com dado
        // de aluno. tenant basta para investigar.
        this.log.error(
          `falha ao fechar pipeline de retencao do tenant ${tenantId}: ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return { tenants: primeiraUnidadePorTenant.size, processados, falhas };
  }

  private async processarTenant(tenantId: string, timezone: string, agora: Date): Promise<void> {
    const contexto: TenantContext = {
      tenantId,
      actorId: SEM_USUARIO,
      sessionId: 'retention-scheduler',
      permissions: new Set<string>(),
      allowedUnitIds: 'ALL',
    };

    const observadoEm = inicioDoDiaLocal(agora, timezone);
    const recorte = { observadoEm, corteDeConhecimento: agora };

    const elegiveis = await this.snapshots.elegiveis(contexto, observadoEm);

    // Falha de UM aluno nao interrompe os demais -- mesmo padrao de
    // isolamento do fechamento de ranking, em granularidade mais fina.
    for (const studentId of elegiveis) {
      try {
        await this.snapshots.calcular(contexto, studentId, recorte, {
          alvo: VERSAO_DE_ALVO,
          features: VERSAO_DE_FEATURES,
        });
      } catch (erro: unknown) {
        this.log.error(
          `falha ao calcular snapshot do aluno ${studentId} (tenant ${tenantId}): ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    await this.scores.pontuarDia(contexto, observadoEm);
    await this.tasks.gerarFila(contexto, agora);
  }
}
