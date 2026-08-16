import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { OperationsRepository } from './operations.repository.js';

/**
 * Avaliador periodico de alertas -- F11, INV-146.
 *
 * INTERVALO DE 30 s, e o numero nao e arbitrario: o limite de heartbeat e
 * 90 s, entao 30 s garante ao menos duas avaliacoes dentro da janela. Avaliar
 * a cada 90 s deixaria a deteccao levar ate 180 s no pior caso -- tres
 * minutos de catraca parada antes de alguem ficar sabendo.
 *
 * SEM BullMQ. O plano da fatia pede job repetivel distribuido; o `CLAUDE.md`
 * manda usar fila so quando comprovadamente necessaria, e o PI decidiu manter
 * o mecanismo de F8 (Postgres). O que a fila daria aqui -- garantir que so uma
 * instancia avalia -- e resolvido pelo `upsert` idempotente: duas instancias
 * avaliando ao mesmo tempo produzem o MESMO alerta logico, porque o
 * `fingerprint` e unico. Ver `registrarAlertas`.
 */
@Injectable()
export class AlertSchedulerService {
  private readonly log = new Logger(AlertSchedulerService.name);

  /**
   * Trava de reentrada, no processo.
   *
   * Nao substitui a idempotencia do banco -- protege de outra coisa: uma
   * avaliacao que demora mais de 30 s (base grande, banco lento) receberia a
   * proxima por cima e as duas competiriam pelas mesmas linhas. A flag faz o
   * tick seguinte desistir em vez de empilhar.
   */
  private avaliando = false;

  constructor(private readonly operacoes: OperationsRepository) {}

  @Interval('avaliacao-de-alertas', 30_000)
  async avaliar(): Promise<void> {
    if (this.avaliando) {
      this.log.warn('avaliacao anterior ainda em curso; pulando este ciclo');

      return;
    }

    this.avaliando = true;

    try {
      await this.executarCiclo(new Date());
    } finally {
      this.avaliando = false;
    }
  }

  /**
   * Um ciclo completo. `agora` injetado -- o teste nao espera 30 s.
   *
   * Falha de um tenant NAO derruba os outros: um tenant com dado corrompido
   * nao pode cegar o painel de todas as academias. O erro vira log e o laco
   * segue.
   */
  async executarCiclo(agora: Date): Promise<{ tenants: number; falhas: number }> {
    const tenants = await this.operacoes.listarTenantsAtivos();

    let falhas = 0;

    for (const tenantId of tenants) {
      try {
        await this.operacoes.avaliarTenant(tenantId, agora);
      } catch (erro: unknown) {
        falhas += 1;

        // Sem o objeto de erro cru: ele pode carregar trecho de query com
        // dado de aluno. O id do tenant basta para investigar.
        this.log.error(
          `falha ao avaliar alertas do tenant ${tenantId}: ${
            erro instanceof Error ? erro.message : 'erro desconhecido'
          }`,
        );
      }
    }

    return { tenants: tenants.length, falhas };
  }
}
