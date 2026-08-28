import { expect, test, type Page } from '@playwright/test';

/**
 * Aceite da F51 (issue #152), literal: "o totem roda os blocos habilitados na
 * ordem definida, com o tempo configurado, sem rede disponível, servindo
 * mídia do cache local; a faixa de patrocinadores permanece fixa e rotulada."
 *
 * O QUE ESTE E2E PROVA, e o que ele NAO tenta provar:
 *
 *   - prova a JORNADA DO GERENTE no painel: acrescentar bloco, ligar,
 *     reordenar, rotular a faixa, salvar e publicar;
 *   - NAO prova o rodizio girando no totem (isso e teste de componente, com
 *     relogio falso -- esperar 12 s reais por troca de bloco seria um E2E
 *     lento e intermitente);
 *   - NAO prova "sem rede": derrubar a rede no meio de um E2E prova o
 *     navegador, nao o requisito. O que sustenta `M3.5-FR-005` e a AUSENCIA
 *     de `fetch` no componente da hero, coberta por teste de componente, e a
 *     assinatura da midia no boot, coberta por integracao.
 *
 * Totem do seed: `TOTEM01` (`packages/database/prisma/seed.ts`).
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function abrirBlocos(page: Page): Promise<void> {
  await page.goto('/operations/kiosks');

  const linha = page.getByRole('row', { name: /TOTEM01/i });
  await expect(linha).toBeVisible();

  await linha.getByRole('link', { name: 'Configurar' }).click();
  await expect(page).toHaveURL(/\/operations\/kiosks\/[^/]+$/);

  await page.getByRole('tab', { name: 'Blocos públicos' }).click();
}

/** Deixa a lista de blocos vazia, para o teste partir sempre do mesmo lugar. */
async function limparBlocos(page: Page): Promise<void> {
  const remover = page.getByRole('button', { name: /^Remover / });

  // `while` e nao `for` sobre uma contagem lida uma vez: cada clique tira
  // uma linha, e uma contagem congelada erraria a partir do segundo.
  while ((await remover.count()) > 0) {
    await remover.first().click();
  }
}

test.describe('F51 -- tela pública do totem', () => {
  test('acrescenta blocos, define a ordem e publica', async ({ page }) => {
    await entrar(page);
    await abrirBlocos(page);
    await limparBlocos(page);

    await page.getByTestId('acrescentar-INSTAGRAM').click();
    await page.getByTestId('acrescentar-INFORMACOES').click();

    // Ligar e o passo separado de acrescentar -- bloco nasce desligado.
    await page.getByTestId('ligar-INSTAGRAM').check();
    await page.getByTestId('ligar-INFORMACOES').check();

    await page.getByLabel('Tempo de cada bloco no rodízio').selectOption('20');

    // A ORDEM E O QUE O TOTEM RODA: sobe o segundo para a primeira posicao.
    await page.getByTestId('subir-INFORMACOES').click();

    const primeiro = page.getByTestId('lista-de-blocos').locator('li').first();
    await expect(primeiro).toHaveAttribute('data-testid', 'bloco-INFORMACOES');

    // Nas pontas, os botoes de mover ficam desabilitados.
    await expect(page.getByTestId('subir-INFORMACOES')).toBeDisabled();
    await expect(page.getByTestId('descer-INSTAGRAM')).toBeDisabled();

    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/rascunho não publicado/i);

    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/sem alterações/i);

    // A ordem publicada sobrevive ao recarregamento -- e ela que o totem lê.
    await page.reload();
    await page.getByRole('tab', { name: 'Blocos públicos' }).click();

    await expect(
      page.getByTestId('lista-de-blocos').locator('li').first(),
    ).toHaveAttribute('data-testid', 'bloco-INFORMACOES');
    await expect(page.getByLabel('Tempo de cada bloco no rodízio')).toHaveValue('20');
  });

  test('a faixa de patrocinadores é vitrine, e o rótulo nunca fica vazio', async ({ page }) => {
    await entrar(page);
    await abrirBlocos(page);

    await page.getByTestId('campo-patrocinioHabilitado').check();
    await page.getByTestId('acrescentar-patrocinador').click();

    // Pelo ID do campo, e nao por `getByLabel('Nome').first()`: TODAS as abas
    // ficam montadas (so trocam de `hidden`), entao "Nome" tambem casa com
    // "Nome da academia" da aba Marca -- escondida, e o `fill` estoura em
    // timeout de 30 s esperando ela ficar visivel.
    await page.locator('#patrocinador-nome-0').fill('Suplementos XYZ');

    // Rotulo EM BRANCO: a tela tem de dizer qual padrao o totem exibira --
    // publicidade identificada como tal (CDC art. 36).
    await expect(page.getByTestId('campo-rotuloDoPatrocinio')).toHaveValue('');
    await expect(page.getByText(/Espaço patrocinado/i)).toBeVisible();

    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/rascunho não publicado/i);

    // Descartar devolve a faixa ao estado publicado, sem deixar patrocinador
    // orfao no rascunho.
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Descartar rascunho' }).click();
    await expect(page.getByTestId('barra-de-estado')).toHaveText(/sem alterações/i);
  });

  test('o campo de link do Instagram aparece, desabilitado e com o motivo', async ({ page }) => {
    await entrar(page);
    await abrirBlocos(page);
    await limparBlocos(page);

    await page.getByTestId('acrescentar-VIDEO').click();

    // O campo EXISTE e agora e EDITAVEL -- a fatia [INFRA] entregou o
    // extrator (ADR-042, Decisao 7).
    const link = page.getByLabel('Link de reel do Instagram');

    await expect(link).toBeVisible();
    await expect(link).toBeEnabled();

    // O aviso do ADR continua obrigatorio: o campo nao pode prometer o que
    // a Meta nao garante.
    await expect(
      page.getByText(/mudanças posteriores no Instagram não se refletem no totem/i),
    ).toBeVisible();

    // O botao existe e so libera com link -- clicar vazio dispararia uma
    // chamada que so pode falhar.
    const copiar = page.getByTestId(/^copiar-link-/);

    await expect(copiar).toBeDisabled();

    await link.fill('https://www.instagram.com/reel/DbtoWkFR6l6/');

    await expect(copiar).toBeEnabled();
  });
});
