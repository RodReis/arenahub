import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { Public } from '../../common/security/public.decorator.js';
import { StudentAccountRepository } from './student-account.repository.js';
import { StudentIdentityService } from './student-identity.service.js';
import { StudentSessionGuard } from './student-session.guard.js';
import {
  ativarDto,
  confirmarRecuperacaoDto,
  loginDto,
  recuperacaoDto,
  reautenticarDto,
  refreshDto,
} from './dto/mobile-auth.dto.js';

/**
 * Esquema do par de tokens, declarado a mao.
 *
 * O Nest so infere schema de CLASSE decorada, e este modulo usa `interface`
 * -- mesmo caminho do `auth.controller.ts`. A guarda de contrato
 * (`openapi.int-spec.ts`) reprova rota sem `@ApiOkResponse`.
 */
const ESQUEMA_DA_SESSAO = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    sessionId: { type: 'string' },
    expiraEm: { type: 'number' },
  },
  required: ['accessToken', 'refreshToken', 'sessionId', 'expiraEm'],
};

/**
 * Confirmacao sem dado -- para rota que so faz efeito.
 *
 * Poderia ser 204 sem corpo, e foi assim na primeira versao. A guarda de
 * contrato (`openapi.int-spec.ts`) reprova rota NOVA sem schema de resposta,
 * e ela tem razao: 204 vazio nao distingue "o servidor entendeu e fez" de "o
 * servidor nao respondeu nada", e o app precisa dessa diferenca para decidir
 * se mostra erro ou segue.
 */
const ESQUEMA_OK = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

const ESQUEMA_ACEITO = {
  type: 'object',
  properties: { aceito: { type: 'boolean' } },
  required: ['aceito'],
};

/**
 * Autenticacao do APP DO ALUNO -- F23.
 *
 * TOKEN NO CORPO, nao em cookie -- e a diferenca visivel em relacao ao
 * `auth.controller.ts` do painel. O painel usa cookie HttpOnly porque o
 * inimigo la e XSS lendo `localStorage`; aqui o cliente e um app nativo, que
 * nao tem cookie jar nem DOM, e guarda o refresh no SecureStore do sistema.
 * Devolver cookie para o app seria dar uma credencial que ele nao sabe
 * guardar direito.
 *
 * Todas as rotas daqui sao `@Public()` em relacao ao guard GLOBAL do painel
 * -- elas nao tem cookie e seriam barradas antes de comecar. As que exigem
 * aluno autenticado usam o `StudentSessionGuard`, que le `Bearer`.
 */
@Controller('api/v1/mobile/auth')
export class StudentAuthController {
  constructor(
    private readonly identidade: StudentIdentityService,
    private readonly contas: StudentAccountRepository,
  ) {}

  /** Ativa a conta e define a PRIMEIRA senha -- `M4-FR-001`, `M4-AC-001`. */
  @Public()
  @Post('activate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Conta ativada.', schema: ESQUEMA_OK })
  async ativar(@Body() corpo: unknown) {
    const { token, senha } = ativarDto.parse(corpo);
    await this.identidade.ativar({ token, senha, agora: new Date() });
    return { ok: true };
  }

  /** Login -- `M4-FR-002`, resposta indistinguivel. */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sessao aberta.', schema: ESQUEMA_DA_SESSAO })
  async entrar(@Body() corpo: unknown) {
    const entrada = loginDto.parse(corpo);

    // Slug inexistente devolve `null`, e o servico segue ate o fim com o
    // hash descartavel. Recusar aqui responderia mais rapido para academia
    // que nao existe -- e isso enumera os tenants.
    const tenantId = await this.contas.resolverTenantPorSlug(entrada.tenantSlug);

    return this.identidade.entrar({
      tenantId,
      identificador: entrada.identificador,
      senha: entrada.senha,
      deviceLabel: entrada.deviceLabel ?? null,
      agora: new Date(),
    });
  }

  /** Rotaciona o refresh. Replay derruba a familia inteira. */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sessao renovada.', schema: ESQUEMA_DA_SESSAO })
  async renovar(@Body() corpo: unknown) {
    const { refreshToken } = refreshDto.parse(corpo);
    return this.identidade.renovar({ refreshToken, agora: new Date() });
  }

  /** Logout -- idempotente, ver o servico. */
  @Public()
  @Post('logout')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Sessao encerrada.', schema: ESQUEMA_OK })
  async sair(@Body() corpo: unknown) {
    const { refreshToken } = refreshDto.parse(corpo);
    await this.identidade.sair({ refreshToken, agora: new Date() });
    return { ok: true };
  }

  /** Pede recuperacao -- sempre aceita, nunca revela. */
  @Public()
  @Post('recovery/request')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Pedido aceito.', schema: ESQUEMA_ACEITO })
  async pedirRecuperacao(@Body() corpo: unknown) {
    const entrada = recuperacaoDto.parse(corpo);
    const tenantId = await this.contas.resolverTenantPorSlug(entrada.tenantSlug);

    return this.identidade.pedirRecuperacao({
      tenantId,
      identificador: entrada.identificador,
      agora: new Date(),
    });
  }

  /** Confirma a recuperacao com senha nova. Revoga todas as sessoes. */
  @Public()
  @Post('recovery/confirm')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Senha redefinida.', schema: ESQUEMA_OK })
  async confirmarRecuperacao(@Body() corpo: unknown) {
    const { token, senha } = confirmarRecuperacaoDto.parse(corpo);
    await this.identidade.confirmarRecuperacao({ token, senha, agora: new Date() });
    return { ok: true };
  }

  /** Confirma a senha de novo, para liberar acao sensivel -- `M4-FR-005`. */
  @Public()
  @UseGuards(StudentSessionGuard)
  @Post('reauthenticate')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Autenticacao confirmada.', schema: ESQUEMA_OK })
  async reautenticar(@Req() requisicao: Request, @Body() corpo: unknown) {
    const ctx = requisicao.studentContext;
    if (!ctx) throw new NaoAutenticadoError();

    const { senha } = reautenticarDto.parse(corpo);
    await this.identidade.reautenticar(ctx, senha, new Date());
    return { ok: true };
  }
}
