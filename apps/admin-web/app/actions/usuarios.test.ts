import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { aceitarConvite, convidarUsuario } from './usuarios';

const PAPEL = '22222222-2222-4222-8222-222222222222';

function formularioDeConvite(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('email', 'douglas@arenapositiva.com');
  dados.set('roleId', PAPEL);

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function formularioDeAceite(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('token', 'token-de-convite');
  dados.set('password', 'senha-com-doze-ou-mais');
  dados.set('confirmacao', 'senha-com-doze-ou-mais');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function convidado() {
  return {
    ok: true,
    dados: { id: 'cv-1', expiresAt: '2026-09-05T12:00:00.000Z', token: 'tok-em-claro' },
    cookiesDaApi: [],
  };
}

function recusa(code: string) {
  return {
    ok: false,
    erro: { type: 'about:blank', title: 'Recusado', status: 400, code, correlationId: 'teste' },
    cookiesDaApi: [],
  };
}

describe('convidarUsuario', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  /**
   * O TOKEN CHEGA À TELA -- é o ponto inteiro desta fatia.
   *
   * A API o devolve UMA VEZ (o banco guarda só o hash), e não há envio de
   * e-mail no produto: se a action o descartasse, o convite nasceria
   * inalcançável e ninguém descobriria até a pessoa convidada nunca aparecer.
   */
  it('devolve o token do convite para a tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue(convidado());

    const estado = await convidarUsuario({}, formularioDeConvite());

    expect(estado.sucesso?.token).toBe('tok-em-claro');
    expect(estado.sucesso?.email).toBe('douglas@arenapositiva.com');
  });

  /**
   * O E-MAIL VAI EM MINÚSCULA porque a API o normaliza antes de gravar
   * (`convidar`, no `InvitationService`) e o aceite casa por
   * `user.upsert({ where: { email } })`. Divergência de caixa entre convite e
   * conta viraria duas identidades para a mesma pessoa.
   */
  it('normaliza o e-mail antes de enviar', async () => {
    vi.mocked(chamarApi).mockResolvedValue(convidado());

    await convidarUsuario({}, formularioDeConvite({ email: '  Douglas@ArenaPositiva.com  ' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['email']).toBe('douglas@arenapositiva.com');
  });

  it('recusa e-mail invalido sem chamar a API', async () => {
    const estado = await convidarUsuario({}, formularioDeConvite({ email: 'nao-e-email' }));

    expect(estado.erro).toBe('Informe um e-mail válido');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * O que foi digitado VOLTA para a tela -- §6: formulário nunca perde dado
   * em erro recuperável. Diferente da senha do aceite, que nunca volta.
   */
  it('devolve os valores digitados quando recusa', async () => {
    const estado = await convidarUsuario({}, formularioDeConvite({ email: 'nao-e-email' }));

    expect(estado.valores?.email).toBe('nao-e-email');
    expect(estado.valores?.roleId).toBe(PAPEL);
  });

  it('traduz papel inexistente em frase, sem o codigo cru', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusa('ROLE_NOT_FOUND'));

    const estado = await convidarUsuario({}, formularioDeConvite());

    expect(estado.erro).toBe('Papel não encontrado nesta academia.');
  });
});

describe('aceitarConvite', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('manda token e senha para a rota publica de aceite', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: {}, cookiesDaApi: [] });

    const estado = await aceitarConvite({}, formularioDeAceite());

    expect(estado.sucesso).toBe(true);

    const [caminho, opcoes] = vi.mocked(chamarApi).mock.calls[0] ?? [];
    expect(caminho).toBe('/api/v1/users/invitations/accept');

    const corpo = opcoes?.corpo as Record<string, unknown>;
    expect(corpo['token']).toBe('token-de-convite');
    expect(corpo['password']).toBe('senha-com-doze-ou-mais');
  });

  /**
   * A CONFIRMAÇÃO NÃO VIAJA -- a API é `.strict()` e recusaria o corpo
   * inteiro com `VALIDATION_FAILED`, sem dizer qual campo sobrou. O erro
   * apareceria como "confira os dados" numa tela cujos dois campos estão
   * certos.
   */
  it('nao manda a confirmacao no corpo', async () => {
    vi.mocked(chamarApi).mockResolvedValue({ ok: true, dados: {}, cookiesDaApi: [] });

    await aceitarConvite({}, formularioDeAceite());

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('confirmacao');
  });

  /**
   * SENHA CURTA É BARRADA AQUI, e não pela API.
   *
   * A API exige 12 (`esquemaDeAceite`) e responderia `VALIDATION_FAILED`,
   * que vira "confira os dados informados" -- sem dizer que o problema é o
   * tamanho. Quem está criando a própria conta tentaria de novo com a mesma
   * senha. Foi exatamente o que barrou `dono@1234` (10 caracteres).
   */
  it('recusa senha com menos de 12 caracteres sem chamar a API', async () => {
    const estado = await aceitarConvite(
      {},
      formularioDeAceite({ password: 'dono@1234', confirmacao: 'dono@1234' }),
    );

    expect(estado.erro).toBe('A senha precisa ter ao menos 12 caracteres');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * ERRO DE DIGITAÇÃO NÃO PODE CRIAR A CONTA. Não há recuperação de senha no
   * produto, e o convite é de uso único: a saída seria pedir outro.
   */
  it('recusa quando a confirmacao nao confere', async () => {
    const estado = await aceitarConvite({}, formularioDeAceite({ confirmacao: 'outra-senha-12' }));

    expect(estado.erro).toBe('As senhas não conferem');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * A SENHA NUNCA VOLTA no estado -- devolvida como estado, reapareceria no
   * HTML da página. Mesma regra do formulário de login, que devolve o e-mail
   * e não a senha.
   */
  it('nao devolve a senha no estado de erro', async () => {
    const estado = await aceitarConvite({}, formularioDeAceite({ confirmacao: 'outra-senha-12' }));

    expect(JSON.stringify(estado)).not.toContain('senha-com-doze-ou-mais');
  });

  it('traduz convite invalido em frase que diz o que fazer', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusa('INVITATION_INVALID'));

    const estado = await aceitarConvite({}, formularioDeAceite());

    expect(estado.erro).toBe('Convite inválido ou expirado. Peça um novo à academia.');
  });
});
