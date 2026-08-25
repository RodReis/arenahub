import { expect, test, type Page } from '@playwright/test';

/**
 * O aceite da F49 (Slice 4.5), ponta a ponta.
 *
 * A suite navega o totem de verdade: a tela chama a ponte do proprio app, a
 * ponte assina com a credencial `dev-totem01` e a API responde contra o banco
 * de e2e. Nao ha duble em lugar nenhum -- um teste que mockasse a API
 * provaria que a tela funciona contra um duble, e o aceite desta fatia e
 * justamente que a cadeia inteira funciona.
 *
 * DADO DO SEED, nunca dado real: `packages/database/prisma/seed.ts` cria
 * `Aluno de Bancada do Totem` com o CPF falso abaixo (000.000.001-91, o menor
 * numero cujos digitos verificadores fecham) e a credencial do totem. Nenhum
 * dado de aluno de verdade entra aqui.
 */
const CPF_DO_ALUNO = '00000000191';
const NOME_DO_ALUNO = 'Aluno de Bancada do Totem';

/** Primeiro nome -- e o que a saudacao exibe (`minha-area.tsx`). */
const PRIMEIRO_NOME = 'Aluno';

/** Padroes do contrato (`CONFIG_PADRAO_DO_TOTEM`), publicados pelo seed. */
const DURACAO_SEGUNDOS = 60;
const TETO_SEGUNDOS = 99;

/**
 * O que o CONTADOR pode exibir no teto -- 100, nao 99.
 *
 * Nao e folga inventada nem teto frouxo: o servidor devolve `expiraEm =
 * agora + 99 s`, e a tela mostra `Math.ceil((expiraEm - Date.now()) / 1000)`.
 * Entre o `agora` do servidor e o `Date.now()` do navegador ha sempre alguma
 * fracao de milissegundo -- o restante vira 99,0004 s e o `ceil` sobe para
 * 100. Exigir `<= 99` aqui reprovaria o arredondamento da exibicao, nao o
 * teto, que e do dominio e ja tem prova propria e exata em
 * `apps/api/src/modules/kiosk/domain/sessao.spec.ts`.
 *
 * O que ESTE teste tem de pegar e o teto sumindo: sem ele o contador iria a
 * 129 s na segunda extensao, muito acima desta linha.
 */
const TETO_EXIBIDO = TETO_SEGUNDOS + 1;

/**
 * Leva a tela do atrator ate a area do aluno, com sessao ABERTA DE VERDADE.
 *
 * Cada passo e verificado. Isso nao e zelo: se a identificacao falhar -- por
 * credencial ausente, banco vazio ou aluno de outro tenant --, a tela cai na
 * mensagem neutra e VOLTA para o atrator. Um teste que so conferisse "voltou
 * ao atrator" no fim passaria sem nunca ter havido sessao nenhuma. Por isso a
 * jornada e provada pelo estado POSITIVO (nome visivel, contador andando)
 * antes de qualquer asercao sobre limpeza.
 */
async function abrirSessao(page: Page): Promise<void> {
  await page.goto('/');

  const entrar = page.getByRole('button', { name: /entrar na minha área/i });

  await expect(entrar).toBeVisible();
  await entrar.click();

  // O campo existe e nasce VAZIO: sem isso, um CPF do aluno anterior
  // sobrevivendo no campo passaria despercebido -- e e exatamente o tipo de
  // rastro que esta fatia existe para impedir.
  await expect(page.getByTestId('campo-de-cpf')).toHaveText(/^_{3}\.?_*/);

  for (const digito of CPF_DO_ALUNO) {
    await page.getByRole('button', { name: digito, exact: true }).first().click();
  }

  const confirmar = page.getByTestId('confirmar-cpf');

  // So habilita com os 11 digitos: prova que o teclado da tela registrou
  // todos, antes de culpar a API por uma falha que foi de digitacao.
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  // A PROVA DE QUE A SESSAO EXISTE. O nome vem da API, que so o devolve
  // depois de achar o aluno pelo hash do CPF no tenant da credencial. Se a
  // ponte nao assinasse, isto seria a mensagem neutra, e nao a saudacao.
  await expect(page.getByTestId('saudacao')).toHaveText(`Olá, ${PRIMEIRO_NOME}`);
  await expect(page.getByTestId('faixa-de-plano')).toBeVisible();

  // E a mensagem neutra NAO apareceu: o toast e o sintoma de identificacao
  // falha, e conferir que ele esta ausente fecha a porta para um falso verde
  // em que a tela mostrasse as duas coisas.
  await expect(page.getByTestId('toast-de-erro')).toHaveCount(0);
}

/**
 * Segundos restantes lidos do rodape.
 *
 * O acento em "Sessão" e CITACAO do texto que a tela renderiza, nao prosa:
 * tira-lo faria o comentario descrever uma string que nao existe. A regra de
 * comentario sem acento vale para o que se escreve, nao para o que se cita.
 */
async function segundosRestantes(page: Page): Promise<number> {
  const texto = (await page.getByTestId('contador-de-sessao').textContent()) ?? '';
  const encontrado = /(\d+)/.exec(texto);

  // Lanca em vez de devolver `NaN`: `Number('Sessão encerra em 58 s')` e
  // `NaN`, e `NaN > NaN` e `false` -- a asercao seguinte falharia dizendo que
  // o contador nao aumentou, apontando para o produto quando o defeito seria
  // desta funcao.
  if (encontrado === null) {
    throw new Error(`Contador de sessao sem numero legivel: "${texto}"`);
  }

  return Number(encontrado[1]);
}

test('atrator -> CPF -> minha area -> encerrar, sem deixar rastro', async ({ page }) => {
  await abrirSessao(page);

  // Captura o nome EXIBIDO durante a sessao -- e ele que precisa sumir.
  const saudacao = (await page.getByTestId('saudacao').textContent()) ?? '';

  expect(saudacao).toContain(PRIMEIRO_NOME);

  await page.getByTestId('encerrar-sessao').click();

  // Voltou ao atrator.
  await expect(page.getByRole('button', { name: /entrar na minha área/i })).toBeVisible();

  // ACEITE DA FATIA: nada do aluno permanece.
  const residuo = await page.evaluate(() => ({
    sessao: sessionStorage.length,
    local: localStorage.length,
    dom: document.body.innerText,
  }));

  expect(residuo.sessao).toBe(0);
  expect(residuo.local).toBe(0);

  // O nome inteiro e o primeiro nome: a saudacao mostra so o primeiro, mas
  // qualquer um dos dois no DOM depois do encerramento e vazamento.
  expect(residuo.dom).not.toContain(PRIMEIRO_NOME);
  expect(residuo.dom).not.toContain(NOME_DO_ALUNO);
  // O CPF digitado tambem nao sobrevive -- nem cru, nem mascarado.
  expect(residuo.dom).not.toContain(CPF_DO_ALUNO);
  expect(residuo.dom).not.toContain('000.000.001-91');
});

test('"Preciso de mais tempo" soma 30 s e respeita o teto de 99 s', async ({ page }) => {
  await abrirSessao(page);

  const antes = await segundosRestantes(page);

  // A sessao nasce com a duracao do contrato. Conferir isso separa "o
  // incremento nao funcionou" de "a sessao nasceu errada".
  expect(antes).toBeGreaterThan(DURACAO_SEGUNDOS - 5);
  expect(antes).toBeLessThanOrEqual(DURACAO_SEGUNDOS);

  await page.getByRole('button', { name: /preciso de mais tempo/i }).click();

  // `toPass` porque a extensao e uma ida ao servidor: assertar logo depois do
  // clique leria o contador antes da resposta chegar. Nada de `waitForTimeout`
  // -- espera fixa e flaky nos dois sentidos, curta demais no CI lento e
  // lenta a toa na maquina rapida.
  await expect(async () => {
    expect(await segundosRestantes(page)).toBeGreaterThan(antes);
  }).toPass({ timeout: 10_000 });

  const depoisDeUma = await segundosRestantes(page);

  expect(depoisDeUma).toBeLessThanOrEqual(TETO_EXIBIDO);

  // SEGUNDA extensao: 60 + 30 = 90 ainda cabe no teto, entao uma extensao
  // sozinha NAO o exercita -- um limite quebrado passaria igual. Com a
  // segunda, o desejado passa de 99 e so o teto pode segurar.
  await page.getByRole('button', { name: /preciso de mais tempo/i }).click();

  await expect(async () => {
    expect(await segundosRestantes(page)).toBeGreaterThan(depoisDeUma);
  }).toPass({ timeout: 10_000 });

  const depoisDeDuas = await segundosRestantes(page);

  expect(depoisDeDuas).toBeLessThanOrEqual(TETO_EXIBIDO);
  // E chegou PERTO do teto: se o incremento fosse ignorado, ficaria na casa
  // dos 60 e esta linha pegaria.
  expect(depoisDeDuas).toBeGreaterThan(TETO_SEGUNDOS - 10);

  // TERCEIRA extensao: aqui o teto tem de MORDER. A segunda ja encostou nele,
  // entao esta nao pode somar mais nada -- o contador so pode ficar onde
  // esta ou recuar com o tempo que passou. E esta a asercao que falha se
  // alguem trocar o `Math.min` do dominio por uma soma solta; as duas
  // anteriores, sozinhas, nao falhariam.
  await page.getByRole('button', { name: /preciso de mais tempo/i }).click();

  // `toPass` invertido nao existe: espera-se a resposta chegar (o contador
  // volta a subir para perto do teto) e so entao confere que nao passou.
  await expect(async () => {
    expect(await segundosRestantes(page)).toBeGreaterThan(TETO_SEGUNDOS - 10);
  }).toPass({ timeout: 10_000 });

  expect(await segundosRestantes(page)).toBeLessThanOrEqual(TETO_EXIBIDO);
});
