/**
 * Conversao de instante UTC para dia/minuto LOCAL da unidade.
 *
 * Mora aqui, e nao dentro de `evaluateAccess`, por uma razao especifica: esta
 * funcao DEPENDE da tzdata do runtime, e o motor nao pode depender de nada.
 * Separando, o motor continua testavel sem fuso e esta conversao continua
 * sendo o unico ponto onde a base de fusos importa -- entao ela e o unico
 * lugar a auditar quando o Brasil mexer no horario de verao de novo.
 *
 * `Intl.DateTimeFormat` e usado em vez de aritmetica de offset porque offset
 * fixo erra exatamente nos dois dias do ano em que a academia mais precisa
 * acertar: a virada do horario de verao.
 */

export interface HoraLocal {
  /** 0 = domingo ... 6 = sabado. Mesmo eixo do `AccessWindow.dayOfWeek`. */
  readonly dayOfWeek: number;
  /** 0..1439. */
  readonly minuteOfDay: number;
}

const DIAS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * @param instante ISO-8601 ou `Date`.
 * @param timeZone IANA, ex. `America/Sao_Paulo`. Vem da `GymUnit`.
 * @throws se o fuso for desconhecido ou o instante invalido. Falhar alto e
 *   deliberado: cair para UTC em silencio faria a janela de horario deslizar
 *   tres horas e negar acesso legitimo a manha inteira sem nenhum erro.
 */
export function resolverHoraLocal(instante: string | Date, timeZone: string): HoraLocal {
  const data = typeof instante === 'string' ? new Date(instante) : instante;

  if (!Number.isFinite(data.getTime())) {
    throw new RangeError(`instante invalido para conversao de fuso: ${String(instante)}`);
  }

  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const partes = formato.formatToParts(data);
  const pegar = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';

  const dia = DIAS[pegar('weekday')];
  const hora = Number.parseInt(pegar('hour'), 10);
  const minuto = Number.parseInt(pegar('minute'), 10);

  if (dia === undefined || !Number.isFinite(hora) || !Number.isFinite(minuto)) {
    throw new RangeError(`fuso desconhecido ou sem tzdata: ${timeZone}`);
  }

  // `hour12: false` produz 24 na meia-noite em algumas versoes de ICU.
  // Normalizar aqui evita `minuteOfDay` = 1440, que nao existe.
  const horaNormalizada = hora === 24 ? 0 : hora;

  return { dayOfWeek: dia, minuteOfDay: horaNormalizada * 60 + minuto };
}

/**
 * Dia do calendario LOCAL de um instante, no formato `YYYY-MM-DD`.
 *
 * Existe porque `resolverHoraLocal` responde "que horas sao la", e nao "que
 * DIA e la" -- e comparar dia com meia-noite UTC erra o dia inteiro em todo
 * fuso negativo: meia-noite UTC ja e o dia anterior em Sao Paulo.
 *
 * O formato ordena lexicograficamente igual a cronologia, entao `<` e `>`
 * entre duas strings comparam datas sem reintroduzir aritmetica de offset.
 *
 * @param instante ISO-8601 ou `Date`.
 * @param timeZone IANA, ex. `America/Sao_Paulo`.
 * @throws se o fuso for desconhecido ou o instante invalido -- mesma razao de
 *   `resolverHoraLocal`: cair para UTC em silencio deslizaria o dia.
 */
export function resolverDiaLocal(instante: string | Date, timeZone: string): string {
  const data = typeof instante === 'string' ? new Date(instante) : instante;

  if (!Number.isFinite(data.getTime())) {
    throw new RangeError(`instante invalido para conversao de fuso: ${String(instante)}`);
  }

  // `en-CA` produz exatamente `YYYY-MM-DD`, sem montagem manual de partes.
  const dia = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(data);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    throw new RangeError(`fuso desconhecido ou sem tzdata: ${timeZone}`);
  }

  return dia;
}
