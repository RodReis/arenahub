import { expect, test } from '@playwright/test';

const DONO = { email: 'dono@arena-positiva.test', senha: 'senha-de-bancada-arenahub' };

async function entrar(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(DONO.email);
  await page.getByLabel('Senha').fill(DONO.senha);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/**
 * Prova fim-a-fim de que a Task 8 (`/team`) e a Task 2 (fix de `/students`)
 * fecham juntas: o filtro `profile != STUDENT` de `/team` e o `profile:
 * 'STUDENT'` de `/students` nao vazam um perfil no lugar do outro.
 *
 * `Professor de Bancada` (profile TRAINER) e `Aluno de Bancada do Totem`
 * (profile STUDENT) sao fixtures do seed (`packages/database/prisma/seed.ts`).
 */
test.describe('separação de perfis entre /team e /students (F81)', () => {
  test('tela de equipe lista professor e nao lista aluno comum', async ({ page }) => {
    await entrar(page);
    await page.goto('/team');

    await expect(page.getByRole('heading', { name: 'Time' })).toBeVisible();
    await expect(page.getByText('Professor de Bancada')).toBeVisible();
    await expect(page.getByText('Aluno de Bancada do Totem')).not.toBeVisible();
  });

  test('tela de alunos lista aluno comum e nao lista professor', async ({ page }) => {
    await entrar(page);
    /*
     * `?q=Bancada` casa com OS DOIS nomes de fixture ("Aluno de Bancada do
     * Totem" e "Professor de Bancada"). Sem o filtro de busca, a ausencia do
     * professor poderia se explicar so pela paginacao (72 nao-aluno + 1
     * aluno, o professor pode nunca estar na pagina que o aluno esta) -- o
     * termo de busca garante que SO o filtro `profile: 'STUDENT'` explica a
     * ausencia dele aqui.
     */
    await page.goto('/students?q=Bancada');

    await expect(page.getByText('Aluno de Bancada do Totem')).toBeVisible();
    await expect(page.getByText('Professor de Bancada')).not.toBeVisible();
  });
});
