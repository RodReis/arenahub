import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  CredencialInvalidaError,
  RefreshReutilizadoError,
} from '../../common/http/erro-de-dominio.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { consumirTokenDeUsoUnico } from './domain/token-de-uso-unico.js';
import { decidirRotacao } from './domain/sessao-do-aluno.js';
import { StudentAccountRepository } from './student-account.repository.js';
import { StudentSessionRepository } from './student-session.repository.js';
import { EmailDeAtivacaoService } from './email-de-ativacao.service.js';
import {
  ReautenticacaoNecessariaError,
  SenhaFracaError,
  SessaoExpiradaError,
  SessaoNaoEncontradaError,
  SessaoRevogadaError,
  TokenExpiradoError,
  TokenInvalidoError,
  TokenJaUsadoError,
  TokenRevogadoError,
} from './erros.js';

/** Contexto do aluno autenticado -- so identificador opaco, nunca PII. */
export interface StudentChannelContext {
  readonly tenantId: string;
  readonly studentId: string;
  readonly accountId: string;
  readonly sessionId: string;
  readonly reauthenticatedAt: Date | null;
}

export interface SessaoAberta {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
  readonly expiraEm: number;
}

const ACESSO_EM_SEGUNDOS = 10 * 60;
const REFRESH_EM_DIAS = 30;
const ATIVACAO_EM_HORAS = 72;
const RECUPERACAO_EM_MINUTOS = 30;
const STEP_UP_EM_MINUTOS = 5;

/**
 * Hash descartavel para o caminho do identificador inexistente.
 *
 * Existe para o login GASTAR O MESMO TEMPO quando a conta nao existe. Sem
 * isso, a resposta volta na hora para identificador desconhecido e so depois
 * do scrypt para conhecido -- e a diferenca de tempo enumera a base inteira,
 * mesmo com a mensagem sendo identica. Mensagem igual com tempo diferente nao
 * e antienumeracao, e a aparencia dela.
 */
const ENVELOPE_DESCARTAVEL =
  'scrypt$16384$8$1$0000000000000000000000000000000000000000000000000000000000000000$' +
  '0000000000000000000000000000000000000000000000000000000000000000';

@Injectable()
export class StudentIdentityService {
  private readonly logger = new Logger(StudentIdentityService.name);

  constructor(
    private readonly contas: StudentAccountRepository,
    private readonly sessoes: StudentSessionRepository,
    private readonly senhas: PasswordService,
    private readonly tokens: TokenService,
    private readonly email: EmailDeAtivacaoService,
  ) {}

  /**
   * Emite o convite de ativacao.
   *
   * Chamado pelo painel quando a recepcao cadastra o aluno. O token em CLARO
   * existe so aqui e no e-mail -- o banco guarda apenas o hash.
   */
  async convidar(dados: {
    tenantId: string;
    accountId: string;
    identificador: string;
    agora: Date;
  }): Promise<{ enviado: boolean }> {
    const { token, tokenHash } = this.gerarTokenDeUsoUnico();

    await this.contas.revogarTokensPendentes({
      accountId: dados.accountId,
      purpose: 'ACTIVATION',
    });

    const validoAte = new Date(dados.agora.getTime() + ATIVACAO_EM_HORAS * 3_600_000);
    await this.contas.emitirToken({
      tenantId: dados.tenantId,
      accountId: dados.accountId,
      purpose: 'ACTIVATION',
      tokenHash,
      validoAte,
    });

    const resultado = await this.email.enviarAtivacao({
      destino: dados.identificador,
      token,
      validoAte,
    });

    return { enviado: resultado.enviado };
  }

  /** Ativa a conta e define a primeira senha -- `M4-FR-001`, `M4-AC-001`. */
  async ativar(dados: { token: string; senha: string; agora: Date }): Promise<void> {
    await this.consumirEDefinirSenha({ ...dados, purpose: 'ACTIVATION' });
  }

  /** Confirma a recuperacao com uma senha nova. */
  async confirmarRecuperacao(dados: {
    token: string;
    senha: string;
    agora: Date;
  }): Promise<void> {
    await this.consumirEDefinirSenha({ ...dados, purpose: 'PASSWORD_RESET' });
  }

  /**
   * Login -- `M4-FR-002`, resposta indistinguivel.
   *
   * Identificador inexistente, senha errada e conta desativada saem todos pelo
   * MESMO erro. E o scrypt roda nos tres casos (ver `ENVELOPE_DESCARTAVEL`).
   */
  async entrar(dados: {
    tenantId: string | null;
    identificador: string;
    senha: string;
    deviceLabel: string | null;
    agora: Date;
  }): Promise<SessaoAberta> {
    // `tenantId` nulo = slug de academia inexistente. O caminho segue ate o
    // fim, com o hash descartavel: parar aqui responderia mais rapido para
    // academia que nao existe, e isso enumera os tenants.
    const conta = dados.tenantId
      ? await this.contas.encontrarPorIdentificador(dados.tenantId, dados.identificador)
      : null;

    const envelope = conta?.passwordHash ?? ENVELOPE_DESCARTAVEL;
    const senhaConfere = await this.senhas.conferir(dados.senha, envelope);

    if (!conta || !senhaConfere || conta.status !== 'ACTIVE') {
      throw new CredencialInvalidaError();
    }

    return this.abrirSessao({
      tenantId: conta.tenantId,
      accountId: conta.id,
      studentId: conta.studentId,
      deviceLabel: dados.deviceLabel,
      agora: dados.agora,
    });
  }

  /**
   * Pede recuperacao de senha -- sempre aceita, nunca revela.
   *
   * Responde `{ aceito: true }` para identificador que existe e que nao
   * existe. O envio so acontece quando ha conta.
   */
  async pedirRecuperacao(dados: {
    tenantId: string | null;
    identificador: string;
    agora: Date;
  }): Promise<{ aceito: true }> {
    const conta = dados.tenantId
      ? await this.contas.encontrarPorIdentificador(dados.tenantId, dados.identificador)
      : null;

    if (conta && conta.status === 'ACTIVE') {
      const { token, tokenHash } = this.gerarTokenDeUsoUnico();

      await this.contas.revogarTokensPendentes({
        accountId: conta.id,
        purpose: 'PASSWORD_RESET',
      });

      const validoAte = new Date(dados.agora.getTime() + RECUPERACAO_EM_MINUTOS * 60_000);
      await this.contas.emitirToken({
        tenantId: conta.tenantId,
        accountId: conta.id,
        purpose: 'PASSWORD_RESET',
        tokenHash,
        validoAte,
      });

      await this.email.enviarRecuperacao({
        destino: conta.identifier,
        token,
        validoAte,
      });
    }

    return { aceito: true };
  }

  /** Rotaciona o refresh. Replay derruba a familia inteira. */
  async renovar(dados: { refreshToken: string; agora: Date }): Promise<SessaoAberta> {
    const hash = this.tokens.calcularHashDeRefresh(dados.refreshToken);
    const sessao = await this.sessoes.encontrarPorHash(hash);

    // Token que nao existe em lugar nenhum: nao ha familia a revogar, e
    // "revogada" e a resposta que menos informa a quem esta sondando.
    if (!sessao) throw new SessaoRevogadaError();

    const decisao = decidirRotacao(
      { status: sessao.status, expiresAt: sessao.expiresAt, familyId: sessao.familyId },
      dados.agora,
    );

    if (decisao.acao === 'REVOGAR_FAMILIA') {
      await this.sessoes.revogarFamilia(sessao.familyId, decisao.motivo, dados.agora);
      this.logger.warn(
        `Refresh reutilizado na familia ${sessao.familyId}; sessoes revogadas.`,
      );
      throw new RefreshReutilizadoError();
    }

    if (decisao.acao === 'RECUSAR') {
      throw decisao.motivo === 'SESSAO_EXPIRADA'
        ? new SessaoExpiradaError()
        : new SessaoRevogadaError();
    }

    const conta = await this.contas.encontrarPorId(sessao.accountId);
    if (!conta || conta.status !== 'ACTIVE') throw new SessaoRevogadaError();

    const novo = this.tokens.gerarRefresh();
    const validoAte = new Date(dados.agora.getTime() + REFRESH_EM_DIAS * 86_400_000);

    const novaSessaoId = await this.sessoes.rotacionar({
      sessaoAtualId: sessao.id,
      familyId: sessao.familyId,
      tenantId: sessao.tenantId,
      accountId: sessao.accountId,
      novoTokenHash: novo.tokenHash,
      deviceLabel: sessao.deviceLabel,
      reauthenticatedAt: sessao.reauthenticatedAt,
      validoAte,
      agora: dados.agora,
    });

    return {
      accessToken: this.emitirAcesso({
        tenantId: sessao.tenantId,
        studentId: conta.studentId,
        accountId: conta.id,
        sessionId: novaSessaoId,
      }),
      refreshToken: novo.token,
      sessionId: novaSessaoId,
      expiraEm: ACESSO_EM_SEGUNDOS,
    };
  }

  /**
   * Logout -- idempotente.
   *
   * Sair duas vezes nao e erro: o app pode reenviar depois de uma queda de
   * rede, e responder falha faria a tela mostrar problema onde o objetivo
   * (sessao encerrada) ja foi alcancado.
   */
  async sair(dados: { refreshToken: string; agora: Date }): Promise<void> {
    const hash = this.tokens.calcularHashDeRefresh(dados.refreshToken);
    const sessao = await this.sessoes.encontrarPorHash(hash);
    if (!sessao) return;

    await this.sessoes.revogarFamilia(sessao.familyId, 'LOGOUT', dados.agora);
  }

  async listarSessoes(ctx: StudentChannelContext, agora: Date) {
    const sessoes = await this.sessoes.listarAtivas(ctx.accountId, agora);

    return sessoes.map((s) => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      criadaEm: s.createdAt.toISOString(),
      atual: s.id === ctx.sessionId,
    }));
  }

  /**
   * Revoga UMA sessao do proprio aluno -- `M4-FR-004`, `M4-NFR-006`.
   *
   * Acao sensivel: exige autenticacao recente (`M4-FR-005`).
   */
  async revogarSessao(
    ctx: StudentChannelContext,
    sessaoId: string,
    agora: Date,
  ): Promise<void> {
    this.exigirAutenticacaoRecente(ctx, agora);

    const revogadas = await this.sessoes.revogarDaConta({
      sessaoId,
      accountId: ctx.accountId,
      motivo: 'REMOTE_REVOKE',
      agora,
    });

    // Zero linhas significa "nao existe" OU "nao e do aluno". Um erro so para
    // os dois: distinguir entregaria ids de sessao alheios.
    if (revogadas === 0) throw new SessaoNaoEncontradaError();
  }

  /** Confirma a senha de novo, para liberar acao sensivel -- `M4-FR-005`. */
  async reautenticar(
    ctx: StudentChannelContext,
    senha: string,
    agora: Date,
  ): Promise<void> {
    const conta = await this.contas.encontrarPorId(ctx.accountId);
    const envelope = conta?.passwordHash ?? ENVELOPE_DESCARTAVEL;

    if (!conta || !(await this.senhas.conferir(senha, envelope))) {
      throw new CredencialInvalidaError();
    }

    await this.sessoes.registrarReautenticacao(ctx.sessionId, agora);
  }

  /** `M4-FR-005`: a acao sensivel exige senha confirmada ha pouco. */
  exigirAutenticacaoRecente(ctx: StudentChannelContext, agora: Date): void {
    const desde = ctx.reauthenticatedAt;
    if (!desde) throw new ReautenticacaoNecessariaError();

    const limite = agora.getTime() - STEP_UP_EM_MINUTOS * 60_000;
    if (desde.getTime() < limite) throw new ReautenticacaoNecessariaError();
  }

  private async consumirEDefinirSenha(dados: {
    token: string;
    senha: string;
    purpose: 'ACTIVATION' | 'PASSWORD_RESET';
    agora: Date;
  }): Promise<void> {
    this.exigirSenhaAceitavel(dados.senha);

    const hash = this.tokens.calcularHashDeRefresh(dados.token);
    const registro = await this.contas.encontrarTokenPorHash(hash);

    if (!registro || registro.purpose !== dados.purpose) throw new TokenInvalidoError();

    const veredito = consumirTokenDeUsoUnico(
      {
        status: registro.status,
        expiresAt: registro.expiresAt,
        studentId: registro.account.studentId,
      },
      dados.agora,
    );

    if (!veredito.ok) {
      if (veredito.motivo === 'TOKEN_JA_USADO') throw new TokenJaUsadoError();
      if (veredito.motivo === 'TOKEN_REVOGADO') throw new TokenRevogadoError();
      throw new TokenExpiradoError();
    }

    const passwordHash = await this.senhas.gerarHash(dados.senha);

    const consumiu = await this.contas.consumirTokenEDefinirSenha({
      tokenId: registro.id,
      accountId: registro.accountId,
      passwordHash,
      ativarConta: dados.purpose === 'ACTIVATION',
      agora: dados.agora,
    });

    // A regra pura ja aprovou, mas OUTRA requisicao pode ter consumido o token
    // no intervalo. Quem decide de verdade e a escrita condicionada; este `if`
    // so traduz o resultado dela.
    if (!consumiu) throw new TokenJaUsadoError();

    // Trocar a senha derruba TODAS as sessoes. Quem troca a senha ou esqueceu
    // dela ou desconfia de acesso indevido -- nos dois casos, manter sessao
    // viva em outro aparelho contraria o motivo da troca.
    await this.sessoes.revogarTodasDaConta(
      registro.accountId,
      dados.purpose === 'ACTIVATION' ? 'PASSWORD_CHANGED' : 'PASSWORD_RESET',
      dados.agora,
    );
  }

  private async abrirSessao(dados: {
    tenantId: string;
    accountId: string;
    studentId: string;
    deviceLabel: string | null;
    agora: Date;
  }): Promise<SessaoAberta> {
    const refresh = this.tokens.gerarRefresh();
    const validoAte = new Date(dados.agora.getTime() + REFRESH_EM_DIAS * 86_400_000);

    const sessionId = await this.sessoes.abrir({
      tenantId: dados.tenantId,
      accountId: dados.accountId,
      tokenHash: refresh.tokenHash,
      deviceLabel: dados.deviceLabel,
      validoAte,
      agora: dados.agora,
    });

    return {
      accessToken: this.emitirAcesso({
        tenantId: dados.tenantId,
        studentId: dados.studentId,
        accountId: dados.accountId,
        sessionId,
      }),
      refreshToken: refresh.token,
      sessionId,
      expiraEm: ACESSO_EM_SEGUNDOS,
    };
  }

  /**
   * Access token do canal MOBILE.
   *
   * `canal: 'MOBILE'` nao e decoracao: e o que impede um token de aluno de
   * abrir rota do painel e vice-versa. Sem a marca, dois sujeitos diferentes
   * passariam pelo mesmo verificador de assinatura -- e a assinatura e
   * valida nos dois casos.
   *
   * NENHUMA PII nos claims: so identificadores opacos. Um JWT vai para o
   * disco do aparelho e para todo log de proxy pelo caminho.
   */
  private emitirAcesso(dados: {
    tenantId: string;
    studentId: string;
    accountId: string;
    sessionId: string;
  }): string {
    return this.tokens.emitirAcesso(
      {
        sub: dados.accountId,
        tenantId: dados.tenantId,
        sessionId: dados.sessionId,
        // Vazios de proposito: o aluno nao tem papel nem permissao no painel,
        // e o canal mobile autoriza por SER o dono do dado, nao por permissao.
        permissions: [],
        mfa: false,
        canal: 'MOBILE',
        studentId: dados.studentId,
      },
      { validoPorSegundos: ACESSO_EM_SEGUNDOS },
    );
  }

  private gerarTokenDeUsoUnico(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.tokens.calcularHashDeRefresh(token) };
  }

  /**
   * Politica de senha minima.
   *
   * Comprimento acima de tudo: uma frase longa resiste mais que oito
   * caracteres com simbolo, e regra de composicao empurra para `Senha@123`.
   */
  private exigirSenhaAceitavel(senha: string): void {
    if (senha.length < 10) {
      throw new SenhaFracaError('A senha precisa de pelo menos 10 caracteres');
    }
    if (senha.length > 200) {
      throw new SenhaFracaError('A senha e longa demais');
    }
  }
}
