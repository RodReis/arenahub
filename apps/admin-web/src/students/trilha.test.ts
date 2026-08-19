import { describe, expect, it } from 'vitest';

import { estadoDoPasso, type CampoObrigatorio } from './trilha';

/** Os três obrigatórios reais do cadastro: dois no passo 0, um no passo 2. */
const OBRIGATORIOS: readonly CampoObrigatorio[] = [
  { campo: 'fullName', passo: 0 },
  { campo: 'birthDate', passo: 0 },
  { campo: 'gymUnitId', passo: 2 },
];

/** Lê de um objeto simples; campo ausente é string vazia, como o rascunho. */
const leitor =
  (rascunho: Record<string, string>) =>
  (campo: string): string =>
    rascunho[campo] ?? '';

describe('estado do passo na trilha', () => {
  it('passo sem obrigatório fica aberto, nunca pronto', () => {
    // Endereço (1) e plano (4) não têm obrigatório: carimbá-los de "pronto"
    // prometeria uma conferência que ninguém fez.
    expect(estadoDoPasso(1, OBRIGATORIOS, leitor({}), false)).toBe('aberto');
    expect(estadoDoPasso(3, OBRIGATORIOS, leitor({}), true)).toBe('aberto');
  });

  it('passo com todos os obrigatórios preenchidos fica pronto', () => {
    const rascunho = { fullName: 'Ana Souza', birthDate: '1990-03-15' };

    expect(estadoDoPasso(0, OBRIGATORIOS, leitor(rascunho), false)).toBe('pronto');
  });

  it('um obrigatório em falta impede o passo de ficar pronto', () => {
    const rascunho = { fullName: 'Ana Souza' };

    expect(estadoDoPasso(0, OBRIGATORIOS, leitor(rascunho), true)).toBe('pendente');
  });

  /**
   * ESPAÇO NÃO PREENCHE CAMPO. Sem o `trim`, um nome com só espaços passaria
   * como preenchido e o servidor recusaria depois — a trilha teria dito
   * "pronto" para algo que não está.
   */
  it('campo com só espaços conta como vazio', () => {
    const rascunho = { fullName: '   ', birthDate: '1990-03-15' };

    expect(estadoDoPasso(0, OBRIGATORIOS, leitor(rascunho), true)).toBe('pendente');
  });

  /**
   * NÃO COBRA ANTES DA PRIMEIRA TENTATIVA. Abrir a tela e ver dois passos já
   * marcados de vermelho acusa a pessoa de um erro que ela não cometeu.
   */
  it('passo incompleto fica aberto até a primeira tentativa de envio', () => {
    expect(estadoDoPasso(0, OBRIGATORIOS, leitor({}), false)).toBe('aberto');
    expect(estadoDoPasso(0, OBRIGATORIOS, leitor({}), true)).toBe('pendente');
  });

  /**
   * A PENDÊNCIA LIMPA SOZINHA. Depois de preencher o que faltava, a trilha
   * volta a "pronto" sem exigir novo clique em enviar — senão a marca de erro
   * sobreviveria à correção e mandaria procurar um problema já resolvido.
   */
  it('preencher o campo que faltava tira a pendência, mesmo já tendo tentado enviar', () => {
    const rascunho = { gymUnitId: 'c89a3ee6-f2e5-42a5-b61e-65592c64e139' };

    expect(estadoDoPasso(2, OBRIGATORIOS, leitor(rascunho), true)).toBe('pronto');
  });
});
