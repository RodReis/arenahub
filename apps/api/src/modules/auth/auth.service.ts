import { Injectable } from '@nestjs/common';

import {
  CredencialInvalidaError,
  NaoAutenticadoError,
  RefreshReutilizadoError,
} from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { PasswordService } from './password.service.js';
import { SessionRepository } from './session.repository.js';
import { TokenService } from './token.service.js';

const REFRESH_VALIDO_POR_DIAS = 14;

export interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Envelope de hash usado quando o e-mail nao existe.
 *
 * Sem isso, "e-mail inexistente" responderia na hora e "senha errada"
 * levaria os ~100 ms do scrypt -- e o cronometro do atacante viraria uma
 * lista de quem tem conta na academia. Conferir contra um envelope
 * descartavel iguala os dois caminhos.
 */
const ENVELOPE_FALSO =
  'scrypt$v=1$N=16384$r=8$p=1$AAAAAAAAAAAAAAAAAAAAAA$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly senhas: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessoes: SessionRepository,
  ) {}

  async login(email: string, senha: string): Promise<ParDeTokens> {
    const normalizado = email.trim().toLowerCase();

    const usuario = await this.db.user.findUnique({
      where: { email: normalizado },
      include: { memberships: { where: { status: 'ACTIVE' }, take: 1 } },
    });

    // Conferir mesmo sem usuario, para gastar o mesmo tempo. Ver
    // ENVELOPE_FALSO acima.
    const confere = await this.senhas.conferir(senha, usuario?.passwordHash ?? ENVELOPE_FALSO);

    if (!usuario || !confere || usuario.status !== 'ACTIVE') {
      throw new CredencialInvalidaError();
    }

    const vinculo = usuario.memberships[0];

    if (!vinculo) throw new CredencialInvalidaError();

    return this.emitirPar({ userId: usuario.id, tenantId: vinculo.tenantId });
  }

  /**
   * Troca o refresh por um par novo, detectando reuso.
   *
   * O caso interessante nao e o token valido -- e o token JA ROTACIONADO
   * que reaparece. Ele so pode ter vindo de uma copia, entao a familia
   * inteira cai.
   */
  async refresh(tokenRecebido: string): Promise<ParDeTokens> {
    const tokenHash = this.tokens.calcularHashDeRefresh(tokenRecebido);
    const sessao = await this.sessoes.encontrarPorHash(tokenHash);

    if (!sessao) throw new NaoAutenticadoError();

    if (sessao.status !== 'ACTIVE') {
      // Rotacionado ou revogado. Nos dois casos a familia cai: se foi
      // reuso, corta o ladrao; se ja estava revogada, a operacao e inocua.
      await this.sessoes.revogarFamilia(sessao.familyId, 'refresh_reused');
      throw new RefreshReutilizadoError();
    }

    if (sessao.expiresAt.getTime() <= Date.now()) {
      await this.sessoes.revogar(sessao.id, 'expired');
      throw new NaoAutenticadoError();
    }

    const { token, tokenHash: novoHash } = this.tokens.gerarRefresh();

    const novaSessaoId = await this.sessoes.rotacionar({
      sessaoAtualId: sessao.id,
      familyId: sessao.familyId,
      userId: sessao.userId,
      tenantId: sessao.tenantId,
      novoTokenHash: novoHash,
      validoAte: this.validadeDoRefresh(),
    });

    return {
      accessToken: this.tokens.emitirAcesso({
        sub: sessao.userId,
        tenantId: sessao.tenantId,
        sessionId: novaSessaoId,
        permissions: [],
        mfa: false,
      }),
      refreshToken: token,
    };
  }

  /**
   * Encerra a sessao no servidor.
   *
   * Limpar o cookie sozinho nao e logout: quem tiver copiado o refresh
   * continua entrando. O que encerra e a revogacao aqui.
   */
  async logout(tokenRecebido: string | undefined): Promise<void> {
    if (!tokenRecebido) return;

    const sessao = await this.sessoes.encontrarPorHash(
      this.tokens.calcularHashDeRefresh(tokenRecebido),
    );

    if (sessao) await this.sessoes.revogarFamilia(sessao.familyId, 'logout');
  }

  async perfil(userId: string): Promise<{ id: string; email: string }> {
    const usuario = await this.db.user.findUnique({
      where: { id: userId },
      // `select` explicito, e nao `findUnique` puro: o objeto inteiro traria
      // `passwordHash` e os campos de MFA para uma resposta HTTP.
      select: { id: true, email: true },
    });

    if (!usuario) throw new NaoAutenticadoError();

    return usuario;
  }

  private async emitirPar(dados: { userId: string; tenantId: string }): Promise<ParDeTokens> {
    const { token, tokenHash } = this.tokens.gerarRefresh();

    const sessionId = await this.sessoes.abrir({
      userId: dados.userId,
      tenantId: dados.tenantId,
      tokenHash,
      validoAte: this.validadeDoRefresh(),
    });

    return {
      accessToken: this.tokens.emitirAcesso({
        sub: dados.userId,
        tenantId: dados.tenantId,
        sessionId,
        permissions: [],
        mfa: false,
      }),
      refreshToken: token,
    };
  }

  private validadeDoRefresh(): Date {
    return new Date(Date.now() + REFRESH_VALIDO_POR_DIAS * 24 * 60 * 60 * 1000);
  }
}
