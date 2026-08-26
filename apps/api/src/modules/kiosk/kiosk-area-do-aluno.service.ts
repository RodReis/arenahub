import { Injectable } from '@nestjs/common';
import type { KioskConfig } from '@arenahub/api-contracts';

import type { TenantContext } from '../../common/tenant/tenant-context.js';
import type { ContextoDoKiosk } from '../kiosk-auth/kiosk-auth.service.js';
import { KioskConfigService } from './kiosk-config.service.js';
import { KioskSessionService } from './kiosk-session.service.js';

/**
 * Nao ha usuario do painel agindo -- quem age e o aluno, numa sessao
 * efemera. `audit_logs.actor_id` e anulavel exatamente para isto.
 *
 * A conversao mora AQUI, num lugar so e com nome, em vez de um
 * `as unknown as string` solto no meio do objeto: a divergencia entre o
 * tipo (`string`) e a coluna (`uuid NULL`) fica visivel para quem ler.
 */
const SEM_USUARIO = null as unknown as string;

/**
 * O aluno resolvido a partir da SESSAO, nunca da URL.
 *
 * `contexto` e o `TenantContext` que os casos de uso de billing e health
 * exigem; `studentId` e o do dono da sessao.
 */
export interface AlunoDaSessao {
  readonly contexto: TenantContext;
  readonly studentId: string;
  readonly config: KioskConfig;
}

/**
 * A AMARRA DE SEGURANCA DA F52, num lugar so.
 *
 * Todo endpoint de dado de aluno no totem passa por `resolver()`, e ele faz
 * as tres coisas que nenhum handler pode esquecer:
 *
 *  1. **Sessao viva** -- hash do token, `endedAt` nulo, `expiresAt` no
 *     futuro, e o `kioskDeviceId` do proprio totem (`exigirSessaoViva`).
 *  2. **Modulo ligado** -- 404 para aquele dispositivo se estiver desligado
 *     (trava 1 do ADR-042, Decisao 5). Servidor, nunca cliente.
 *  3. **Aluno da sessao** -- o `studentId` sai da linha de `KioskSession`.
 *     Nao ha parametro de aluno em endpoint nenhum desta fatia, e essa
 *     ausencia e o desenho: com id na URL, quem tem uma sessao valida leria
 *     a fatura de qualquer aluno do tenant trocando um UUID.
 *
 * Tres checagens em cada handler seriam tres chances de esquecer uma. Aqui e
 * uma chamada, e quem esquecer nao tem `studentId` para prosseguir.
 */
@Injectable()
export class KioskAreaDoAlunoService {
  constructor(
    private readonly sessions: KioskSessionService,
    private readonly config: KioskConfigService,
  ) {}

  async resolver(
    contexto: ContextoDoKiosk,
    sessionId: string,
    token: string,
    modulo: keyof KioskConfig['modulos'],
    agora: Date,
  ): Promise<AlunoDaSessao> {
    /*
     * O MODULO PRIMEIRO, a sessao depois. Desligado responde 404 sem sequer
     * consultar a sessao -- e o mesmo 404 que um `sessionId` inexistente
     * produz, entao quem sonda de fora nao distingue "modulo desligado" de
     * "sessao invalida". Fosse a sessao primeiro, o par de status
     * (401 vs 404) diria qual dos dois falhou.
     */
    const config = await this.config.exigirModulo(contexto, modulo);
    const sessao = await this.sessions.exigirSessaoViva(contexto, sessionId, token, agora);

    return {
      contexto: this.tenantContext(contexto, sessao.id),
      studentId: sessao.studentId,
      config,
    };
  }

  /**
   * `ContextoDoKiosk` -> `TenantContext`, para chamar caso de uso publico de
   * outro modulo (regra de arquitetura no 9 -- nunca a tabela dele).
   *
   * `permissions` VAZIO, de proposito. O totem nao e um usuario do painel e
   * nao herda papel nenhum: os casos de uso que ele chama sao os que NAO
   * checam permissao internamente (a checagem deles vive no
   * `@RequirePermissions` do controller do painel, que este caminho nao
   * atravessa). Um conjunto povoado aqui seria um papel inventado, e
   * inventar papel para o dispositivo e como se abre um caminho de
   * escalonamento que ninguem releu.
   *
   * `allowedUnitIds` fica na unidade do dispositivo, nunca `'ALL'`: o totem
   * e fisico e pertence a uma recepcao so.
   */
  private tenantContext(contexto: ContextoDoKiosk, sessionId: string): TenantContext {
    return {
      tenantId: contexto.tenantId,
      /*
       * `actorId` VAZIO, e isto foi um defeito real: pus aqui o
       * `kioskDeviceId`, que e UUID e compila, mas `audit_logs.actor_id` tem
       * CHAVE ESTRANGEIRA PARA `users` -- e um `KioskDevice` nao e um
       * `User`. O INSERT de auditoria violava a FK e derrubava a transacao
       * INTEIRA da cobranca: o aluno via "nao foi possivel gerar a cobranca"
       * e ninguem conseguia pagar pelo totem.
       *
       * A coluna e anulavel de proposito, e vazio e a resposta honesta: nao
       * ha usuario agindo. Quem age e o proprio aluno, numa sessao efemera,
       * e `KioskSession` ja guarda o dispositivo e o aluno. O
       * `correlationId` amarra a linha de auditoria a requisicao.
       *
       * O TIPO diz `string` e o BANCO aceita nulo -- e a divergencia e real:
       * `TenantContext.actorId` alimenta `recognizedByUserId`,
       * `evaluatorUserId` e uma duzia de outros campos que sao mesmo de
       * usuario, em doze arquivos. Afrouxar o tipo para `string | null`
       * espalharia ajuste por todos eles, o que atravessa modulo e nao e
       * ajuste de fatia.
       *
       * Preencher isto direito pede `ActorType.DEVICE`, que o enum nao tem.
       * Fica apontado, nao remendado -- e o `null` explicito abaixo e o
       * unico ponto onde a divergencia aparece.
       */
      actorId: SEM_USUARIO,
      sessionId,
      permissions: new Set<string>(),
      allowedUnitIds: new Set([contexto.gymUnitId]),
    };
  }
}
