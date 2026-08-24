import { expect, type Page } from '@playwright/test';

/**
 * Cria um plano pela interface, num lugar só.
 *
 * F53: o preço passou a ser obrigatório na criação de plano (commit
 * f1a8b9b) -- o formulário quebrou até essa fatia consertar a tela. Quem
 * precisa de "um plano cadastrado" para testar OUTRA coisa (atribuição,
 * cobrança, acessibilidade) chama `criarPlano`; sem este helper, o preço
 * teria de ser preenchido em cada um dos chamadores, um a um.
 */
export async function criarPlano(
  page: Page,
  nome: string,
  precoEmReais = '150,00',
): Promise<void> {
  await page.goto('/plans');

  /*
   * A tela de planos virou duas abas em 24/08/2026 -- "Planos cadastrados" e
   * "Criar plano" --, e a primeira e a que abre. Quem vem CONFERIR um plano
   * nao deve rolar por cima de um formulario que nao vai usar.
   */
  await page.getByTestId('aba-novo-plano').click();

  await page.getByTestId('campo-nome-do-plano').fill(nome);
  await page.getByTestId('campo-preco-do-plano').fill(precoEmReais);
  await page.getByTestId('confirmar-plano').click();

  await expect(page.getByTestId('plano-criado')).toBeVisible();
}
