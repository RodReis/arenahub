import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiNoContentResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentSessionGuard } from '../student-identity/student-session.guard.js';
import { sanitizarTelemetria } from './domain/telemetria-do-canal.js';

/**
 * ---------------------------------------------------------------------------
 * TELEMETRIA DO CANAL -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * O UNICO dado que sai do aparelho do aluno sem ele pedir. Por isso a
 * fronteira e allowlist: `sanitizarTelemetria` constroi a saida campo a campo
 * a partir de literais, e o que o app mandou a mais morre aqui.
 *
 * ATRAS DO GUARD DE SESSAO, mas o evento NAO carrega quem e o aluno. Os dois
 * fatos convivem de proposito:
 *
 *   - o guard existe para o endpoint nao virar um ralo aberto onde qualquer
 *     um despeja volume;
 *   - o EVENTO nao leva `studentId` porque a metrica do piloto e "quantos
 *     logins falharam", nunca "quem falhou".
 *
 * O corpo entra como `unknown` (`CLAUDE.md`, Stack): ele vem de um cliente
 * que nao controlamos, e confiar no formato dele e o mesmo erro de confiar em
 * corpo de requisicao qualquer.
 */
@Public()
@UseGuards(StudentSessionGuard)
@Controller('api/v1/mobile/telemetria')
export class MobileTelemetriaController {
  /**
   * `204`, sem corpo: o app nao tem o que fazer com a resposta, e devolver o
   * evento sanitizado so gastaria banda para ecoar o que ele mandou.
   *
   * Evento invalido responde `400` em vez de ser descartado em silencio --
   * silencio esconderia app emitindo evento que ninguem mede, e uma metrica
   * que some sem barulho e pior do que uma que nunca existiu.
   */
  @Post()
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Evento aceito.' })
  registrar(@Req() requisicao: Request, @Body() corpo: unknown): void {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    const evento = sanitizarTelemetria(corpo);

    /*
     * O PROVEDOR REAL AINDA NAO EXISTE -- `M4-DIST-01` esta aberto e o
     * provedor de crash entra com ele.
     *
     * O evento sanitizado para aqui, de proposito: a fronteira e o que
     * precisava existir agora, porque e ela que decide o que PODE sair. Ligar
     * um provedor sem ela e que seria a ordem errada -- o vazamento
     * aconteceria antes de alguem escrever a regra.
     *
     * Quando o adapter entrar, ele recebe `evento` e nada mais: o objeto ja
     * esta limpo, e esta e a unica forma dele que existe.
     */
    void evento;
  }
}
