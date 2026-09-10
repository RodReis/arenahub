import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, minutes, seconds, type ThrottlerStorage } from '@nestjs/throttler';

import {
  CredencialInvalidaError,
  LoginBloqueadoPorTentativasError,
  MfaBloqueadoPorTentativasError,
  NaoAutenticadoError,
  RefreshReutilizadoError,
} from '../../common/http/erro-de-dominio.js';
import { PrismaService } from '../../persistence/prisma.service.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { SessionRepository } from './session.repository.js';
import { TokenService } from './token.service.js';

const REFRESH_VALIDO_POR_DIAS = 14;

/**
 * SPEC-058 AC-7: dez tentativas ERRADAS em sequencia recebem 429 antes da
 * decima primeira.
 *
 * "Erradas" e literal -- login bem sucedido nunca soma aqui, entao ninguem
 * legitimo e barrado por logar de novo varias vezes (troca de aba, sessao
 * expirada, etc.). A chave e (IP + e-mail tentado): so IP puniria toda a
 * rede de uma academia pelo erro de uma pessoa; so e-mail deixaria um
 * atacante trocar de IP e continuar.
 */
const JANELA_DE_FORCA_BRUTA_MS = minutes(1);
const LIMITE_DE_TENTATIVAS_ERRADAS = 10;
const BLOQUEIO_APOS_LIMITE_MS = seconds(60);

/**
 * Issue #296: as rotas de MFA nao contavam tentativa nenhuma. Limite mais
 * baixo que o do login (LIMITE_DE_TENTATIVAS_ERRADAS) porque um TOTP de seis
 * digitos tem espaco de busca bem menor que uma senha.
 */
const JANELA_DE_FORCA_BRUTA_MFA_MS = minutes(1);
const LIMITE_DE_TENTATIVAS_ERRADAS_MFA = 5;
const BLOQUEIO_APOS_LIMITE_MFA_MS = seconds(60);

export interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Desafio de segundo fator. So o Super Admin recebe isto -- ver `login`.
 *
 * O par de tokens NAO acompanha: entregar sessao junto com o desafio faria
 * do segundo fator decoracao.
 */
export interface DesafioDeMfa {
  desafio: 'MFA_SETUP' | 'MFA_VERIFY';
  preAuth: string;
}

export type ResultadoDeLogin = ParDeTokens | DesafioDeMfa;

export function ehDesafioDeMfa(resultado: ResultadoDeLogin): resultado is DesafioDeMfa {
  return 'desafio' in resultado;
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
    private readonly mfa: MfaService,
    @InjectThrottlerStorage() private readonly forcaBruta: ThrottlerStorage,
  ) {}

  async login(email: string, senha: string, ip: string): Promise<ResultadoDeLogin> {
    const normalizado = email.trim().toLowerCase();
    const chaveDeForcaBruta = `${ip}:${normalizado}`;

    const usuario = await this.db.user.findUnique({
      where: { email: normalizado },
      include: { memberships: { where: { status: 'ACTIVE' }, take: 1 }, platformAdmin: true },
    });

    // Conferir mesmo sem usuario, para gastar o mesmo tempo. Ver
    // ENVELOPE_FALSO acima.
    const confere = await this.senhas.conferir(senha, usuario?.passwordHash ?? ENVELOPE_FALSO);

    const vinculo = usuario?.memberships[0];
    // ATIVO: revogar e escrever `revokedAt`, nunca deletar. Sem esta
    // checagem, ex-dono do SaaS continuaria entrando pelo ramo de plataforma.
    const admin =
      usuario?.platformAdmin && usuario.platformAdmin.revokedAt === null
        ? usuario.platformAdmin
        : undefined;

    /*
     * O Super Admin nao tem `TenantMembership` -- ele nao pertence a tenant
     * nenhum. Sem esta alternativa ele cairia na recusa abaixo por falta de
     * vinculo, e o dono do SaaS nunca conseguiria entrar.
     */
    if (!usuario || !confere || usuario.status !== 'ACTIVE' || (!vinculo && !admin)) {
      // So a tentativa ERRADA soma contra o limite (AC-7). Login valido
      // nunca chama `increment`: sessao repetida (troca de aba, sessao
      // expirada) nao e o que este limite existe para conter.
      const registro = await this.forcaBruta.increment(
        chaveDeForcaBruta,
        JANELA_DE_FORCA_BRUTA_MS,
        LIMITE_DE_TENTATIVAS_ERRADAS,
        BLOQUEIO_APOS_LIMITE_MS,
        'login-bruteforce',
      );

      if (registro.isBlocked) throw new LoginBloqueadoPorTentativasError();

      throw new CredencialInvalidaError();
    }

    /*
     * INV-007: MFA obrigatorio para o dono do SaaS -- e SO para ele.
     *
     * Um fator nao abre sessao de plataforma: o que sai daqui e um pre-auth
     * de cinco minutos que so serve para completar o segundo fator. Ligar
     * MFA para OWNER, MANAGER, RECEPTIONIST e TECH_OPERATOR quebraria o
     * login de toda a base existente -- e fatia de migracao propria.
     */
    if (admin) {
      const purpose = usuario.mfaStatus === 'ENABLED' ? 'MFA_VERIFY' : 'MFA_SETUP';

      return {
        desafio: purpose,
        preAuth: this.tokens.emitirPreAuth({
          sub: usuario.id,
          // Sessao de plataforma nao tem tenant.
          tenantId: null,
          challengeId: randomUUID(),
          purpose,
        }),
      };
    }

    if (!vinculo) throw new CredencialInvalidaError();

    return this.emitirPar({ userId: usuario.id, tenantId: vinculo.tenantId });
  }

  /**
   * Troca o pre-auth pelo par definitivo, conferindo o TOTP.
   *
   * A sessao nasce com `tenantId: null` -- e sessao de PLATAFORMA, e e isso
   * que o `AuthGuard` le para montar `PlatformContext` em vez de contexto de
   * tenant.
   */
  async verificarMfa(preAuth: string, codigo: string): Promise<ParDeTokens> {
    // `MFA_VERIFY` EXATO: um pre-auth de SETUP prova que a pessoa tem a
    // senha, nao que tem o segundo fator -- ele nao pode virar sessao aqui.
    const usuarioId = await this.exigirPreAuthDeAdmin(preAuth, 'MFA_VERIFY');

    await this.conferirCodigoMfaComForcaBruta(usuarioId, () => this.mfa.verificar(usuarioId, codigo));

    return this.emitirPar({ userId: usuarioId, tenantId: null });
  }

  /**
   * Comeca a inscricao no TOTP a partir do pre-auth de SETUP.
   *
   * SEM ISTO O SUPER ADMIN SEM MFA FICA TRANCADO FORA (issue #293). O login
   * dele devolve `MFA_SETUP`, e as rotas de inscricao que existiam
   * (`iam.controller.ts`) exigem `TenantContextService.require()` -- que
   * lanca para quem nao tem tenant, e o Super Admin nao tem nenhum. Nao
   * havia caminho: a unica saida era cadastrar o segredo pelo seed.
   *
   * NAO devolve sessao. Quem chama aqui provou a senha e mais nada; a sessao
   * so nasce em `confirmarInscricaoDeMfa`, depois que a pessoa provar que o
   * autenticador dela gera um codigo valido. Ativar antes deixaria o dono do
   * SaaS trancado fora da conta se o autenticador nao tivesse lido o segredo.
   */
  async iniciarInscricaoDeMfa(preAuth: string): Promise<{ uri: string; base32: string }> {
    const usuarioId = await this.exigirPreAuthDeAdmin(preAuth, 'MFA_SETUP');

    const usuario = await this.db.user.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { email: true },
    });

    return this.mfa.iniciarInscricao(usuarioId, usuario.email);
  }

  /**
   * Confirma a inscricao e ABRE a sessao -- os dois no mesmo passo.
   *
   * Exigir um login novo depois de confirmar seria pedir o TOTP duas vezes
   * seguidas: a pessoa acabou de provar posse do segundo fator com um codigo
   * que o servidor conferiu. O codigo tambem nao serviria de novo -- o
   * `mfaLastCounter` gravado aqui o recusa como REPLAY.
   */
  async confirmarInscricaoDeMfa(preAuth: string, codigo: string): Promise<ParDeTokens> {
    const usuarioId = await this.exigirPreAuthDeAdmin(preAuth, 'MFA_SETUP');

    await this.conferirCodigoMfaComForcaBruta(usuarioId, () =>
      this.mfa.confirmarInscricao(usuarioId, codigo),
    );

    return this.emitirPar({ userId: usuarioId, tenantId: null });
  }

  /**
   * Guarda comum das tres rotas de segundo fator: valida o pre-auth, exige o
   * `purpose` EXATO e confere que o dono ainda e Super Admin ativo.
   *
   * Uma funcao so, e nao a checagem repetida em cada rota: sao tres pontos
   * onde esquecer o `purpose` transformaria o token de cinco minutos em
   * credencial completa. O `purpose` entra por parametro em vez de ser
   * inferido porque o erro perigoso e aceitar o outro tipo -- um pre-auth de
   * SETUP nao pode abrir sessao em `verificarMfa`, e um de VERIFY nao pode
   * reinscrever o segredo de quem ja tem MFA ativo, apagando o autenticador
   * que funciona.
   */
  private async exigirPreAuthDeAdmin(
    preAuth: string,
    purpose: 'MFA_SETUP' | 'MFA_VERIFY',
  ): Promise<string> {
    let claims;

    try {
      claims = this.tokens.verificarPreAuth(preAuth);
    } catch {
      throw new NaoAutenticadoError();
    }

    if (claims.purpose !== purpose) throw new NaoAutenticadoError();

    const admin = await this.db.platformAdmin.findFirst({
      where: { userId: claims.sub, revokedAt: null },
    });

    // Revogacao vale na hora, mesmo com pre-auth ja emitido.
    if (!admin) throw new NaoAutenticadoError();

    return claims.sub;
  }

  /**
   * Molde do `forcaBruta.increment` do login (issue #296), aplicado ao
   * segundo fator.
   *
   * Chave e o `sub` do pre-auth, nao o `challengeId`: o `challengeId` nao e
   * persistido em lugar nenhum, muda a cada login, e nao amarraria tentativas
   * entre pre-auths sucessivos do mesmo atacante.
   *
   * Diferente do login: soma TODA tentativa, nao so a errada. A
   * `ThrottlerStorage` da lib so expoe `increment` (sem leitura isolada), e
   * um contador que so soma em erro nunca travaria um codigo CERTO acertado
   * depois do limite estourado -- o proprio ataque que este limite existe
   * para conter escaparia na tentativa que funciona. A chave e por usuario
   * (sub), entao isto nao pune ninguem pelo erro de outro Super Admin.
   */
  private async conferirCodigoMfaComForcaBruta(
    usuarioId: string,
    conferir: () => Promise<void>,
  ): Promise<void> {
    const registro = await this.forcaBruta.increment(
      `mfa:${usuarioId}`,
      JANELA_DE_FORCA_BRUTA_MFA_MS,
      LIMITE_DE_TENTATIVAS_ERRADAS_MFA,
      BLOQUEIO_APOS_LIMITE_MFA_MS,
      'mfa-bruteforce',
    );

    if (registro.isBlocked) throw new MfaBloqueadoPorTentativasError();

    await conferir();
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

  /**
   * Nome de exibicao do tenant, para a faixa de suporte.
   *
   * Devolve `null` em vez de lancar: o tenant sumir entre a elevacao e a
   * leitura e improvavel, e derrubar o `/auth/me` por causa do rotulo de uma
   * faixa trocaria um aviso ausente por um painel inteiro fora do ar.
   */
  async nomeDoTenant(tenantId: string): Promise<string | null> {
    const tenant = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: { displayName: true },
    });

    return tenant?.displayName ?? null;
  }

  private async emitirPar(dados: {
    userId: string;
    /** Nulo na sessao de PLATAFORMA. */
    tenantId: string | null;
  }): Promise<ParDeTokens> {
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
