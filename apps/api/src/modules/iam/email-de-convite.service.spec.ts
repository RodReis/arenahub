import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/**
 * O CLIENTE DO RESEND E DUBLADO NO MODULO, nao injetado.
 *
 * O servico o constroi no proprio construtor, a partir da config -- e essa e
 * a escolha certa para producao (um cliente so, chave lida uma vez no
 * arranque). O preco e que o teste tem de interceptar o `import`.
 *
 * Sem isto, a suite mandaria e-mail DE VERDADE toda vez que rodasse com a
 * chave no ambiente: e-mail de teste na caixa de alguem, e cota do provedor
 * gasta pelo CI.
 */
const enviarDoResend = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('resend', () => ({
  Resend: class {
    emails = { send: enviarDoResend };
  },
}));

const { EmailDeConviteService } = await import('./email-de-convite.service.js');

const EMAIL = 'convidado@exemplo.test';
const TOKEN = 'token-em-claro-do-convite';

/**
 * A chave e o remetente vem do ambiente, e o servico os le no CONSTRUTOR --
 * mexer em `process.env` depois de instanciar nao teria efeito.
 */
function comAmbiente(vars: Record<string, string | undefined>): InstanceType<
  typeof EmailDeConviteService
> {
  const anterior = { ...process.env };

  for (const [chave, valor] of Object.entries(vars)) {
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }

  try {
    return new EmailDeConviteService();
  } finally {
    process.env = anterior;
  }
}

describe('EmailDeConviteService', () => {
  beforeEach(() => {
    enviarDoResend.mockReset();
  });

  /**
   * SEM CHAVE NAO ENVIA E NAO QUEBRA -- mesmo criterio da chave da Anthropic.
   *
   * Em desenvolvimento a chave falta de proposito, e lancar aqui tiraria do ar
   * a criacao de usuario inteira por causa de uma variavel que nao trava mais
   * nada.
   */
  it('sem RESEND_API_KEY nao envia, e diz por que', async () => {
    const servico = comAmbiente({ RESEND_API_KEY: undefined });

    const resultado = await servico.enviar(EMAIL, TOKEN);

    expect(resultado).toEqual({ enviado: false, motivo: 'SEM_CHAVE' });
    expect(enviarDoResend).not.toHaveBeenCalled();
  });

  it('envia com o link montado a partir da URL do painel', async () => {
    enviarDoResend.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    const servico = comAmbiente({
      RESEND_API_KEY: 're_chave_de_teste',
      PANEL_PUBLIC_URL: 'https://painel.exemplo.test',
    });

    const resultado = await servico.enviar(EMAIL, TOKEN);

    expect(resultado).toEqual({ enviado: true });

    const corpo = enviarDoResend.mock.calls[0]?.[0] as { to: string; text: string; html: string };
    expect(corpo.to).toBe(EMAIL);
    expect(corpo.text).toContain(`https://painel.exemplo.test/convite/${TOKEN}`);
    expect(corpo.html).toContain(`https://painel.exemplo.test/convite/${TOKEN}`);
  });

  /**
   * BARRA NO FIM DA URL NAO PODE VIRAR BARRA DUPLA. `//convite/x` e um
   * caminho diferente, e o link do e-mail e a unica copia do token -- quem
   * clicar num link quebrado nao tem segunda chance.
   */
  it('nao duplica a barra quando a URL do painel termina em /', async () => {
    enviarDoResend.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    const servico = comAmbiente({
      RESEND_API_KEY: 're_chave_de_teste',
      PANEL_PUBLIC_URL: 'https://painel.exemplo.test/',
    });

    await servico.enviar(EMAIL, TOKEN);

    const corpo = enviarDoResend.mock.calls[0]?.[0] as { text: string };
    expect(corpo.text).toContain(`https://painel.exemplo.test/convite/${TOKEN}`);
    expect(corpo.text).not.toContain('//convite/');
  });

  /**
   * O RESEND DEVOLVE ERRO NO CORPO, COM STATUS 200 -- nao lanca.
   *
   * Sem esta checagem, recusa por dominio nao verificado (o caso mais
   * provavel hoje) passaria por envio bem-sucedido, e a tela afirmaria que o
   * convite foi enviado enquanto ninguem o recebeu.
   */
  it('trata o erro que vem no corpo da resposta', async () => {
    enviarDoResend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } });

    const servico = comAmbiente({ RESEND_API_KEY: 're_chave_de_teste' });

    const resultado = await servico.enviar(EMAIL, TOKEN);

    expect(resultado).toEqual({ enviado: false, motivo: 'RECUSADO' });
  });

  /**
   * NUNCA LANCA. Quando este servico e chamado, o convite JA existe e o link
   * JA vale -- deixar a excecao subir derrubaria a resposta e faria a
   * recepcao achar que o convite nao foi criado, quando foi.
   */
  it('nao lanca quando a rede falha', async () => {
    enviarDoResend.mockRejectedValue(new Error('ECONNREFUSED'));

    const servico = comAmbiente({ RESEND_API_KEY: 're_chave_de_teste' });

    await expect(servico.enviar(EMAIL, TOKEN)).resolves.toEqual({
      enviado: false,
      motivo: 'RECUSADO',
    });
  });

  /**
   * TEXTO E HTML, os dois. Cliente de e-mail que bloqueia HTML mostraria uma
   * mensagem vazia, e o convite tem 24 horas para ser usado.
   */
  it('manda versao em texto e em html', async () => {
    enviarDoResend.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    const servico = comAmbiente({ RESEND_API_KEY: 're_chave_de_teste' });

    await servico.enviar(EMAIL, TOKEN);

    const corpo = enviarDoResend.mock.calls[0]?.[0] as { text?: string; html?: string };
    expect(corpo.text).toBeTruthy();
    expect(corpo.html).toBeTruthy();
  });
});
