import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/api/server-client', () => ({
  chamarApi: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { chamarApi } from '../../lib/api/server-client';
import { criarTenant } from './platform';

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
   * Slug repetido cai em `INTERNAL_ERROR`: o `POST` não traduz o P2002 do
   * Prisma, e o filtro de `problem+json` manda todo erro imprevisto para o
   * genérico. A tela não pode fingir que sabe qual campo repetiu, mas o
   * palpite ao lado do código estável é o que deixa alguém agir.
   */
  it('sugere o identificador repetido no erro interno, sem esconder o codigo', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('INTERNAL_ERROR'));

    const estado = await criarTenant({}, formularioValido());

    expect(estado.erro).toContain('identificador');
    expect(estado.erro).toContain('INTERNAL_ERROR');
  });

  it('devolve os valores digitados tambem quando a API recusa', async () => {
    vi.mocked(chamarApi).mockResolvedValue(recusado('VALIDATION_FAILED'));

    const estado = await criarTenant({}, formularioValido());

    expect(estado.valores?.displayName).toBe('Academia Nova');
  });
});
