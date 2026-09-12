import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { NaoAutenticadoError } from '../../common/http/erro-de-dominio.js';
import { TokenService } from '../auth/token.service.js';
import { StudentSessionRepository } from './student-session.repository.js';
import type { StudentChannelContext } from './student-identity.service.js';

declare module 'express' {
  interface Request {
    /** Preenchido pelo `StudentSessionGuard` -- so no canal mobile. */
    studentContext?: StudentChannelContext;
  }
}

/**
 * Valida o access token do APP DO ALUNO e monta o contexto da requisicao.
 *
 * NAO e global: o guard global do painel (`AuthGuard`) continua cuidando de
 * todo o resto, e as rotas mobile saem dele por `@Public()` para entrar
 * neste. Duas portas diferentes para dois sujeitos diferentes.
 *
 * TRES diferencas em relacao ao guard do painel, e nenhuma e estilo:
 *
 * 1. Le `Authorization: Bearer`, nao cookie. O app nao tem cookie jar, e
 *    guardar credencial em cookie num WebView seria pior que no SecureStore.
 *
 * 2. EXIGE `canal: 'MOBILE'`. Sem isso, um token do painel -- assinado pela
 *    mesma chave -- abriria as rotas do aluno com as permissoes de
 *    funcionario que o app nem sabe interpretar.
 *
 * 3. Confere a SESSAO NO BANCO a cada requisicao. O access token vale 10
 *    minutos; ler so ele faria uma sessao revogada continuar valendo por ate
 *    10 minutos, e revogacao remota (`M4-AC-002`) e justamente o caso em que
 *    a demora e o problema.
 */
@Injectable()
export class StudentSessionGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly sessoes: StudentSessionRepository,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const requisicao = contexto.switchToHttp().getRequest<Request>();
    const token = this.lerBearer(requisicao.headers.authorization);

    if (!token) throw new NaoAutenticadoError();

    try {
      const claims = this.tokens.verificarAcesso(token);

      if (claims.canal !== 'MOBILE') throw new NaoAutenticadoError();
      if (!claims.tenantId || !claims.studentId) throw new NaoAutenticadoError();

      const sessao = await this.sessoes.encontrarPorId(claims.sessionId);

      // `ROTATED` tambem vale: o elo anterior segue servindo o access token
      // que ja foi emitido, ate ele expirar. So `REVOKED` e o fim.
      if (!sessao || sessao.status === 'REVOKED') throw new NaoAutenticadoError();

      requisicao.studentContext = {
        tenantId: claims.tenantId,
        studentId: claims.studentId,
        accountId: sessao.accountId,
        sessionId: sessao.id,
        reauthenticatedAt: sessao.reauthenticatedAt,
      };
    } catch {
      // Token invalido, expirado, de outro canal ou sessao revogada dao a
      // MESMA resposta: quem sonda nao aprende qual dos casos ocorreu.
      throw new NaoAutenticadoError();
    }

    return true;
  }

  private lerBearer(cabecalho: string | undefined): string | null {
    if (!cabecalho) return null;

    const [esquema, valor] = cabecalho.split(' ');
    if (esquema?.toLowerCase() !== 'bearer' || !valor) return null;

    return valor;
  }
}
