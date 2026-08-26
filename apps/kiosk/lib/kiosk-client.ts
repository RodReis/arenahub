import { type KioskConfig, CONFIG_PADRAO_DO_TOTEM } from '@arenahub/api-contracts';

/**
 * Cliente do totem, do lado do NAVEGADOR.
 *
 * Ele NAO fala com a API direto: o segredo HMAC do dispositivo nunca pode
 * chegar ao navegador (bastaria abrir o DevTools do totem para clona-lo).
 * Toda chamada vai para `/api/kiosk/*` deste proprio app, e o Route Handler
 * -- que roda no servidor do totem, ao lado do processo -- assina e repassa.
 *
 * Consequencia de contrato: os tipos aqui espelham os da API (`SessaoAberta`,
 * `ConfiguracaoResolvida`), porque o Route Handler devolve o corpo tal e qual.
 */

export interface SessaoDoAluno {
  readonly sessionId: string;
  readonly token: string;
  readonly nome: string;
  readonly plano: {
    readonly ativo: boolean;
    readonly pendenciaEmCentavos: number | null;
  };
  readonly expiraEm: string;
}

export interface ConfigDoTotem {
  readonly version: number;
  readonly config: KioskConfig;
}

/**
 * A configuracao, com o padrao como piso.
 *
 * API fora do ar NAO pode deixar o totem sem tela: ele fica na recepcao e a
 * tela publica e mídia da academia, que precisa continuar de pe. O padrao do
 * contrato ja e o mesmo que o seed publica, entao a degradacao e invisivel
 * enquanto ninguem configurou nada.
 */
export async function carregarConfig(): Promise<ConfigDoTotem> {
  try {
    const resposta = await fetch('/api/kiosk/config', { cache: 'no-store' });

    if (!resposta.ok) return { version: 0, config: CONFIG_PADRAO_DO_TOTEM };

    return (await resposta.json()) as ConfigDoTotem;
  } catch {
    return { version: 0, config: CONFIG_PADRAO_DO_TOTEM };
  }
}

export interface RespostaDeHeartbeat {
  readonly configVersion: number;
  readonly serverTime: string;
}

/**
 * Ping periodico do totem: leva a versao do agente e o relogio local, traz a
 * versao ATUAL da config publicada (F49). E o sinal que `decidirReinicio`
 * consome para saber se a config do boot ainda vale.
 *
 * API fora do ar nao pode travar o totem: como `carregarConfig`, degrada
 * devolvendo `null` em vez de lancar -- o chamador simplesmente pula aquele
 * ciclo e tenta de novo no proximo heartbeat.
 */
export async function heartbeat(): Promise<RespostaDeHeartbeat | null> {
  try {
    const resposta = await fetch('/api/kiosk/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentVersion: '0.1.0', localTimeMs: Date.now() }),
      cache: 'no-store',
    });

    if (!resposta.ok) return null;

    return (await resposta.json()) as RespostaDeHeartbeat;
  } catch {
    return null;
  }
}

/**
 * Abre a sessao pelo CPF. `null` significa "nao foi possivel entrar".
 *
 * Decisao 4 do PI: mensagem UNICA e neutra para CPF inexistente, aluno de
 * outro tenant, status nao elegivel e erro de rede. Por isso o retorno e
 * `null` e nao um erro tipado -- nao ha o que distinguir na tela, e um tipo
 * que distinguisse convidaria alguem a exibir a diferenca.
 */
export async function abrirSessao(cpf: string): Promise<SessaoDoAluno | null> {
  try {
    const resposta = await fetch('/api/kiosk/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cpf }),
      cache: 'no-store',
    });

    if (!resposta.ok) return null;

    return (await resposta.json()) as SessaoDoAluno;
  } catch {
    return null;
  }
}

/** Novo `expiraEm`, ou `null` se a extensao falhou (a contagem segue). */
export async function estenderSessao(
  sessionId: string,
  token: string,
): Promise<string | null> {
  try {
    const resposta = await fetch(
      `/api/kiosk/sessions/${encodeURIComponent(sessionId)}/extend`,
      {
        method: 'POST',
        headers: { 'x-session-token': token },
        cache: 'no-store',
      },
    );

    if (!resposta.ok) return null;

    const corpo = (await resposta.json()) as { expiraEm: string };

    return corpo.expiraEm;
  } catch {
    return null;
  }
}

/**
 * Encerra no SERVIDOR. Nao devolve nada e nao lanca: a tela volta para a
 * publica de qualquer jeito, porque deixar o aluno preso numa tela com o
 * proprio nome porque a rede caiu e pior do que uma sessao orfa -- que o
 * `expiresAt` mata sozinha em ate 99 s.
 */
export async function encerrarSessao(sessionId: string, token: string): Promise<void> {
  try {
    await fetch(`/api/kiosk/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { 'x-session-token': token },
      cache: 'no-store',
    });
  } catch {
    // Ver acima: a limpeza local acontece de qualquer forma.
  }
}
