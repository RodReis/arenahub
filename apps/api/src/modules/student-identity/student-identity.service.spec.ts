import { describe, expect, it, jest } from '@jest/globals';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { StudentIdentityService } from './student-identity.service.js';
import type { StudentAccountRepository } from './student-account.repository.js';
import type { StudentSessionRepository } from './student-session.repository.js';
import type { PasswordService } from '../auth/password.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { EmailDeAtivacaoService } from './email-de-ativacao.service.js';
import { CredencialInvalidaError } from '../../common/http/erro-de-dominio.js';

const AGORA = new Date('2026-09-15T12:00:00Z');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockQualquer = jest.Mock<(...args: any[]) => any>;

/**
 * Contador por chave, como o `ThrottlerStorage` real: estoura quando as
 * tentativas passam do limite. Sem opcao, nunca bloqueia.
 */
function contadorFake(): ThrottlerStorage & { chaves: string[] } {
  const hits = new Map<string, number>();
  const chaves: string[] = [];

  return {
    chaves,
    increment: (chave: string, _ttl: number, limite: number) => {
      chaves.push(chave);
      const total = (hits.get(chave) ?? 0) + 1;
      hits.set(chave, total);

      return Promise.resolve({
        totalHits: total,
        timeToExpire: 0,
        isBlocked: total > limite,
        timeToBlockExpire: 0,
      });
    },
  };
}

function montarServico(opcoes: {
  contas?: Record<string, MockQualquer>;
  sessoes?: Record<string, MockQualquer>;
  senhas?: Record<string, MockQualquer>;
  tokens?: Record<string, MockQualquer>;
  email?: Record<string, MockQualquer>;
  forcaBruta?: ThrottlerStorage & { chaves: string[] };
}) {
  const contas: Record<string, MockQualquer> = {
    encontrarPorIdentificador: jest.fn() as MockQualquer,
    encontrarCandidatoParaAtivacao: jest.fn() as MockQualquer,
    criarOuAtivarConta: jest.fn() as MockQualquer,
    ...opcoes.contas,
  };
  const sessoes: Record<string, MockQualquer> = {
    abrir: (jest.fn() as MockQualquer).mockResolvedValue('sessao-1'),
    ...opcoes.sessoes,
  };
  const senhas: Record<string, MockQualquer> = {
    gerarHash: (jest.fn() as MockQualquer).mockResolvedValue('hash-novo'),
    conferir: (jest.fn() as MockQualquer).mockResolvedValue(true),
    ...opcoes.senhas,
  };
  const tokens: Record<string, MockQualquer> = {
    emitirAcesso: (jest.fn() as MockQualquer).mockReturnValue('access-token'),
    gerarRefresh: (jest.fn() as MockQualquer).mockReturnValue({ token: 'refresh', tokenHash: 'refresh-hash' }),
    calcularHashDeRefresh: jest.fn() as MockQualquer,
    emitirPreAuth: (jest.fn() as MockQualquer).mockReturnValue('activation-ref-opaco'),
    verificarPreAuth: jest.fn() as MockQualquer,
    ...opcoes.tokens,
  };
  const email: Record<string, MockQualquer> = {
    enviarAtivacao: jest.fn() as MockQualquer,
    enviarRecuperacao: jest.fn() as MockQualquer,
    ...opcoes.email,
  };

  const servico = new StudentIdentityService(
    contas as unknown as StudentAccountRepository,
    sessoes as unknown as StudentSessionRepository,
    senhas as unknown as PasswordService,
    tokens as unknown as TokenService,
    email as unknown as EmailDeAtivacaoService,
    opcoes.forcaBruta ?? contadorFake(),
  );

  return { servico, contas, sessoes, senhas, tokens, email };
}

/** `entrar` -- login aceita CPF ou identificador, os dois resolvem pela mesma coluna. */
describe('StudentIdentityService.entrar', () => {
  it('abre sessao com identificador e senha corretos', async () => {
    const { servico } = montarServico({
      contas: {
        encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue({
          id: 'conta-1',
          tenantId: 'tenant-1',
          studentId: 'aluno-1',
          status: 'ACTIVE',
          passwordHash: 'hash-existente',
        }),
      },
    });

    const sessao = await servico.entrar({
      tenantId: 'tenant-1',
      identificador: '11144477735',
      senha: 'senha-forte-123',
      deviceLabel: null,
      agora: AGORA,
    });

    expect(sessao.accessToken).toBe('access-token');
  });

  it('recusa quando a conta nao existe', async () => {
    const { servico } = montarServico({
      contas: { encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue(null) },
    });

    await expect(
      servico.entrar({
        tenantId: 'tenant-1',
        identificador: 'inexistente',
        senha: 'senha-forte-123',
        deviceLabel: null,
        agora: AGORA,
      }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });
});

/** #599: teto de tentativas POR CONTA no login, sem olhar IP. */
describe('StudentIdentityService.entrar -- teto por conta', () => {
  const conta = (id: string) => ({
    id,
    tenantId: 'tenant-1',
    studentId: 'aluno-1',
    status: 'ACTIVE',
    passwordHash: 'hash-existente',
  });
  const entrada = (identificador: string) => ({
    tenantId: 'tenant-1',
    identificador,
    senha: 'senha-forte-123',
    deviceLabel: null,
    agora: AGORA,
  });

  it('bloqueia a conta depois de 20 tentativas, ate com a senha certa, sem rodar o scrypt', async () => {
    const { servico, senhas } = montarServico({
      contas: {
        encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue(conta('conta-1')),
      },
      senhas: { conferir: (jest.fn() as MockQualquer).mockResolvedValue(false) },
    });

    for (let i = 0; i < 20; i += 1) {
      await expect(servico.entrar(entrada('11144477735'))).rejects.toBeInstanceOf(
        CredencialInvalidaError,
      );
    }
    expect(senhas['conferir']).toHaveBeenCalledTimes(20);

    // Mesmo com a senha CERTA agora, a resposta e a de credencial invalida.
    senhas['conferir']!.mockResolvedValue(true);
    await expect(servico.entrar(entrada('11144477735'))).rejects.toBeInstanceOf(
      CredencialInvalidaError,
    );
    expect(senhas['conferir']).toHaveBeenCalledTimes(20);
  });

  it('o bloqueio e da conta: outra conta segue entrando', async () => {
    const encontrar = jest.fn() as MockQualquer;
    encontrar.mockImplementation((_t: string, identificador: string) =>
      Promise.resolve(conta(identificador === 'a' ? 'conta-a' : 'conta-b')),
    );
    const { servico, senhas } = montarServico({
      contas: { encontrarPorIdentificador: encontrar },
      senhas: { conferir: (jest.fn() as MockQualquer).mockResolvedValue(false) },
    });

    for (let i = 0; i < 21; i += 1) {
      await servico.entrar(entrada('a')).catch(() => undefined);
    }
    senhas['conferir']!.mockResolvedValue(true);

    await expect(servico.entrar(entrada('b'))).resolves.toBeDefined();
  });

  it('conta que nao existe tambem e contada, pela chave digitada', async () => {
    const forcaBruta = contadorFake();
    const { servico } = montarServico({
      contas: { encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue(null) },
      forcaBruta,
    });

    await servico.entrar(entrada('  Fulano@Exemplo.test ')).catch(() => undefined);

    expect(forcaBruta.chaves).toEqual(['aluno-login:tenant-1:fulano@exemplo.test']);
  });
});

/** #599: a reautenticacao (sessao ja aberta) tambem tem teto por conta. */
describe('StudentIdentityService.reautenticar -- teto por conta', () => {
  it('bloqueia a conta depois de 10 tentativas, ate com a senha certa', async () => {
    const { servico, senhas, sessoes } = montarServico({
      contas: {
        encontrarPorId: (jest.fn() as MockQualquer).mockResolvedValue({
          id: 'conta-1',
          passwordHash: 'hash-existente',
        }),
      },
      sessoes: { registrarReautenticacao: (jest.fn() as MockQualquer).mockResolvedValue(undefined) },
      senhas: { conferir: (jest.fn() as MockQualquer).mockResolvedValue(false) },
    });
    const ctx = { accountId: 'conta-1', sessionId: 'sessao-1' } as unknown as Parameters<
      typeof servico.reautenticar
    >[0];

    for (let i = 0; i < 10; i += 1) {
      await expect(servico.reautenticar(ctx, 'errada', AGORA)).rejects.toBeInstanceOf(
        CredencialInvalidaError,
      );
    }

    senhas['conferir']!.mockResolvedValue(true);
    await expect(servico.reautenticar(ctx, 'certa', AGORA)).rejects.toBeInstanceOf(
      CredencialInvalidaError,
    );
    expect(sessoes['registrarReautenticacao']).not.toHaveBeenCalled();
  });
});

/**
 * `consultarAtivacao` -- SPEC-071 §6.2/§7: mostra os dados da tela de
 * confirmacao e emite o `activationRef`, sem abrir sessao.
 */
describe('StudentIdentityService.consultarAtivacao', () => {
  const candidato = {
    studentId: 'aluno-1',
    fullName: 'Ana Beatriz Souza',
    cpf: '11144477735',
    birthDate: new Date('2000-05-10'),
    gymUnitName: 'Unidade Centro',
    createdAt: new Date('2026-01-05'),
    planoAtivo: 'Mensal Fit',
    inicioDoPlano: new Date('2026-01-05'),
    contaExistente: null,
  };

  it('devolve os dados da tela de confirmacao e um activationRef quando encontra o aluno', async () => {
    const { servico, tokens } = montarServico({
      contas: { encontrarCandidatoParaAtivacao: (jest.fn() as MockQualquer).mockResolvedValue(candidato) },
    });

    const resultado = await servico.consultarAtivacao({
      tenantId: 'tenant-1',
      cpf: '11144477735',
      dataNascimento: new Date('2000-05-10'),
    });

    expect(resultado).toEqual({
      nomeCompleto: 'Ana Beatriz Souza',
      cpfFormatado: '111.444.777-35',
      dataNascimento: '2000-05-10',
      plano: 'Mensal Fit',
      local: 'Unidade Centro',
      dataInicio: '2026-01-05',
      activationRef: 'activation-ref-opaco',
    });
    expect(tokens['emitirPreAuth']).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'aluno-1',
        tenantId: 'tenant-1',
        challengeId: '11144477735',
        purpose: 'STUDENT_SELF_SERVICE_ACTIVATION',
      }),
    );
  });

  it('usa "Acesso sem plano assinado" quando nao ha plano ativo -- nunca inventa nome comercial', async () => {
    const { servico } = montarServico({
      contas: {
        encontrarCandidatoParaAtivacao: (jest.fn() as MockQualquer).mockResolvedValue({ ...candidato, planoAtivo: null, inicioDoPlano: null }),
      },
    });

    const resultado = await servico.consultarAtivacao({
      tenantId: 'tenant-1',
      cpf: '11144477735',
      dataNascimento: new Date('2000-05-10'),
    });

    expect(resultado.plano).toBe('Acesso sem plano assinado');
    // Sem assinatura, "data de inicio" cai para a criacao do cadastro.
    expect(resultado.dataInicio).toBe('2026-01-05');
  });

  it('recusa quando nao ha candidato', async () => {
    const { servico } = montarServico({
      contas: { encontrarCandidatoParaAtivacao: (jest.fn() as MockQualquer).mockResolvedValue(null) },
    });

    await expect(
      servico.consultarAtivacao({
        tenantId: 'tenant-1',
        cpf: '00000000191',
        dataNascimento: new Date('2000-05-10'),
      }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });

  it('recusa com o mesmo erro quando a conta ja esta ACTIVE -- self-service nao e recuperacao', async () => {
    const { servico } = montarServico({
      contas: {
        encontrarCandidatoParaAtivacao: (jest.fn() as MockQualquer).mockResolvedValue({
          ...candidato,
          contaExistente: { id: 'conta-1', status: 'ACTIVE' },
        }),
      },
    });

    await expect(
      servico.consultarAtivacao({
        tenantId: 'tenant-1',
        cpf: '11144477735',
        dataNascimento: new Date('2000-05-10'),
      }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });

  it('permite conta PENDING (convite emitido, nunca consumido) -- coexistencia da ADR-057', async () => {
    const { servico } = montarServico({
      contas: {
        encontrarCandidatoParaAtivacao: (jest.fn() as MockQualquer).mockResolvedValue({
          ...candidato,
          contaExistente: { id: 'conta-1', status: 'PENDING' },
        }),
      },
    });

    await expect(
      servico.consultarAtivacao({
        tenantId: 'tenant-1',
        cpf: '11144477735',
        dataNascimento: new Date('2000-05-10'),
      }),
    ).resolves.toBeTruthy();
  });
});

/** `confirmarAtivacao` -- valida o activationRef e cria/ativa a conta com a senha. */
describe('StudentIdentityService.confirmarAtivacao', () => {
  it('cria a conta e abre sessao com um activationRef valido', async () => {
    const { servico, contas } = montarServico({
      contas: {
        criarOuAtivarConta: (jest.fn() as MockQualquer).mockResolvedValue({ id: 'conta-1', tenantId: 'tenant-1', studentId: 'aluno-1' }),
      },
      tokens: {
        verificarPreAuth: (jest.fn() as MockQualquer).mockReturnValue({
          sub: 'aluno-1',
          tenantId: 'tenant-1',
          challengeId: '11144477735',
          purpose: 'STUDENT_SELF_SERVICE_ACTIVATION',
        }),
      },
    });

    const sessao = await servico.confirmarAtivacao({
      activationRef: 'activation-ref-opaco',
      senha: 'senha-forte-123',
      agora: AGORA,
    });

    expect(sessao.accessToken).toBe('access-token');
    expect(contas['criarOuAtivarConta']).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', studentId: 'aluno-1', identifier: '11144477735' }),
    );
  });

  it('recusa activationRef invalido ou vencido', async () => {
    const { servico } = montarServico({
      tokens: {
        verificarPreAuth: jest.fn(() => {
          throw new Error('token expirado');
        }),
      },
    });

    await expect(
      servico.confirmarAtivacao({ activationRef: 'lixo', senha: 'senha-forte-123', agora: AGORA }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });

  it('recusa activationRef de outro proposito (ex.: MFA)', async () => {
    const { servico } = montarServico({
      tokens: {
        verificarPreAuth: (jest.fn() as MockQualquer).mockReturnValue({
          sub: 'x',
          tenantId: 'tenant-1',
          challengeId: 'y',
          purpose: 'MFA_VERIFY',
        }),
      },
    });

    await expect(
      servico.confirmarAtivacao({ activationRef: 'ref', senha: 'senha-forte-123', agora: AGORA }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });

  it('recusa quando a corrida foi perdida (repositorio devolve null)', async () => {
    const { servico } = montarServico({
      contas: { criarOuAtivarConta: (jest.fn() as MockQualquer).mockResolvedValue(null) },
      tokens: {
        verificarPreAuth: (jest.fn() as MockQualquer).mockReturnValue({
          sub: 'aluno-1',
          tenantId: 'tenant-1',
          challengeId: '11144477735',
          purpose: 'STUDENT_SELF_SERVICE_ACTIVATION',
        }),
      },
    });

    await expect(
      servico.confirmarAtivacao({ activationRef: 'ref', senha: 'senha-forte-123', agora: AGORA }),
    ).rejects.toBeInstanceOf(CredencialInvalidaError);
  });
});

/** `pedirRecuperacao` -- F23, inalterado pela SPEC-071: sempre aceita, nunca revela. */
describe('StudentIdentityService.pedirRecuperacao', () => {
  it('emite token e envia e-mail quando a conta existe e esta ACTIVE', async () => {
    const { servico, contas, email } = montarServico({
      contas: {
        encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue({
          id: 'conta-1',
          tenantId: 'tenant-1',
          identifier: 'aluno@example.test',
          status: 'ACTIVE',
        }),
        revogarTokensPendentes: (jest.fn() as MockQualquer).mockResolvedValue(undefined),
        emitirToken: (jest.fn() as MockQualquer).mockResolvedValue('token-id'),
      },
    });

    const resultado = await servico.pedirRecuperacao({
      tenantId: 'tenant-1',
      identificador: 'aluno@example.test',
      agora: AGORA,
    });

    expect(resultado).toEqual({ aceito: true });
    expect(contas['emitirToken']).toHaveBeenCalled();
    expect(email['enviarRecuperacao']).toHaveBeenCalled();
  });

  it('devolve aceito=true tambem quando a conta nao existe, sem enviar nada', async () => {
    const { servico, email } = montarServico({
      contas: { encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue(null) },
    });

    const resultado = await servico.pedirRecuperacao({
      tenantId: 'tenant-1',
      identificador: 'nao-existe@example.test',
      agora: AGORA,
    });

    expect(resultado).toEqual({ aceito: true });
    expect(email['enviarRecuperacao']).not.toHaveBeenCalled();
  });

  it('so emite um link por minuto por conta e responde igual (#599)', async () => {
    const { servico, contas, email } = montarServico({
      contas: {
        encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue({
          id: 'conta-1',
          tenantId: 'tenant-1',
          identifier: 'aluno@example.test',
          status: 'ACTIVE',
        }),
        revogarTokensPendentes: (jest.fn() as MockQualquer).mockResolvedValue(undefined),
        emitirToken: (jest.fn() as MockQualquer).mockResolvedValue('token-id'),
      },
    });
    const pedir = () =>
      servico.pedirRecuperacao({
        tenantId: 'tenant-1',
        identificador: 'aluno@example.test',
        agora: AGORA,
      });

    await expect(pedir()).resolves.toEqual({ aceito: true });
    await expect(pedir()).resolves.toEqual({ aceito: true });
    await expect(pedir()).resolves.toEqual({ aceito: true });

    // O segundo e o terceiro nao revogam o link da vitima nem mandam e-mail.
    expect(contas['emitirToken']).toHaveBeenCalledTimes(1);
    expect(contas['revogarTokensPendentes']).toHaveBeenCalledTimes(1);
    expect(email['enviarRecuperacao']).toHaveBeenCalledTimes(1);
  });

  it('falha do provedor de e-mail nao muda a resposta nem a derruba (#599)', async () => {
    const { servico } = montarServico({
      contas: {
        encontrarPorIdentificador: (jest.fn() as MockQualquer).mockResolvedValue({
          id: 'conta-1',
          tenantId: 'tenant-1',
          identifier: 'aluno@example.test',
          status: 'ACTIVE',
        }),
        revogarTokensPendentes: (jest.fn() as MockQualquer).mockResolvedValue(undefined),
        emitirToken: (jest.fn() as MockQualquer).mockResolvedValue('token-id'),
      },
      email: {
        enviarRecuperacao: (jest.fn() as MockQualquer).mockRejectedValue(new Error('provedor fora')),
      },
    });

    await expect(
      servico.pedirRecuperacao({
        tenantId: 'tenant-1',
        identificador: 'aluno@example.test',
        agora: AGORA,
      }),
    ).resolves.toEqual({ aceito: true });
  });
});
