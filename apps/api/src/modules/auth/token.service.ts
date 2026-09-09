import { createHash, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
// `jsonwebtoken` e CommonJS. Sob ESM, `import * as jwt` devolve o objeto de
// namespace, onde as funcoes nao ficam acessiveis -- import default e o que
// entrega o `module.exports` de verdade.
import jwt from 'jsonwebtoken';

export const CONFIG_DE_TOKEN = Symbol('CONFIG_DE_TOKEN');

export interface ConfigDeToken {
  chavePrivada: string;
  chavePublica: string;
  emissor: string;
  audiencia: string;
}

/** Claims do access token. O contrato e fechado: nada entra sem decisao. */
export interface ClaimsDeAcesso {
  sub: string;
  /** Nulo na sessao de plataforma -- o Super Admin nao esta em tenant nenhum. */
  tenantId: string | null;
  sessionId: string;
  permissions: string[];
  mfa: boolean;
  unitIds?: string[];
}

export interface ClaimsDePreAuth {
  sub: string;
  tenantId: string;
  challengeId: string;
  purpose: 'MFA_SETUP' | 'MFA_VERIFY';
}

const ALGORITMO = 'RS256';
const ACESSO_VALIDO_POR_SEGUNDOS = 10 * 60;
const PRE_AUTH_VALIDO_POR_SEGUNDOS = 5 * 60;
const BYTES_DE_REFRESH = 32;

/**
 * Emite e verifica os tres tipos de credencial da sessao.
 *
 * ASSIMETRICO (RS256) e nao HMAC: quem so precisa VERIFICAR token -- o
 * `edge-agent`, um servico futuro -- recebe a chave publica e nao ganha o
 * poder de EMITIR. Com segredo compartilhado, verificar e forjar sao a mesma
 * capacidade.
 */
@Injectable()
export class TokenService {
  constructor(@Inject(CONFIG_DE_TOKEN) private readonly config: ConfigDeToken) {}

  emitirAcesso(claims: ClaimsDeAcesso, opcoes: { validoPorSegundos?: number } = {}): string {
    return jwt.sign({ ...claims }, this.config.chavePrivada, {
      algorithm: ALGORITMO,
      expiresIn: opcoes.validoPorSegundos ?? ACESSO_VALIDO_POR_SEGUNDOS,
      issuer: this.config.emissor,
      audience: this.config.audiencia,
    });
  }

  verificarAcesso(token: string): jwt.JwtPayload & ClaimsDeAcesso {
    const conteudo = this.verificar(token);

    // Pre-auth tem `purpose`; access token nao. Sem esta checagem, o token
    // de cinco minutos que so deveria completar o MFA passaria por
    // credencial completa -- e exigir segundo fator viraria decoracao.
    if ('purpose' in conteudo) {
      throw new jwt.JsonWebTokenError('token pre-auth usado como token de acesso');
    }

    return conteudo as jwt.JwtPayload & ClaimsDeAcesso;
  }

  emitirPreAuth(claims: ClaimsDePreAuth): string {
    return jwt.sign(claims, this.config.chavePrivada, {
      algorithm: ALGORITMO,
      expiresIn: PRE_AUTH_VALIDO_POR_SEGUNDOS,
      issuer: this.config.emissor,
      audience: this.config.audiencia,
    });
  }

  verificarPreAuth(token: string): jwt.JwtPayload & ClaimsDePreAuth {
    const conteudo = this.verificar(token);

    if (!('purpose' in conteudo)) {
      throw new jwt.JsonWebTokenError('token de acesso usado como pre-auth');
    }

    return conteudo as jwt.JwtPayload & ClaimsDePreAuth;
  }

  /**
   * Refresh token e opaco: 32 bytes aleatorios, sem conteudo. O que o banco
   * guarda e o SHA-256 -- assim, vazar a tabela nao entrega sessao.
   */
  gerarRefresh(): { token: string; tokenHash: string } {
    const token = randomBytes(BYTES_DE_REFRESH).toString('base64url');

    return { token, tokenHash: this.calcularHashDeRefresh(token) };
  }

  calcularHashDeRefresh(token: string): string {
    // SHA-256 sem sal e correto aqui, e so aqui: a entrada tem 256 bits de
    // aleatoriedade real, entao nao ha dicionario a montar. Senha de gente e
    // outra historia -- ver `PasswordService`.
    return createHash('sha256').update(token).digest('hex');
  }

  private verificar(token: string): jwt.JwtPayload {
    const conteudo = jwt.verify(token, this.config.chavePublica, {
      // Lista fixa. Aceitar o algoritmo declarado pelo proprio token e o
      // ataque `alg: none`: assinatura vazia, identidade a escolha de quem
      // pede.
      algorithms: [ALGORITMO],
      issuer: this.config.emissor,
      audience: this.config.audiencia,
    });

    if (typeof conteudo === 'string') {
      throw new jwt.JsonWebTokenError('token sem corpo estruturado');
    }

    return conteudo;
  }
}
