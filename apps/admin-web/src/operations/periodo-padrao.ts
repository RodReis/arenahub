/**
 * Período padrão do filtro de eventos de acesso -- `M1-FR-024`.
 *
 * A API abre "eventos de acesso" nas últimas 24 h quando `from`/`to` estão
 * ausentes (`PERIODO_PADRAO_HORAS`, `access-query.repository.ts`), mas nunca
 * devolve esse período calculado na resposta -- só os eventos e
 * `periodoLimitado`. Sem preencher o formulário, a academia via os campos
 * `De`/`Até` em branco mesmo com a lista cheia, e o único jeito de saber o
 * período real era ler a hora do primeiro e do último evento na tabela.
 *
 * A HORA É CALCULADA NO FUSO DA ACADEMIA, não em UTC nem no fuso do
 * navegador de quem abriu a tela: o operador em Manaus vendo o filtro de uma
 * unidade em São Paulo precisa do relógio de São Paulo, não do dele.
 *
 * `Intl.DateTimeFormat(...).formatToParts()` é a mesma técnica de
 * `src/billing/vencimento.ts` (F53, ADR-019) para o mesmo problema -- obter a
 * hora civil num fuso IANA em JS puro, sem biblioteca de data nova.
 */

const HORAS_EM_MS = 60 * 60 * 1000;

/** Mesmo valor de `PERIODO_PADRAO_HORAS` em `access-query.repository.ts` -- fonte única lá, refletida aqui. */
const PERIODO_PADRAO_HORAS = 24;

function paraDatetimeLocal(instante: Date, timezone: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instante);

  const valor = (tipo: string): string => {
    const parte = partes.find((p) => p.type === tipo)?.value;

    if (parte === undefined) {
      throw new RangeError(`fuso invalido para periodo padrao de eventos: ${timezone}`);
    }

    return parte;
  };

  // Formato que <input type="datetime-local"> aceita como defaultValue:
  // YYYY-MM-DDTHH:mm, sem segundos e sem fuso.
  return `${valor('year')}-${valor('month')}-${valor('day')}T${valor('hour')}:${valor('minute')}`;
}

/**
 * O caminho de volta: `YYYY-MM-DDTHH:mm` digitado no fuso da academia vira
 * instante ISO (UTC). `undefined` para entrada mal-formada.
 *
 * `new Date('2026-10-01T10:15')` lê a hora no fuso do PROCESSO -- e o
 * servidor do painel roda em UTC. O filtro "10:15 a 11:15" de Brasília
 * virava 07:15 a 08:15, e a passagem das 11:10 sumia da lista (Arena
 * Positiva, 01/10/2026).
 *
 * Técnica: lê o valor como se fosse UTC, mede quanto o fuso difere nesse
 * instante e desconta. A segunda passada acerta a virada de horário de
 * verão, quando o deslocamento do palpite e o do resultado diferem.
 */
export function instanteNoFuso(valor: string, timezone: string): string | undefined {
  const comoUtc = Date.parse(`${valor}:00Z`);

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) || !Number.isFinite(comoUtc)) {
    return undefined;
  }

  const deslocamento = (instante: number): number =>
    Date.parse(`${paraDatetimeLocal(new Date(instante), timezone)}:00Z`) - instante;

  let instante = comoUtc - deslocamento(comoUtc);
  instante = comoUtc - deslocamento(instante);

  return new Date(instante).toISOString();
}

export interface PeriodoPadrao {
  readonly de: string;
  readonly ate: string;
}

/**
 * As últimas 24 h, no fuso da academia, no formato que o input
 * `datetime-local` aceita como valor preenchido.
 */
export function periodoPadraoDeEventos(agora: Date, timezone: string): PeriodoPadrao {
  const inicio = new Date(agora.getTime() - PERIODO_PADRAO_HORAS * HORAS_EM_MS);

  return {
    de: paraDatetimeLocal(inicio, timezone),
    ate: paraDatetimeLocal(agora, timezone),
  };
}
