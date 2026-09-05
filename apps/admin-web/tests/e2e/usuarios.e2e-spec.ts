import { expect, test, type Page } from '@playwright/test';

/**
 * Convite de usuário do painel — issue #274.
 *
 * O pedido do PI foi "criar um usuário admin em produção". A API tinha as
 * duas rotas do convite desde sempre e NENHUM chamador: criar um
 * administrador exigia `curl` com um `roleId` descoberto direto no banco.
 *
 * A jornada inteira só existe se as duas telas se encontrarem — quem convida
 * copia um link, e quem recebe cria a senha e entra. Testar as duas metades
 * em separado deixaria passar exatamente o que importa: o link que sai de uma
 * funcionar na outra.
 */
const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

/**
 * 12+ caracteres, que é o mínimo da API (`esquemaDeAceite`).
 *
 * Foi este piso que barrou o `dono@1234` (10) pedido pelo PI e obrigou a
 * fatia inteira a existir.
 */
const SENHA_NOVA = 'senha-de-e2e-do-convite';

async function entrar(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * E-mail único por execução.
 *
 * Os testes rodam em série contra o MESMO banco semeado, sem limpeza entre
 * arquivos. E-mail fixo faria a segunda execução reencontrar a conta da
 * primeira: o aceite passaria pelo motivo errado (`user.upsert` casa por
 * e-mail) e o `userRole.create` estouraria com papel duplicado.
 */
function emailUnico(prefixo: string): string {
  return `${prefixo}-${Date.now()}@exemplo.test`;
}

/** Convida e devolve o caminho do convite, que aparece UMA vez na tela. */
async function convidar(page: Page, email: string): Promise<string> {
  await page.goto('/users');
  await page.getByTestId('convidar-usuario').click();
  await page.getByTestId('campo-email-do-convite').fill(email);
  await page.getByTestId('confirmar-convite').click();

  const link = page.getByTestId('link-do-convite');
  await expect(link).toBeVisible();

  return (await link.innerText()).trim();
}

test.describe('usuarios do painel', () => {
  test('sem sessao, a lista manda para o login', async ({ page }) => {
    await page.goto('/users');

    await expect(page).toHaveURL(/\/login/);
  });

  /**
   * A TELA DE ACEITE É PÚBLICA, e tem de continuar sendo: quem aceita convite
   * ainda não tem conta. Se um dia ela cair para dentro de `(protected)`, o
   * convite vira um link que manda a pessoa fazer um login que ela não pode
   * fazer -- e o único jeito de descobrir seria alguém tentar usar um convite.
   */
  test('a tela de aceite abre sem sessao', async ({ page }) => {
    await page.goto('/convite/token-que-nao-existe');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Criar sua senha' })).toBeVisible();
  });

  /**
   * A JORNADA INTEIRA, ponta a ponta: convidar, abrir o link, criar a senha e
   * entrar com ela. É o aceite da issue #274 -- o que o PI pediu era uma conta
   * nova de administrador, e a conta só existe de verdade quando faz login.
   */
  test('o convite cria a conta e ela entra no painel', async ({ page }) => {
    const email = emailUnico('convidado-e2e');

    await entrar(page);

    const caminho = await convidar(page, email);
    expect(caminho).toMatch(/^\/convite\/.+/);

    await page.goto(caminho);
    await page.getByLabel('Nova senha').fill(SENHA_NOVA);
    await page.getByLabel('Repita a senha').fill(SENHA_NOVA);
    await page.getByRole('button', { name: /criar senha/i }).click();

    await expect(page.getByTestId('aceite-concluido')).toBeVisible();

    // A CONTA EXISTE quando entra. Confirmar só a mensagem de sucesso
    // provaria que a tela mudou de estado, não que alguém pode trabalhar.
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill(SENHA_NOVA);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).not.toHaveURL(/\/login/);

    // E aparece na lista de quem tem acesso ao painel.
    await entrar(page);
    await page.goto('/users');
    await expect(page.getByTestId('tabela-de-usuarios')).toContainText(email);
  });

  /**
   * CONVITE É DE USO ÚNICO -- `aceitar` marca `ACCEPTED` na MESMA transação
   * que cria o usuário, justamente para duas aceitações simultâneas não
   * criarem dois papéis com um convite só.
   *
   * A frase precisa dizer o que fazer: "convite inválido" sozinho deixaria a
   * pessoa tentando de novo o mesmo link.
   */
  test('o mesmo convite nao serve duas vezes', async ({ page }) => {
    const email = emailUnico('convidado-repetido');

    await entrar(page);

    const caminho = await convidar(page, email);

    for (const tentativa of [1, 2]) {
      await page.goto(caminho);
      await page.getByLabel('Nova senha').fill(SENHA_NOVA);
      await page.getByLabel('Repita a senha').fill(SENHA_NOVA);
      await page.getByRole('button', { name: /criar senha/i }).click();

      if (tentativa === 1) {
        await expect(page.getByTestId('aceite-concluido')).toBeVisible();
      }
    }

    await expect(page.getByText(/Convite inválido ou expirado/)).toBeVisible();
  });

  /**
   * ERRO DE DIGITAÇÃO NÃO APAGA AS DUAS SENHAS.
   *
   * Os campos nasceram não controlados, copiados do login: toda volta da
   * action os remontava vazios, e quem errava a confirmação tinha de
   * redigitar 12+ caracteres duas vezes. No login isso é certo (a senha some
   * por segurança, o e-mail volta); aqui os dois campos são senha.
   *
   * Visto abrindo a tela, não pelos testes -- os 512 unitários passavam.
   */
  test('errar a confirmacao nao limpa o que foi digitado', async ({ page }) => {
    await page.goto('/convite/token-que-nao-existe');

    const senha = page.getByLabel('Nova senha');
    const confirmacao = page.getByLabel('Repita a senha');

    await senha.fill(SENHA_NOVA);
    await confirmacao.fill('outra-senha-bem-diferente');
    await page.getByRole('button', { name: /criar senha/i }).click();

    await expect(page.getByText('As senhas não conferem')).toBeVisible();

    await expect(senha).toHaveValue(SENHA_NOVA);
    await expect(confirmacao).toHaveValue('outra-senha-bem-diferente');
  });
});
