import { ErroDeDominio } from '../../../common/http/erro-de-dominio.js';

/**
 * Regras de janela de acesso do plano.
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" e a data
 * concreta entram por parametro.
 *
 * ESCOPO, e o que NAO esta aqui: INV-059 diz que limite semanal, aulas
 * inclusas, convidados, fidelidade e multa sao `[indefinido]` -- nao existe
 * campo nem fonte de configuracao para eles. `M1-FR-009` cobre unidades,
 * dias, horarios e validade, e e so isso que este arquivo implementa.
 */

/** Minutos desde a meia-noite local. */
export const MINUTOS_POR_DIA = 24 * 60;

/**
 * 0 = domingo ... 6 = sabado. Mesmo eixo de `Date.getDay()`, de
 * `resolverHoraLocal` e de `AccessWindow.dayOfWeek`.
 *
 * O eixo e do MOTOR, nao ISO-8601, e essa escolha nao e estetica: e o motor
 * que decide se a porta abre, e ele le `Date.getDay()`. Ate 21/08/2026 este
 * arquivo validava ISO 1..7 enquanto o motor consumia 0..6 -- segunda a
 * sabado coincidiam (1..6 existe nos dois eixos) e o DOMINGO negava todo
 * mundo com `OUTSIDE_SCHEDULE`, porque o `7` gravado nao existe no eixo do
 * motor. Ver issue #129.
 */
export type DiaDaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface JanelaDeAcesso {
  gymUnitId: string;
  dayOfWeek: number;
  /** Inclusivo. */
  startMinute: number;
  /** Exclusivo -- ver `instanteDentroDaJanela`. */
  endMinute: number;
}

export class JanelaDeAcessoInvalidaError extends ErroDeDominio {
  constructor(motivo: string) {
    super('PLAN_INVALID_ACCESS_WINDOW', 422, motivo);
  }
}

/**
 * Valida uma janela isolada.
 *
 * `endMinute` maior que `startMinute`, sempre. Intervalo que vira o dia
 * (22h-02h) NAO se representa com fim menor que inicio: entra como DUAS
 * janelas, uma ate 24:00 e outra a partir de 00:00 do dia seguinte. Aceitar
 * o fim menor obrigaria todo consumidor a lembrar do caso especial -- e o
 * motor de decisao de F9 e um deles.
 */
function validarJanelaIsolada(janela: JanelaDeAcesso): void {
  if (!Number.isInteger(janela.dayOfWeek) || janela.dayOfWeek < 0 || janela.dayOfWeek > 6) {
    throw new JanelaDeAcessoInvalidaError('dia da semana deve estar entre 0 e 6 (0 = domingo)');
  }

  if (!Number.isInteger(janela.startMinute) || !Number.isInteger(janela.endMinute)) {
    throw new JanelaDeAcessoInvalidaError('horario deve ser inteiro de minutos');
  }

  if (janela.startMinute < 0 || janela.endMinute > MINUTOS_POR_DIA) {
    throw new JanelaDeAcessoInvalidaError('horario fora do intervalo de um dia');
  }

  if (janela.endMinute <= janela.startMinute) {
    throw new JanelaDeAcessoInvalidaError(
      'fim deve ser maior que inicio; virada de dia entra como duas janelas',
    );
  }
}

/**
 * Ordena por unidade, dia e inicio. Deterministico de proposito: a mesma
 * entrada produz a mesma saida, entao o snapshot gravado no entitlement e
 * comparavel byte a byte entre execucoes.
 */
export function ordenarJanelas(janelas: readonly JanelaDeAcesso[]): JanelaDeAcesso[] {
  return [...janelas].sort(
    (a, b) =>
      a.gymUnitId.localeCompare(b.gymUnitId) ||
      a.dayOfWeek - b.dayOfWeek ||
      a.startMinute - b.startMinute ||
      a.endMinute - b.endMinute,
  );
}

/**
 * Valida o conjunto: cada janela isolada, e nenhuma sobreposicao dentro da
 * mesma unidade e mesmo dia.
 *
 * Sobreposicao e recusada em vez de mesclada. Mesclar silenciosamente
 * esconderia erro de cadastro -- e o operador so descobriria pelo aluno que
 * entrou fora do horario que ele acreditava ter configurado.
 *
 * Janelas que apenas se encostam (`08:00-12:00` e `12:00-18:00`) NAO se
 * sobrepoem: o fim e exclusivo.
 */
export function validarJanelas(janelas: readonly JanelaDeAcesso[]): JanelaDeAcesso[] {
  for (const janela of janelas) validarJanelaIsolada(janela);

  const ordenadas = ordenarJanelas(janelas);

  for (let i = 1; i < ordenadas.length; i += 1) {
    const anterior = ordenadas[i - 1]!;
    const atual = ordenadas[i]!;

    const mesmoContexto =
      anterior.gymUnitId === atual.gymUnitId && anterior.dayOfWeek === atual.dayOfWeek;

    if (mesmoContexto && atual.startMinute < anterior.endMinute) {
      throw new JanelaDeAcessoInvalidaError(
        `janelas sobrepostas na unidade ${atual.gymUnitId}, dia ${atual.dayOfWeek}`,
      );
    }
  }

  return ordenadas;
}

/**
 * Dia da semana e minuto local de um instante, no timezone da unidade.
 *
 * `Intl.DateTimeFormat` faz a conversao usando a base IANA do runtime, em
 * vez de aritmetica de offset. Offset fixo erraria em todo pais com horario
 * de verao -- e o ADR-019 ja exige timezone da unidade sem fallback.
 */
export function momentoLocal(
  instante: Date,
  timezone: string,
): { dayOfWeek: number; minute: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instante);

  const buscar = (tipo: string): string =>
    partes.find((p) => p.type === tipo)?.value ?? '';

  // 0 = domingo ... 6 = sabado -- eixo do motor de decisao (#129). Este mapa
  // dizia `Sun: 7` e era a SEGUNDA fonte do mesmo defeito, duplicando
  // `resolverHoraLocal` com o eixo trocado.
  const dias: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  // `hour12: false` produz "24" para meia-noite em alguns runtimes; 24:00 e
  // 00:00 do mesmo dia.
  const hora = Number(buscar('hour')) % 24;

  const dia = dias[buscar('weekday')];

  // Falhar alto em vez de cair para um dia qualquer: com `?? 0` um fuso sem
  // tzdata viraria "domingo" silenciosamente, e a janela de domingo abriria
  // a catraca em qualquer dia da semana. Mesma escolha de `resolverHoraLocal`.
  if (dia === undefined) {
    throw new RangeError(`fuso desconhecido ou sem tzdata: ${timezone}`);
  }

  return {
    dayOfWeek: dia,
    minute: hora * 60 + Number(buscar('minute')),
  };
}

/**
 * O instante cai dentro de alguma janela da unidade?
 *
 * Inicio inclusivo, fim EXCLUSIVO. Uma janela `08:00-12:00` permite entrar
 * as 08:00 e nao permite as 12:00 -- sem isso, duas janelas encostadas
 * fariam o instante 12:00 pertencer a ambas, e "mais restritiva prevalece"
 * (INV-034) deixaria de ter resposta unica.
 */
export function instanteDentroDaJanela(
  instante: Date,
  timezone: string,
  gymUnitId: string,
  janelas: readonly JanelaDeAcesso[],
): boolean {
  const { dayOfWeek, minute } = momentoLocal(instante, timezone);

  return janelas.some(
    (j) =>
      j.gymUnitId === gymUnitId &&
      j.dayOfWeek === dayOfWeek &&
      minute >= j.startMinute &&
      minute < j.endMinute,
  );
}

/**
 * Interseccao de dois conjuntos de janelas -- a regra MAIS RESTRITIVA
 * (INV-034, `M1-BR-006`).
 *
 * Usada quando o direito ja concedido encontra uma regra sobreposta: o
 * resultado e o tempo em que AMBAS permitem, nunca a uniao. Se as duas nao
 * se cruzam em nenhum minuto, o resultado e vazio -- que e a resposta certa,
 * e nao motivo para cair na menos restritiva.
 */
export function interseccaoDeJanelas(
  a: readonly JanelaDeAcesso[],
  b: readonly JanelaDeAcesso[],
): JanelaDeAcesso[] {
  const resultado: JanelaDeAcesso[] = [];

  for (const janelaA of a) {
    for (const janelaB of b) {
      if (janelaA.gymUnitId !== janelaB.gymUnitId) continue;
      if (janelaA.dayOfWeek !== janelaB.dayOfWeek) continue;

      const inicio = Math.max(janelaA.startMinute, janelaB.startMinute);
      const fim = Math.min(janelaA.endMinute, janelaB.endMinute);

      if (inicio < fim) {
        resultado.push({
          gymUnitId: janelaA.gymUnitId,
          dayOfWeek: janelaA.dayOfWeek,
          startMinute: inicio,
          endMinute: fim,
        });
      }
    }
  }

  return ordenarJanelas(resultado);
}
