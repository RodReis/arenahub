import { Injectable, NotFoundException } from '@nestjs/common';
import {
  resolverConfig,
  type IndicadoresDaUnidade,
  type KioskConfig,
} from '@arenahub/api-contracts';

import { PrismaService } from '../../persistence/prisma.service.js';
import { AccessQueryRepository } from '../access-query/access-query.repository.js';
import { EngagementRankingService } from '../engagement/engagement-ranking.service.js';
import { mesLocal } from '../engagement/domain/movimento-de-xp.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';
import {
  inicioDaJanelaDeTreino,
  inicioDoDiaLocal,
} from './domain/indicadores-da-unidade.js';

/** Mesmo fuso fixo que `domain/indicadores-da-unidade.ts` assume para a academia. */
const FUSO_DA_ACADEMIA = 'America/Sao_Paulo';

/**
 * Nao ha usuario do painel agindo -- quem "age" aqui e o heartbeat do
 * dispositivo, sem sessao de aluno. `audit_logs.actor_id` e anulavel
 * exatamente para isto.
 *
 * A conversao mora AQUI, num lugar so e com nome, em vez de um
 * `as unknown as string` solto no meio do objeto: a divergencia entre o
 * tipo (`string`) e a coluna (`uuid NULL`) fica visivel para quem ler. Mesmo
 * padrao de `kiosk-area-do-aluno.service.ts` -- nao reexportado de la porque
 * e um detalhe interno de cada servico, nao um valor compartilhado.
 */
const SEM_USUARIO = null as unknown as string;

export interface ConfiguracaoResolvida {
  readonly version: number;
  readonly config: KioskConfig;
}

/** Dados que o proprio totem informa no heartbeat. */
export interface DadosDoHeartbeat {
  readonly agentVersion: string;
  /** Relogio local do totem em ms. Zero significa "nao informado". */
  readonly localTimeMs: number;
}

@Injectable()
export class KioskConfigService {
  constructor(
    private readonly db: PrismaService,
    private readonly eventos: AccessQueryRepository,
    private readonly ranking: EngagementRankingService,
  ) {}

  /**
   * Resolve as tres camadas (ADR-042, Decisao 8) para ESTE dispositivo.
   *
   * So versao PUBLICADA entra: rascunho e a linha sem `publishedAt`, e servir
   * rascunho ao totem tiraria da F50 a capacidade de descartar.
   *
   * O `tenantId` vem do contexto -- que vem da credencial. Nao ha caminho em
   * que o totem de um tenant leia a configuracao de outro.
   */
  async resolverParaDispositivo(contexto: ContextoDoKiosk): Promise<ConfiguracaoResolvida> {
    const publicadas = await this.db.kioskConfiguration.findMany({
      where: {
        tenantId: contexto.tenantId,
        publishedAt: { not: null },
        OR: [
          { gymUnitId: null, kioskDeviceId: null },
          { gymUnitId: contexto.gymUnitId, kioskDeviceId: null },
          { gymUnitId: contexto.gymUnitId, kioskDeviceId: contexto.kioskDeviceId },
        ],
      },
      // Ordem EXPLICITA: `KioskConfiguration` e append-only (sem updatedAt, a
      // unique constraint [tenantId, gymUnitId, kioskDeviceId, version] so
      // permite INSERT) -- mas o motor NAO garante ordem de retorno sem
      // `ORDER BY`, mesmo so com INSERT. Depender da ordem de insercao para
      // achar "a ultima versao" e sorte, nao contrato.
      orderBy: [{ version: 'asc' }],
    });

    const daCamada = (
      gymUnitId: string | null,
      kioskDeviceId: string | null,
    ): { version: number; payload: unknown } | undefined =>
      publicadas.filter((c) => c.gymUnitId === gymUnitId && c.kioskDeviceId === kioskDeviceId).at(-1);

    const camadaTenant = daCamada(null, null);
    const camadaUnidade = daCamada(contexto.gymUnitId, null);
    const camadaDispositivo = daCamada(contexto.gymUnitId, contexto.kioskDeviceId);

    const config = resolverConfig({
      tenant: camadaTenant?.payload,
      unidade: camadaUnidade?.payload,
      dispositivo: camadaDispositivo?.payload,
    });

    // A unique constraint e [tenantId, gymUnitId, kioskDeviceId, version]:
    // cada camada tem o PROPRIO contador, independente das outras duas. Usar
    // so o maior `version` entre as tres (`.at(-1)` na lista achatada) faz o
    // numero estagnar quando uma camada NOVA e publicada com version baixa
    // (tenant em v5, primeira config de unidade em v1 -- o merge muda, o
    // numero nao) e RECUAR quando a camada mais alta e despublicada.
    //
    // A soma das versoes de cada camada resolve os dois: muda a config
    // efetiva (qualquer camada avança) => a soma muda; nenhuma camada muda
    // => a soma nao muda. So recua se uma camada for despublicada -- o que E
    // uma mudanca real na config efetiva, entao o numero tinha que mudar
    // mesmo.
    const version =
      (camadaTenant?.version ?? 0) + (camadaUnidade?.version ?? 0) + (camadaDispositivo?.version ?? 0);

    return { version, config };
  }

  /**
   * TRAVA 1 do ADR-042, Decisao 5: desligar modulo e no SERVIDOR, nunca no
   * cliente. Endpoint de modulo desligado responde 404 para AQUELE
   * dispositivo -- um kiosk com devtools aberto nao reabilita nada
   * (`M3.5-FR-007`, `M4-FR-018`).
   *
   * 404 e nao 403 de proposito: a mesma disciplina da mensagem neutra de
   * identificacao (ADR-045, Decisao 4). "Existe mas voce nao pode" e uma
   * informacao a mais do que a superficie do totem precisa dar.
   *
   * Vive AQUI, e nao em cada handler, porque a config e a mesma resolucao de
   * tres camadas que o `GET /config` ja faz: duas leituras diferentes do que
   * "esta ligado" divergiriam no primeiro modulo acrescentado.
   */
  async exigirModulo(
    contexto: ContextoDoKiosk,
    modulo: keyof KioskConfig['modulos'],
  ): Promise<KioskConfig> {
    const { config } = await this.resolverParaDispositivo(contexto);

    if (!config.modulos[modulo]) {
      throw new NotFoundException({ code: 'KIOSK_MODULE_DISABLED' });
    }

    return config;
  }

  /**
   * Carimba o heartbeat do dispositivo. Fica no servico (nao no controller)
   * porque controller so valida e delega -- nao fala com banco (convencao do
   * projeto, `CLAUDE.md`).
   */
  async registrarHeartbeat(
    contexto: ContextoDoKiosk,
    dados: DadosDoHeartbeat,
    agora: Date,
  ): Promise<void> {
    await this.db.kioskDevice.update({
      where: { id: contexto.kioskDeviceId },
      data: {
        lastHeartbeat: agora,
        agentVersion: dados.agentVersion,
        clockOffsetMs: dados.localTimeMs === 0 ? null : dados.localTimeMs - agora.getTime(),
      },
    });
  }

  /**
   * Os numeros do bloco de informacoes da tela publica (F51) + o placar
   * publico (F31, Task 9).
   *
   * VAO NO HEARTBEAT que a F49 ja dispara a cada 30 s, e nao numa rota
   * propria: `M3.5-FR-005` proibe a tela publica depender da rede, e uma
   * requisicao a mais so para o contador seria exatamente essa dependencia.
   * Pegando carona no heartbeat, a tela renderiza com o ultimo valor que
   * chegou -- e continua renderizando quando nenhum chega.
   *
   * As duas contagens vao em paralelo: sao consultas independentes sobre o
   * mesmo indice (`[tenantId, gymUnitId, occurredAt]`), e serializa-las
   * dobraria a latencia de um heartbeat que roda a cada 30 segundos.
   *
   * O PLACAR chega AQUI, ja com os nomes resolvidos no servidor por
   * `EngagementRankingService.lerPlacarPublicado` -- nunca `studentId`
   * (`blocos-publicos.tsx`, F51, trava estrutural). Modulo `xp` desligado ou
   * placar retido/nao publicado devolve lista vazia, nunca ausente: o bloco
   * some do rodizio, nao aparece cinza nem vazio.
   */
  async contarIndicadores(
    contexto: ContextoDoKiosk,
    config: KioskConfig,
    agora: Date,
  ): Promise<IndicadoresDaUnidade> {
    const escopo = { tenantId: contexto.tenantId, gymUnitId: contexto.gymUnitId };

    const [checkinsDeHoje, treinandoAgora, placar] = await Promise.all([
      this.eventos.contarEntradasDaUnidade({
        ...escopo,
        de: inicioDoDiaLocal(agora),
        ate: agora,
      }),
      this.eventos.contarEntradasDaUnidade({
        ...escopo,
        de: inicioDaJanelaDeTreino(agora),
        ate: agora,
      }),
      config.modulos.xp ? this.placarPublico(contexto, agora) : Promise.resolve([]),
    ]);

    return { checkinsDeHoje, treinandoAgora, placar };
  }

  private async placarPublico(contexto: ContextoDoKiosk, agora: Date) {
    const tenantContext: TenantContext = {
      tenantId: contexto.tenantId,
      actorId: SEM_USUARIO,
      sessionId: contexto.kioskDeviceId,
      permissions: new Set<string>(),
      allowedUnitIds: new Set([contexto.gymUnitId]),
    };

    const placar = await this.ranking.lerPlacarPublicado(
      tenantContext,
      contexto.gymUnitId,
      mesLocal(agora, FUSO_DA_ACADEMIA),
    );

    // `lerPlacarPublicado` devolve `readonly [...]`; `IndicadoresDaUnidade`
    // (Zod) infere array mutavel -- copia rasa so para casar o tipo, sem
    // mudar o conteudo.
    return [...placar];
  }
}
