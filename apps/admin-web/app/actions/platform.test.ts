import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { repassarCookies } from '../../lib/api/repassar-cookies';
import {
  alterarTenant,
  alternarStatusDoTenant,
  criarTenant,
  elevarSuporte,
  encerrarSuporte,
} from './platform';

vi.mock('../../lib/api/repassar-cookies', () => ({
  repassarCookies: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

function formularioValido(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('slug', 'academia-nova');
  dados.set('legalName', 'Academia Nova LTDA');
  dados.set('displayName', 'Academia Nova');
  dados.set('cnpj', '12345678000199');
  dados.set('timezone', 'America/Sao_Paulo');
  dados.set('responsavelNome', 'Fulano de Tal');
  dados.set('responsavelEmail', 'dono@academia.local');
  dados.set('unidadeCode', 'MATRIZ');
  dados.set('unidadeName', 'Matriz');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function criado(emailEnviado: boolean) {
  return {
    ok: true,
    dados: { id: 'tn-1', gymUnitId: 'un-1', emailEnviado },
    cookiesDaApi: [],
  };
}

function recusado(code: string) {
  return {
    ok: false,
    erro: { type: '', title: '', status: 400, code, correlationId: 'x' },
    cookiesDaApi: [],
  };
}

describe('criarTenant', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  it('devolve os valores digitados quando a validacao falha, para o form nao esvaziar', async () => {
    const estado = await criarTenant({}, formularioValido({ slug: 'AB' }));

    expect(estado.erro).toBeDefined();
    expect(estado.valores?.legalName).toBe('Academia Nova LTDA');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('recusa CNPJ com menos de 14 digitos antes de chamar a API', async () => {
    const estado = await criarTenant({}, formularioValido({ cnpj: '123' }));

    expect(estado.erro).toContain('CNPJ');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * A máscara do CNPJ é o formato que a recepção digita; a API exige 14
   * dígitos crus. Mandar o que o campo tem quebraria com `VALIDATION_FAILED`
   * genérico, longe da causa.
   */
  it('manda o CNPJ so com digitos, mesmo digitado com mascara', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado(true));

    await criarTenant({}, formularioValido({ cnpj: '12.345.678/0001-99' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['cnpj']).toBe('12345678000199');
  });

  it('monta a primeira unidade com o mesmo fuso do tenant', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado(true));

    await criarTenant({}, formularioValido());

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['unidade']).toEqual({
      code: 'MATRIZ',
      name: 'Matriz',
      timezone: 'America/Sao_Paulo',
    });
  });

  /**
   * O Resend responde erro com HTTP 200, e é por isso que a API devolve o
   * booleano. Perdê-lo aqui faria a tela afirmar um convite que não saiu.
   */
  it('carrega emailEnviado ate o estado, inclusive quando o convite nao saiu', async () => {
    vi.mocked(chamarApi).mockResolvedValue(criado(false));

    const estado = await criarTenant({}, formularioValido());

    expect(estado.sucesso?.emailEnviado).toBe(false);
  });

  it('mostra o codigo estavel quando a API recusa com codigo desconhecido', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('COISA_NOVA'));

    const estado = await criarTenant({}, formularioValido());

    // O codigo sempre aparece: "erro ao salvar" sozinho nao deixa ninguem agir.
    expect(estado.erro).toContain('COISA_NOVA');
  });

  /**
   * Slug repetido tem código próprio (409 `TENANT_SLUG_TAKEN`), então a frase
   * AFIRMA a causa em vez de sugeri-la — e não vaza código na tela, porque
   * este erro é conhecido e tem tradução.
   */
  it('afirma o identificador repetido, sem despejar o codigo na tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('TENANT_SLUG_TAKEN'));

    const estado = await criarTenant({}, formularioValido());

    expect(estado.erro).toContain('identificador');
    expect(estado.erro).not.toContain('TENANT_SLUG_TAKEN');
  });

  it('devolve os valores digitados tambem quando a API recusa', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('VALIDATION_FAILED'));

    const estado = await criarTenant({}, formularioValido());

    expect(estado.valores?.displayName).toBe('Academia Nova');
  });
});

function edicaoValida(extras: Record<string, string> = {}): FormData {
  const dados = new FormData();

  dados.set('tenantId', 'tn-1');
  dados.set('legalName', 'Academia Nova LTDA');
  dados.set('displayName', 'Academia Nova');
  dados.set('cnpj', '12345678000199');
  dados.set('timezone', 'America/Sao_Paulo');
  dados.set('responsavelNome', 'Fulano de Tal');
  dados.set('responsavelEmail', 'dono@academia.local');

  for (const [chave, valor] of Object.entries(extras)) {
    dados.set(chave, valor);
  }

  return dados;
}

function aceito(dados: unknown, cookies: string[] = []) {
  return { ok: true, dados, cookiesDaApi: cookies };
}

describe('alterarTenant', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  /**
   * O identificador é permanente e público: a F62 fará login por ele. Mandá-lo
   * no PATCH deixaria a API decidir se aceita — e nesta tela ele nem é campo.
   */
  it('nao manda o identificador, que nao se troca depois do cadastro', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aceito({ id: 'tn-1' }));

    await alterarTenant({}, edicaoValida({ slug: 'tentativa-de-troca' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo).not.toHaveProperty('slug');
    expect(corpo).not.toHaveProperty('status');
  });

  it('manda o CNPJ so com digitos, mesmo digitado com mascara', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aceito({ id: 'tn-1' }));

    await alterarTenant({}, edicaoValida({ cnpj: '12.345.678/0001-99' }));

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['cnpj']).toBe('12345678000199');
  });

  it('devolve os valores digitados quando a validacao falha', async () => {
    const estado = await alterarTenant({}, edicaoValida({ cnpj: '123' }));

    expect(estado.erro).toContain('CNPJ');
    expect(estado.valores?.displayName).toBe('Academia Nova');
    expect(chamarApi).not.toHaveBeenCalled();
  });

  it('traduz a academia que sumiu, sem despejar o codigo na tela', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('TENANT_NOT_FOUND'));

    const estado = await alterarTenant({}, edicaoValida());

    expect(estado.erro).toContain('não existe');
    expect(estado.erro).not.toContain('TENANT_NOT_FOUND');
  });
});

describe('alternarStatusDoTenant', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
  });

  function saida(extras: Record<string, string> = {}): FormData {
    const dados = new FormData();

    dados.set('tenantId', 'tn-1');
    dados.set('status', 'INACTIVE');
    dados.set('reason', 'Contrato encerrado a pedido do cliente');

    for (const [chave, valor] of Object.entries(extras)) dados.set(chave, valor);

    return dados;
  }

  /**
   * A API exige motivo ao tirar de operação (`MOTIVO_OBRIGATORIO`). Barrar
   * aqui poupa a ida e volta e mostra a exigência no campo, não num toast
   * vindo do servidor.
   */
  it('recusa inativacao sem motivo antes de chamar a API', async () => {
    const estado = await alternarStatusDoTenant({}, saida({ reason: 'curto' }));

    expect(estado.erro).toBeDefined();
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * Reativar não pede motivo, e o campo não pode viajar em branco: motivo
   * vazio na auditoria é pior que campo ausente — parece que alguém respondeu
   * e não respondeu nada.
   */
  it('reativa sem motivo, e sem mandar motivo em branco', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aceito({ id: 'tn-1' }));

    const estado = await alternarStatusDoTenant({}, saida({ status: 'ACTIVE', reason: '' }));

    expect(estado.erro).toBeUndefined();

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['status']).toBe('ACTIVE');
    expect(corpo).not.toHaveProperty('reason');
  });

  it('manda o motivo ao tirar de operacao', async () => {
    vi.mocked(chamarApi).mockResolvedValue(aceito({ id: 'tn-1' }));

    await alternarStatusDoTenant({}, saida());

    const corpo = vi.mocked(chamarApi).mock.calls[0]?.[1]?.corpo as Record<string, unknown>;
    expect(corpo['status']).toBe('INACTIVE');
    expect(corpo['reason']).toBe('Contrato encerrado a pedido do cliente');
  });

  /**
   * `SUSPENDED` é escrito pela inadimplência (F65), nunca por este CRUD.
   * Aceitá-lo aqui deixaria o painel fabricar uma suspensão que a cobrança não
   * conhece — e que a cobrança não saberia levantar.
   */
  it('recusa SUSPENDED, que quem escreve e a inadimplencia', async () => {
    const estado = await alternarStatusDoTenant(
      {},
      saida({ status: 'SUSPENDED', reason: 'Deixou de pagar a mensalidade' }),
    );

    expect(estado.erro).toBeDefined();
    expect(chamarApi).not.toHaveBeenCalled();
  });
});

describe('elevarSuporte', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
    vi.mocked(repassarCookies).mockReset();
  });

  function justificada(reason: string): FormData {
    const dados = new FormData();

    dados.set('tenantId', 'tn-1');
    dados.set('reason', reason);

    return dados;
  }

  it('recusa justificativa curta antes de chamar a API', async () => {
    const estado = await elevarSuporte({}, justificada('ajuda'));

    expect(estado.erro).toBeDefined();
    expect(chamarApi).not.toHaveBeenCalled();
  });

  /**
   * O COOKIE NOVO É A ELEVAÇÃO INTEIRA.
   *
   * A API troca o cookie de acesso por um token que carrega o tenant alvo.
   * Sem repassá-lo ao navegador, a pessoa "eleva" e continua sem alcançar
   * nada — e o sintoma parece bug de permissão, longe da causa.
   */
  it('repassa ao navegador o cookie novo que a API emitiu', async () => {
    vi.mocked(chamarApi).mockResolvedValue(
      aceito({ id: 'el-1', expiresAt: '2026-09-09T17:30:00.000Z' }, ['arenahub_access=novo; Path=/']),
    );

    await elevarSuporte({}, justificada('Suporte combinado com o cliente por telefone'));

    expect(repassarCookies).toHaveBeenCalledWith(['arenahub_access=novo; Path=/']);
  });

  it('traduz a elevacao ja aberta na sessao', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('ELEVACAO_JA_ABERTA'));

    const estado = await elevarSuporte(
      {},
      justificada('Suporte combinado com o cliente por telefone'),
    );

    expect(estado.erro).toContain('elevação');
    expect(estado.erro).not.toContain('ELEVACAO_JA_ABERTA');
    expect(repassarCookies).not.toHaveBeenCalled();
  });

  /**
   * Recusa não pode gravar cookie: o token velho continua valendo, e escrever
   * por cima com o que a API mandou numa resposta de erro trocaria uma sessão
   * boa por uma indefinida.
   */
  it('nao repassa cookie quando a API recusa', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: '', title: '', status: 400, code: 'COISA_NOVA', correlationId: 'x' },
      cookiesDaApi: ['arenahub_access=nao-deveria; Path=/'],
    });

    const estado = await elevarSuporte(
      {},
      justificada('Suporte combinado com o cliente por telefone'),
    );

    expect(estado.erro).toContain('COISA_NOVA');
    expect(repassarCookies).not.toHaveBeenCalled();
  });
});

describe('encerrarSuporte', () => {
  beforeEach(() => {
    vi.mocked(chamarApi).mockReset();
    vi.mocked(repassarCookies).mockReset();
  });

  /**
   * Simétrico da entrada: a API devolve o cookie SEM tenant, e é ele que tira
   * a pessoa do tenant. Perdê-lo deixaria alguém elevado depois de clicar em
   * "Sair do suporte" — pior que não ter o botão.
   */
  it('repassa o cookie sem tenant que a API devolveu', async () => {
    vi.mocked(chamarApi).mockResolvedValue(
      aceito({ encerrada: true }, ['arenahub_access=sem-tenant; Path=/']),
    );

    await encerrarSuporte();

    expect(repassarCookies).toHaveBeenCalledWith(['arenahub_access=sem-tenant; Path=/']);
  });

  it('nao repassa cookie quando a API recusa', async () => {
    vi.mocked(chamarApi).mockResolvedValue({
      ok: false,
      erro: { type: '', title: '', status: 404, code: 'NOT_FOUND', correlationId: 'x' },
      cookiesDaApi: ['arenahub_access=nao-deveria; Path=/'],
    });

    await encerrarSuporte();

    expect(repassarCookies).not.toHaveBeenCalled();
  });
});
