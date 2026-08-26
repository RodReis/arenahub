import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura de requisicao do Edge. CONTRATO CONGELADO.
 *
 * Este arquivo e compartilhado entre a API (quem verifica) e o Edge Agent
 * (quem assina) de proposito: duas implementacoes da mesma regra divergem no
 * primeiro detalhe esquecido -- uma normaliza a query, a outra nao -- e o
 * sintoma em campo e um 401 que ninguem reproduz.
 *
 * Mudar qualquer coisa aqui quebra todo Edge instalado. Nao e refatoravel
 * sem rotacao coordenada.
 *
 * Forma do texto canonico, uma linha por campo, separadas por `\n`:
 *
 *   ARENAHUB-HMAC-SHA256
 *   {keyId}
 *   {unixTimestampSeconds}
 *   {nonceBase64url}
 *   {METODO_MAIUSCULO}
 *   {caminhoEQueryNormalizados}
 *   {sha256HexMinusculoDoCorpo}
 */

/** Prefixo de versao. Trocar o algoritmo troca esta string. */
export const PREFIXO_CANONICO = 'ARENAHUB-HMAC-SHA256';

export const CABECALHOS = {
  keyId: 'x-edge-key-id',
  timestamp: 'x-edge-timestamp',
  nonce: 'x-edge-nonce',
  signature: 'x-edge-signature',
} as const;

/**
 * Os MESMOS quatro campos, com nomes proprios do totem.
 *
 * Cabecalho separado porque totem e Edge tem ciclo de vida e revogacao
 * independentes (tabela de credencial propria). O ALGORITMO e identico --
 * mesmo `assinar`, mesmo texto canonico -- e por isso os nomes moram aqui, ao
 * lado dele: quem assina no totem e quem verifica na API tem de ler a mesma
 * lista, e uma segunda copia em cada lado e a divergencia que este pacote
 * existe para impedir.
 */
export const CABECALHOS_DO_KIOSK = {
  keyId: 'x-kiosk-key-id',
  timestamp: 'x-kiosk-timestamp',
  nonce: 'x-kiosk-nonce',
  signature: 'x-kiosk-signature',
} as const;

/**
 * Tolerancia de relogio, em segundos.
 *
 * PC de academia raramente tem NTP. 300 s (5 min) e largo o bastante para
 * relogio torto de campo e curto o bastante para que a janela de repeticao
 * de um nonce capturado seja pequena.
 */
export const JANELA_DE_RELOGIO_EM_SEGUNDOS = 300;

export interface RequisicaoAssinavel {
  keyId: string;
  /** Segundos desde a epoca, inteiro. */
  timestamp: number;
  /** Aleatorio por requisicao, em base64url. */
  nonce: string;
  method: string;
  /** Caminho com query, como sai da URL: `/api/v1/edge/commands?after=3`. */
  pathAndQuery: string;
  /** Corpo cru, exatamente como vai no fio. String vazia quando nao ha. */
  body: string;
}

/**
 * SHA-256 do corpo, em hex minusculo.
 *
 * Corpo vazio tem hash tambem -- o do string vazia. Deixar o campo em branco
 * quando nao ha corpo permitiria trocar `GET` sem corpo por `POST` com corpo
 * mantendo a assinatura.
 */
export function calcularHashDoCorpo(corpo: string): string {
  return createHash('sha256').update(corpo, 'utf8').digest('hex');
}

/**
 * Normaliza caminho e query para a assinatura.
 *
 * Ordena os parametros por chave e depois por valor, ambos ja codificados.
 * Sem ordenacao, `?a=1&b=2` e `?b=2&a=1` -- a mesma requisicao para
 * qualquer servidor -- produziriam assinaturas diferentes, e o Edge
 * levaria 401 por causa da ordem em que montou a URL.
 */
export function normalizarCaminhoEQuery(pathAndQuery: string): string {
  const separador = pathAndQuery.indexOf('?');

  if (separador === -1) return pathAndQuery;

  const caminho = pathAndQuery.slice(0, separador);
  const consulta = pathAndQuery.slice(separador + 1);

  if (consulta === '') return caminho;

  const pares = consulta
    .split('&')
    .filter((par) => par !== '')
    .map((par) => {
      const igual = par.indexOf('=');

      return igual === -1
        ? ([par, ''] as const)
        : ([par.slice(0, igual), par.slice(igual + 1)] as const);
    })
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  return `${caminho}?${pares.map(([chave, valor]) => `${chave}=${valor}`).join('&')}`;
}

/** Monta o texto canonico. Determinístico: mesma entrada, mesma saida. */
export function montarTextoCanonico(requisicao: RequisicaoAssinavel): string {
  return [
    PREFIXO_CANONICO,
    requisicao.keyId,
    String(requisicao.timestamp),
    requisicao.nonce,
    requisicao.method.toUpperCase(),
    normalizarCaminhoEQuery(requisicao.pathAndQuery),
    calcularHashDoCorpo(requisicao.body),
  ].join('\n');
}

/** HMAC-SHA256 do texto canonico, em hex minusculo. */
export function assinar(requisicao: RequisicaoAssinavel, segredo: string): string {
  return createHmac('sha256', segredo)
    .update(montarTextoCanonico(requisicao), 'utf8')
    .digest('hex');
}

/**
 * Compara assinaturas em TEMPO CONSTANTE.
 *
 * `a === b` vaza, pelo tempo de resposta, quantos caracteres iniciais batem
 * -- o que permite descobrir a assinatura byte a byte. `timingSafeEqual`
 * exige buffers do mesmo tamanho, dai a checagem de comprimento antes.
 */
export function assinaturaConfere(esperada: string, recebida: string): boolean {
  if (esperada.length !== recebida.length) return false;

  return timingSafeEqual(Buffer.from(esperada, 'utf8'), Buffer.from(recebida, 'utf8'));
}

/** Hash do nonce, para guardar sem reter o valor bruto. */
export function calcularHashDoNonce(nonce: string): string {
  return createHash('sha256').update(nonce, 'utf8').digest('hex');
}

/** Por que uma requisicao assinada foi recusada. Codigos estaveis. */
export type MotivoDeRecusa =
  | 'EDGE_SIGNATURE_MISSING'
  | 'EDGE_SIGNATURE_INVALID'
  | 'EDGE_TIMESTAMP_OUT_OF_WINDOW'
  | 'EDGE_KEY_UNKNOWN'
  | 'EDGE_KEY_REVOKED'
  | 'EDGE_REPLAY_DETECTED';

/**
 * O timestamp esta dentro da janela aceitavel?
 *
 * Compara em valor absoluto: relogio adiantado e tao suspeito quanto
 * atrasado, e aceitar futuro permitiria pre-assinar requisicoes.
 */
export function timestampEstaNaJanela(
  timestampDaRequisicao: number,
  agoraEmSegundos: number,
  janelaEmSegundos: number = JANELA_DE_RELOGIO_EM_SEGUNDOS,
): boolean {
  return Math.abs(agoraEmSegundos - timestampDaRequisicao) <= janelaEmSegundos;
}
