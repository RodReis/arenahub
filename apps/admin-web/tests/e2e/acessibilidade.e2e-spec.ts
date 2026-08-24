import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { cadastrarAluno } from './cadastro-de-aluno';
import { criarPlano } from './cadastro-de-plano';

/**
 * WCAG 2.2 AA nos fluxos essenciais -- DS-PAINEL.md §10.
 *
 * `axe-core` NAO prova acessibilidade: prova AUSENCIA de uma lista conhecida
 * de defeitos. Contraste calculado, foco visivel, rotulo faltando e ordem de
 * cabecalho ele pega; "o rotulo diz a coisa certa" nenhuma ferramenta pega --
 * isso continua sendo trabalho dos E2E de jornada e da revisao.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const TELAS = ['/units', '/students', '/plans', '/operations', '/access-events'];

/**
 * Cria um aluno ATIVO com plano vigente -- issue #99.
 *
 * Existe porque o banco de E2E nasce vazio a cada execucao, e tela vazia nao
 * tem o que varrer: sem aluno `ACTIVE` nao ha `StateBadge` de tom `success`,
 * que era justamente o unico tom reprovando contraste (4.44 sobre o proprio
 * tint, alvo 4.5). A suite passava 7/7 enquanto o defeito estava na tela, e
 * quem o encontrou foi uma varredura manual contra o banco de desenvolvimento,
 * que TEM dado.
 *
 * A licao nao e sobre este defeito e sim sobre a classe dele: **varrer o vazio
 * mede a ausencia de conteudo, nao a conformidade do conteudo.** Toda tela que
 * so mostra estado quando ha dado precisa do dado antes do `analyze()`.
 */
async function criarAlunoAtivoComPlano(page: Page): Promise<void> {
  const sufixo = String(Date.now());

  await criarPlano(page, `Plano A11y ${sufixo}`);

  // O cadastro virou um wizard de quatro passos na F45; `cadastrarAluno`
  // guarda a navegação entre eles, para este teste continuar sendo sobre
  // acessibilidade e não sobre o fluxo do formulário.
  await cadastrarAluno(page, { nome: `Aluna A11y ${sufixo}`, nascimento: '1994-05-20' });
  await page.getByTestId('abrir-ficha').click();

  /*
   * A ficha virou duas abas e o formulario de plano abre por botao
   * (24/08/2026) -- ver `students.e2e-spec.ts` para o porque.
   */
  await page.getByTestId('aba-plano').click();
  await page
    .getByRole('button', { name: /Atribuir plano|Alterar plano/ })
    .first()
    .click();

  await page.getByTestId('campo-plano').selectOption({ label: `Plano A11y ${sufixo}` });
  await page.getByTestId('campo-inicio').fill('2026-01-01T06:00');
  await page.getByTestId('campo-fim').fill('2027-01-01T22:00');
  await page.getByTestId('campo-motivo-atribuicao').fill('cenario de varredura de acessibilidade');
  await page.getByTestId('confirmar-atribuicao').click();
  await expect(page.getByTestId('plano-atribuido')).toBeVisible();
}

test.describe('acessibilidade WCAG 2.2 AA', () => {
  test('a tela de login nao tem violacao', async ({ page }) => {
    await page.goto('/login');

    const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();

    expect(resultado.violations).toEqual([]);
  });

  for (const tela of TELAS) {
    test(`${tela} nao tem violacao`, async ({ page }) => {
      await entrar(page);
      await page.goto(tela);

      const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(resultado.violations).toEqual([]);
    });
  }

  /**
   * O mesmo axe, agora COM dado na tela.
   *
   * Separado dos casos acima de proposito: tela vazia e um estado real que
   * tambem precisa passar (e mais barato de varrer), mas passar nela nao diz
   * nada sobre a tela cheia. Sao duas garantias, nao uma repetida.
   */
  test('lista e ficha com dado nao tem violacao', async ({ page }) => {
    await entrar(page);
    await criarAlunoAtivoComPlano(page);

    for (const tela of ['/students', '/plans']) {
      await page.goto(tela);

      const resultado = await new AxeBuilder({ page }).withTags(TAGS).analyze();

      expect(resultado.violations, `violacao em ${tela} com dado`).toEqual([]);
    }
  });

  /**
   * §10 item 8: zoom de 200% sem perda de conteudo.
   *
   * 1280 px de largura logica a 200% equivale a 640 px CSS. A pagina pode
   * rolar na VERTICAL -- o que a regra proibe e a rolagem horizontal, que
   * obriga a varrer cada linha nos dois eixos para ler uma frase.
   */
  test('zoom de 200% nao corta conteudo', async ({ page }) => {
    await entrar(page);

    // COM dado, pelo mesmo motivo do caso acima: tabela vazia nao transborda.
    // A largura vem das colunas preenchidas, entao varrer a tela vazia mediria
    // o layout do estado vazio -- que nunca foi o caso em risco.
    await criarAlunoAtivoComPlano(page);

    await page.setViewportSize({ width: 640, height: 720 });

    // TODAS as telas, e nao so `/students` -- issue #99. A tela de eventos e a
    // de operacao sao as mais largas do painel (7 colunas e quatro blocos de
    // resumo), entao eram exatamente as que o caso anterior nao cobria.
    for (const tela of TELAS) {
      await page.goto(tela);

      const transborda = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );

      expect(transborda, `${tela} transborda na horizontal a 200%`).toBe(false);
    }
  });
});
