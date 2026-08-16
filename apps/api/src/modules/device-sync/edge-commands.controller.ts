import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';

import { EdgeRoute } from '../edge-auth/edge-route.decorator.js';
import { DeviceSyncRepository } from './device-sync.repository.js';

const esquemaDeResultados = z
  .object({
    results: z
      .array(
        z
          .object({
            commandId: z.string().uuid(),
            success: z.boolean(),
            errorCode: z.string().max(60).optional(),
            /** Relogio do LEITOR, preservado como veio. */
            deviceTimestamp: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

interface ComandoDto {
  id: string;
  sequence: string;
  type: string;
  payload: unknown;
  correlationId: string;
}

/**
 * Protocolo de comandos do Edge.
 *
 * PULL, nao push: o Edge busca. Um PC de academia atras de NAT nao recebe
 * conexao de fora, e mesmo quando recebe, quem esta atras do firewall e
 * quem sabe se esta pronto para executar.
 *
 * Todas as rotas sao autenticadas por assinatura (`@EdgeRoute`), e o
 * `edgeNodeId` sai da credencial -- um Edge nao busca comando de outro nem
 * mandando o id certo.
 */
@Controller('api/v1/edge')
export class EdgeCommandsController {
  constructor(private readonly sync: DeviceSyncRepository) {}

  /**
   * Comandos pendentes, apos uma sequencia.
   *
   * Materializa antes de listar: assim o Edge que acabou de subir encontra
   * trabalho mesmo que nenhuma notificacao tenha chegado enquanto ele estava
   * fora. Socket perdido nao e comando perdido.
   */
  @Get('commands')
  @EdgeRoute()
  async listar(
    @Req() requisicao: Request,
    @Query('after') after?: string,
    @Query('limit') limite?: string,
  ): Promise<{ commands: ComandoDto[] }> {
    const edge = requisicao.edgeContext!;
    const agora = new Date();

    await this.sync.materializarComandos(edge.edgeNodeId, edge.tenantId, agora);

    const take = Math.min(Number(limite) || 50, 50);
    const sequencia = after ? BigInt(after) : 0n;

    const comandos = await this.sync.listarComandosDisponiveis(
      edge.edgeNodeId,
      sequencia,
      take,
      agora,
    );

    return {
      commands: comandos.map((comando) => ({
        id: comando.id,
        // `BigInt` nao serializa em JSON -- vai como string, e o Edge
        // devolve string no `after`.
        sequence: comando.sequence.toString(),
        type: comando.type,
        payload: comando.payload,
        correlationId: comando.correlationId,
      })),
    };
  }

  /**
   * Arrenda o comando por 60 s.
   *
   * Sem lease, dois processos do Edge executariam o mesmo comando no leitor.
   * Com lease expiravel, um Edge que morreu no meio nao trava a fila para
   * sempre.
   */
  @Post('commands/:id/lease')
  @EdgeRoute()
  async arrendar(
    @Param('id') commandId: string,
    @Req() requisicao: Request,
  ): Promise<{ leased: boolean }> {
    const edge = requisicao.edgeContext!;

    const arrendado = await this.sync.arrendarComando(
      edge.edgeNodeId,
      commandId,
      new Date(),
    );

    // `false` nao e erro: outro processo pegou primeiro, e o Edge segue para
    // o proximo comando.
    return { leased: arrendado };
  }

  /**
   * Recebe resultados em lote.
   *
   * IDEMPOTENTE: resultado repetido identico e aceito em silencio. O Edge
   * pode ter executado no leitor e morrido antes de reportar -- reenviar
   * precisa ser seguro. Mudar a historia, nao: resultado DIFERENTE para
   * comando ja reconhecido e recusado.
   */
  @Post('sync-results/batch')
  @EdgeRoute()
  async receberResultados(
    @Body() corpo: unknown,
    @Req() requisicao: Request,
  ): Promise<{ accepted: number; conflicts: number }> {
    const dados = esquemaDeResultados.parse(corpo);
    const edge = requisicao.edgeContext!;
    const agora = new Date();

    let aceitos = 0;
    let conflitos = 0;

    for (const resultado of dados.results) {
      const identityId = await this.sync.identidadeDoComando(resultado.commandId);

      const aplicacao = await this.sync.aplicarResultado(
        edge.edgeNodeId,
        resultado,
        agora,
      );

      if (aplicacao.conflito) conflitos += 1;
      else if (aplicacao.aplicado) aceitos += 1;

      // Fecha a identidade se este foi o ultimo dispositivo a confirmar a
      // exclusao (INV-027).
      if (identityId && aplicacao.aplicado) {
        await this.sync.reconciliarExclusao(identityId, agora);
      }
    }

    return { accepted: aceitos, conflicts: conflitos };
  }
}
