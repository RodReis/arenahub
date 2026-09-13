import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * ---------------------------------------------------------------------------
 * O QUE PODE SAIR DO CELULAR DO ALUNO -- F29, Slice 4.7.
 * ---------------------------------------------------------------------------
 *
 * ALLOWLIST, e a escolha e o ponto inteiro deste arquivo.
 *
 * O logger do edge-agent (`apps/edge-agent/src/observability/logger.ts`) usa
 * o desenho oposto -- redige campo com nome conhecido (`token`, `cpf`,
 * `template`) e deixa passar o resto --, e o proprio comentario dele admite
 * a fraqueza: template biometrico dentro de um campo chamado `payload` passa
 * batido. Ali a lista negra e aceitavel porque quem chama o logger e codigo
 * nosso, revisado.
 *
 * AQUI NAO E. O emissor e um aplicativo instalado em aparelho que nao
 * controlamos, numa versao que pode ser mais nova que este servidor. Com
 * denylist, todo campo que ninguem anteviu -- `userEmail` numa versao futura,
 * `debugState` que alguem deixou num build -- viaja ate o provedor de crash,
 * que e um terceiro. Com allowlist, ele morre aqui e o pior caso e uma
 * metrica faltando.
 *
 * A regra de ouro: NAO E POSSIVEL IDENTIFICAR O ALUNO a partir do que este
 * arquivo deixa passar. Nenhum id de aluno, sessao, invoice ou aparelho.
 */

/** Os eventos que o piloto mede. Qualquer outro e recusado. */
export const EVENTOS_DE_CANAL = [
  'APP_OPENED',
  'LOGIN_SUCCEEDED',
  'LOGIN_FAILED',
  'SELF_SERVICE_COMPLETED',
  'KIOSK_SESSION_ENDED',
  'CHANNEL_CRASHED',
] as const;

export type EventoDeCanal = (typeof EVENTOS_DE_CANAL)[number];

export const PLATAFORMAS = ['IOS', 'ANDROID', 'KIOSK'] as const;
export type PlataformaDeCanal = (typeof PLATAFORMAS)[number];

export const BALDES_DE_DURACAO = ['LT_1S', '1S_3S', 'GT_3S'] as const;
export type BaldeDeDuracao = (typeof BALDES_DE_DURACAO)[number];

/**
 * O evento ja limpo -- o UNICO formato que segue adiante.
 *
 * `readonly` em tudo e a forma de dizer que ninguem acrescenta campo depois
 * da sanitizacao: o objeto que sai daqui e o que chega ao provedor.
 */
export interface EventoDeTelemetria {
  readonly event: EventoDeCanal;
  readonly appVersion: string;
  readonly platform: PlataformaDeCanal;
  readonly traceId: string;
  readonly durationBucket?: BaldeDeDuracao;
}

/**
 * Recusa, em vez de limpar em silencio.
 *
 * A distincao importa: campo A MAIS e erro do emissor e a gente descarta sem
 * barulho, porque o evento continua util. Mas evento DESCONHECIDO ou versao
 * malformada significam que o app esta falando outra lingua -- aceitar isso
 * produziria metrica que parece certa e nao e, e metrica errada no piloto
 * leva a decisao de go/no-go errada.
 */
export class EventoDeTelemetriaNaoPermitidoError extends ErroDeDominio {
  constructor(motivo: string) {
    super('TELEMETRY_EVENT_NOT_ALLOWED', 400, `Telemetria recusada: ${motivo}`);
  }
}

/** `1.4.0` ou `1.4.0-rc.2`. Formato fechado: campo livre aceitaria PII. */
const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,20})?$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pertence<T extends string>(lista: readonly T[], valor: unknown): valor is T {
  return typeof valor === 'string' && (lista as readonly string[]).includes(valor);
}

/**
 * Milissegundos -> balde.
 *
 * Faixa, nao numero: duracao exata e quase-identificador. Numa coorte de
 * piloto com doze pessoas, "login de 1873 ms" isola uma delas, e cruzar isso
 * com o horario reidentifica. O balde responde "esta rapido?" -- que e a
 * pergunta do piloto -- sem responder "quem e?".
 */
export function baldeDeDuracao(ms: number): BaldeDeDuracao {
  // Relogio do aparelho pode voltar entre as duas medicoes. Negativo e ruido
  // de relogio, e derrubar o evento por causa dele perderia o que importa.
  if (ms < 1000) return 'LT_1S';
  if (ms <= 3000) return '1S_3S';

  return 'GT_3S';
}

/**
 * O portao. Entra `unknown`, sai `EventoDeTelemetria` ou erro.
 *
 * NAO ha caminho que devolva campo nao declarado: a saida e construida CAMPO
 * A CAMPO a partir de literais escritos aqui, nunca por copia do objeto de
 * entrada. Um `{ ...entrada }` em qualquer lugar deste arquivo anularia o
 * proposito dele -- e por isso nao existe nenhum.
 */
export function sanitizarTelemetria(entrada: unknown): EventoDeTelemetria {
  if (typeof entrada !== 'object' || entrada === null || Array.isArray(entrada)) {
    throw new EventoDeTelemetriaNaoPermitidoError('corpo nao e objeto');
  }

  const bruto = entrada as Record<string, unknown>;

  if (!pertence(EVENTOS_DE_CANAL, bruto['event'])) {
    throw new EventoDeTelemetriaNaoPermitidoError('evento desconhecido');
  }

  if (!pertence(PLATAFORMAS, bruto['platform'])) {
    throw new EventoDeTelemetriaNaoPermitidoError('plataforma desconhecida');
  }

  const versao = bruto['appVersion'];
  if (typeof versao !== 'string' || !SEMVER.test(versao)) {
    throw new EventoDeTelemetriaNaoPermitidoError('appVersion fora do formato');
  }

  const trace = bruto['traceId'];
  if (typeof trace !== 'string' || !UUID.test(trace)) {
    throw new EventoDeTelemetriaNaoPermitidoError('traceId nao e uuid');
  }

  const duracao = bruto['durationBucket'];
  if (duracao !== undefined && !pertence(BALDES_DE_DURACAO, duracao)) {
    throw new EventoDeTelemetriaNaoPermitidoError('balde de duracao desconhecido');
  }

  return {
    event: bruto['event'],
    appVersion: versao,
    platform: bruto['platform'],
    traceId: trace,
    ...(duracao === undefined ? {} : { durationBucket: duracao }),
  };
}
