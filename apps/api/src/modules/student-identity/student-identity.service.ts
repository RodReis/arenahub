import { randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import {
  CredencialInvalidaError,
  RefreshReutilizadoError,
} from '../../common/http/erro-de-dominio.js';
import { PasswordService } from '../auth/password.service.js';
import { TokenService } from '../auth/token.service.js';
import { formatarCpf } from '../students/domain/identificacao.js';
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
 * Senha aleatoria cujo hash serve de alvo descartavel.
 *
 * Ver `envelopeDescartavel()` -- o valor real e derivado no arranque, nunca
 * escrito a mao.
 */
const SENHA_DESCARTAVEL = randomBytes(32).toString('base64url');

/**
 * UUID que nao pertence a tenant nenhum.
 *
 * Serve para a consulta de login rodar tambem quando o slug da academia nao
 * existe. Zerado de proposito: um UUID aleatorio a cada chamada seria igual
 * na pratica, mas este deixa claro na leitura que e um valor impossivel, e
 * nao um id real que alguem esqueceu no codigo.
 */
const TENANT_INEXISTENTE = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class StudentIdentityService {
  private readonly logger = new Logger(StudentIdentityService.name);

  /**
   * Alvo descartavel para o login GASTAR O MESMO TEMPO sem conta.
   *
   * DERIVADO pelo proprio `PasswordService`, nunca escrito a mao -- e a
   * primeira versao desta fatia escreveu, com consequencia medida:
   *
   *   conta existe .... 20,6 ms (scrypt roda)
   *   conta nao existe .. 0,0 ms (envelope malformado -> `return false`)
   *
   * O `conferir` valida o FORMATO do envelope (7 campos, `v=`, `N=`, `r=`,
   * `p=`) e sai antes do scrypt quando nao bate. Um envelope inventado
   * atravessa essa porta em microssegundos, e a base inteira vira enumeravel
   * por cronometro -- com a mensagem de erro sendo identica nos dois casos.
   * Mensagem igual com tempo diferente nao e antienumeracao, e a aparencia
   * dela.
   *
   * `Promise` memoizada: o scrypt roda UMA vez, no primeiro login, e nao a
   * cada requisicao. Derivar por tentativa somaria 20 ms a todo login valido.
   */
  private envelopeDescartavel: Promise<string> | null = null;

  constructor(
    private readonly contas: StudentAccountRepository,
    private readonly sessoes: StudentSessionRepository,
    private readonly senhas: PasswordService,
    private readonly tokens: TokenService,
    private readonly email: EmailDeAtivacaoService,
  ) {}

  private alvoDescartavel(): Promise<string> {
    this.envelopeDescartavel ??= this.senhas.gerarHash(SENHA_DESCARTAVEL);
    return this.envelopeDescartavel;
  }

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

  /**
   * Consulta da ativacao self-service -- SPEC-071 §6.2/§7. Localiza o aluno
   * por CPF + nascimento e devolve os dados da tela de confirmacao (§6.3)
   * mais um `activationRef` de curta duracao -- ainda NAO abre sessao nem
   * cria senha, so prova que o cadastro foi encontrado.
   *
   * Mesmo erro generico para CPF inexistente, nascimento errado e conta que
   * ja tem senha -- a tela pede para procurar a administracao nos tres
   * casos, sem distinguir motivo (ADR-057, risco de enumeracao aceito pelo
   * PI, Decisao 2).
   */
  async consultarAtivacao(dados: {
    tenantId: string | null;
    cpf: string;
    dataNascimento: Date;
  }): Promise<{
    nomeCompleto: string;
    cpfFormatado: string;
    dataNascimento: string;
    plano: string;
    local: string;
    dataInicio: string;
    activationRef: string;
  }> {
    if (!dados.tenantId) throw new CredencialInvalidaError();

    const candidato = await this.contas.encontrarCandidatoParaAtivacao(
      dados.tenantId,
      dados.cpf,
      dados.dataNascimento,
    );

    // Sem candidato, ou candidato com conta JA ATIVA (self-service nao e
    // recuperacao -- essa e outra tela, `pedirRecuperacao`): mesmo erro.
    if (!candidato || candidato.contaExistente?.status === 'ACTIVE') {
      throw new CredencialInvalidaError();
    }

    const activationRef = this.tokens.emitirPreAuth({
      sub: candidato.studentId,
      tenantId: dados.tenantId,
      challengeId: candidato.cpf,
      purpose: 'STUDENT_SELF_SERVICE_ACTIVATION',
    });

    return {
      nomeCompleto: candidato.fullName,
      cpfFormatado: formatarCpf(candidato.cpf) ?? candidato.cpf,
      dataNascimento: candidato.birthDate.toISOString().slice(0, 10),
      // "Acesso sem plano assinado" -- mesma regra do card do plano no app
      // (DS-APP.md §4.12): nunca inventa um nome comercial.
      plano: candidato.planoAtivo ?? 'Acesso sem plano assinado',
      local: candidato.gymUnitName,
      dataInicio: (candidato.inicioDoPlano ?? candidato.createdAt).toISOString().slice(0, 10),
      activationRef,
    };
  }

  /**
   * Confirma a ativacao self-service -- SPEC-071 §7, ADR-057 Decisao 5. O
   * `activationRef` (emitido por `consultarAtivacao`) prova que o CPF +
   * nascimento ja foram conferidos; aqui so falta a senha. Cria a conta se
   * nao existir, ou ativa por cima de um convite `PENDING` nunca consumido
   * -- o primeiro caminho a chegar aqui vence a corrida.
   */
  async confirmarAtivacao(dados: {
    activationRef: string;
    senha: string;
    agora: Date;
  }): Promise<SessaoAberta> {
    this.exigirSenhaAceitavel(dados.senha);

    let claims;
    try {
      claims = this.tokens.verificarPreAuth(dados.activationRef);
    } catch {
      throw new CredencialInvalidaError();
    }

    if (claims.purpose !== 'STUDENT_SELF_SERVICE_ACTIVATION' || !claims.tenantId) {
      throw new CredencialInvalidaError();
    }

    const passwordHash = await this.senhas.gerarHash(dados.senha);
    const conta = await this.contas.criarOuAtivarConta({
      tenantId: claims.tenantId,
      studentId: claims.sub,
      identifier: claims.challengeId,
      passwordHash,
      agora: dados.agora,
    });

    // Corrida perdida (conta ja ACTIVE quando este pedido chegou): mesmo
    // erro generico do resto do fluxo.
    if (!conta) throw new CredencialInvalidaError();

    return this.abrirSessao({
      tenantId: claims.tenantId,
      accountId: conta.id,
      studentId: claims.sub,
      deviceLabel: null,
      agora: dados.agora,
    });
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
   * Identificador inexistente, senha errada e conta desativada saem todos
   * pelo MESMO erro. E o scrypt roda nos tres casos (ver
   * `ENVELOPE_DESCARTAVEL`). SPEC-071 §3 Decisao 3: o corpo aceita CPF ou
   * e-mail/telefone (F23) -- o CONTROLLER normaliza os dois no mesmo campo
   * `identificador` antes de chamar este metodo, porque os dois resolvem
   * pela mesma coluna (`StudentAccount.identifier`).
   */
  async entrar(dados: {
    tenantId: string | null;
    identificador: string;
    senha: string;
    deviceLabel: string | null;
    agora: Date;
  }): Promise<SessaoAberta> {
    // `tenantId` nulo = slug de academia inexistente. A consulta roda MESMO
    // ASSIM, contra um UUID que nao existe: pular a ida ao banco devolveria
    // mais rapido para academia inexistente, e isso enumera os tenants pelo
    // mesmo cronometro que o hash descartavel fecha do outro lado.
    const conta = await this.contas.encontrarPorIdentificador(
      dados.tenantId ?? TENANT_INEXISTENTE,
      dados.identificador,
    );

    const envelope = conta?.passwordHash ?? (await this.alvoDescartavel());
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
   * Pede recuperacao de senha -- sempre aceita, nunca revela (F23,
   * inalterado pela SPEC-071 -- ela nao toca em recuperacao).
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
    const envelope = conta?.passwordHash ?? (await this.alvoDescartavel());

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
