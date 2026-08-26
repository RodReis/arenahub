import {
  type IndicadoresDaUnidade,
  type KioskConfig,
  CONFIG_PADRAO_DO_TOTEM,
} from '@arenahub/api-contracts';

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
  /**
   * Os dois numeros da tela publica (F51).
   *
   * OPCIONAL no tipo do cliente, embora a API sempre os mande: um totem que
   * ainda nao atualizou fala com uma API que ja atualizou (e vice-versa), e
   * um campo obrigatorio aqui faria o `undefined` virar `NaN` na tela em vez
   * de "sem numero ainda".
   */
  readonly indicadores?: IndicadoresDaUnidade;
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

/* ---------------------------------------------------------------------
 * AREA DO ALUNO (F52).
 *
 * Todas exigem `x-session-token`: o `sessionId` da URL sozinho nao
 * autoriza nada -- e a API confere as duas coisas.
 *
 * DEGRADAM PARA `null`, nunca lancam. Um erro nao capturado aqui deixaria
 * o totem numa tela quebrada com o nome do aluno na frente da recepcao; a
 * tela mostra "nao foi possivel carregar" e o rodape de sessao continua
 * contando. Modulo desligado responde 404 e cai no mesmo `null` -- e
 * correto: para o aluno, funcao desligada e funcao que nao existe.
 * --------------------------------------------------------------------- */

export interface CobrancaDoTotem {
  readonly paymentAttemptId: string;
  readonly forma: 'PIX' | 'CARD';
  readonly qrCodeDataUri: string;
  readonly copiaECola: string | null;
  readonly checkoutUrl: string | null;
  readonly expiraEm: string;
  readonly valorEmCentavos: number;
  readonly moeda: string;
}

export interface EstadoDaCobranca {
  readonly status: string;
  readonly statusDaFatura: string;
  readonly pagoEm: string | null;
}

export interface LinhaDePagamento {
  readonly invoiceId: string;
  readonly status: string;
  readonly vencimentoEm: string;
  readonly pagoEm: string | null;
  readonly valorEmCentavos: number;
  readonly moeda: string;
  readonly emAberto: boolean;
}

export interface MetricaDoTotem {
  readonly tipo: string;
  readonly valor: number | null;
  readonly unidade: string | null;
  readonly deltaAbsoluto: number | null;
  readonly razaoDaAusencia: string | null;
}

export interface SegmentoDoTotem {
  readonly segmento: 'ARMS' | 'TRUNK' | 'LEGS';
  readonly gorduraKg: number | null;
  readonly musculoKg: number | null;
}

export interface AvaliacaoDoTotem {
  readonly medidaEm: string | null;
  readonly aparelho: string | null;
  readonly metricas: readonly MetricaDoTotem[];
  readonly segmentos: readonly SegmentoDoTotem[];
  readonly relatorioDoAparelho: Record<string, unknown> | null;
}

export interface LinhaDeAvaliacao {
  readonly assessmentId: string;
  readonly medidaEm: string;
  readonly metricas: readonly MetricaDoTotem[];
}

export interface AnaliseDaEvolucao {
  readonly positivePoints: readonly string[];
  readonly attentionPoints: readonly string[];
  readonly disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS';
}

export interface EvolucaoDoTotem {
  readonly months: readonly {
    readonly assessedAtLocal: string;
    readonly metrics: readonly { type: string; value: number; unit: string | null }[];
  }[];
  readonly latestAnalysis: AnaliseDaEvolucao | null;
}

async function daSessao<T>(
  caminho: string,
  token: string,
  init?: { method: 'POST' },
): Promise<T | null> {
  try {
    const resposta = await fetch(`/api/kiosk/${caminho}`, {
      method: init?.method ?? 'GET',
      headers: { 'x-session-token': token },
      cache: 'no-store',
    });

    if (!resposta.ok) return null;

    return (await resposta.json()) as T;
  } catch {
    return null;
  }
}

const daSessaoId = (sessionId: string) => `sessions/${encodeURIComponent(sessionId)}`;

export function cobrarPorPix(sessionId: string, token: string) {
  return daSessao<CobrancaDoTotem>(`${daSessaoId(sessionId)}/payments/pix`, token, {
    method: 'POST',
  });
}

export function cobrarPorCartao(sessionId: string, token: string) {
  return daSessao<CobrancaDoTotem>(`${daSessaoId(sessionId)}/payments/card-checkout`, token, {
    method: 'POST',
  });
}

export function observarCobranca(sessionId: string, token: string, attemptId: string) {
  return daSessao<EstadoDaCobranca>(
    `${daSessaoId(sessionId)}/payments/${encodeURIComponent(attemptId)}`,
    token,
  );
}

export function carregarPagamentos(sessionId: string, token: string) {
  return daSessao<readonly LinhaDePagamento[]>(`${daSessaoId(sessionId)}/payments`, token);
}

/**
 * A avaliacao do aluno, ou `'sem-avaliacao'`, ou `null` se nao deu.
 *
 * TRES ESTADOS, e nao dois. O endpoint devolve corpo `null` quando o aluno
 * ainda nao tem avaliacao publicada -- que e diferente de a chamada ter
 * falhado. Colapsar os dois em `null` faria a tela dizer "voce ainda nao
 * tem avaliacao" para um aluno que TEM, toda vez que a rede da academia
 * oscilasse; e "procure a recepcao" resolve um caso e nao o outro.
 */
export async function carregarAvaliacao(
  sessionId: string,
  token: string,
): Promise<AvaliacaoDoTotem | 'sem-avaliacao' | null> {
  try {
    const resposta = await fetch(`/api/kiosk/${daSessaoId(sessionId)}/assessment`, {
      headers: { 'x-session-token': token },
      cache: 'no-store',
    });

    if (!resposta.ok) return null;

    const corpo = (await resposta.json()) as AvaliacaoDoTotem | null;

    return corpo ?? 'sem-avaliacao';
  } catch {
    return null;
  }
}

export function carregarAvaliacoes(sessionId: string, token: string) {
  return daSessao<readonly LinhaDeAvaliacao[]>(`${daSessaoId(sessionId)}/assessments`, token);
}

export function carregarEvolucao(sessionId: string, token: string) {
  return daSessao<EvolucaoDoTotem>(`${daSessaoId(sessionId)}/evolution`, token);
}
