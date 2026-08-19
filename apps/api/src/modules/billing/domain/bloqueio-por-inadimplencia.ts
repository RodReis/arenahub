/**
 * Quando a inadimplencia bloqueia o acesso. `MVP-02` 7 (Slice 2.4),
 * `M2-BR-007`, e sobretudo o **ADR-019**, que decidiu a conta.
 *
 * FUNCAO PURA (`CLAUDE.md`): sem banco, sem rede, sem relogio. O "agora" e o
 * fuso entram por parametro -- e o que permite provar a regra inteira em teste
 * de tabela, incluindo os casos de virada de dia que sao a razao de ela
 * existir.
 *
 * ## A conta, e por que ela merece um ADR
 *
 * A Especificacao 42 dava o exemplo "vencimento 10/08, carencia 3 dias,
 * bloqueio 14/08". 10 + 3 = 13, nao 14. Um dia de diferenca x todo aluno
 * inadimplente x todo mes e acesso indevido sistematico -- ou negacao
 * indevida, que e pior porque acontece na frente do cliente.
 *
 * **O ADR-019 decidiu 13/08 as 00:00**, confirmando o `M2-BR-007` e
 * corrigindo o exemplo da Especificacao. O aluno tem 11 e 12 livres.
 *
 * ## Fuso da UNIDADE, sem fallback
 *
 * ADR-019 3. E onde a catraca esta e onde o aluno vive o horario. Regra
 * financeira com fallback silencioso e exatamente onde bug de um dia se
 * esconde: `?? 'America/Sao_Paulo'` faria uma unidade mal cadastrada bloquear
 * na hora errada, e ninguem descobriria ate a reclamacao no balcao.
 */

/**
 * Ancora de bloqueio -- ADR-019 2: "nao e constante, e configuracao".
 *
 * Hoje ha um valor so, e isso e deliberado: o enum existe para que uma segunda
 * politica (adiar por feriado, por exemplo) entre como valor novo em vez de
 * `if` escondido no meio do job. Regra comercial que vive dentro de um `if` e
 * regra que ninguem encontra depois.
 */
export type AncoraDeBloqueio = 'DUE_PLUS_GRACE';

export const ANCORA_DE_BLOQUEIO_PADRAO: AncoraDeBloqueio = 'DUE_PLUS_GRACE';

export interface PoliticaDeBloqueio {
  readonly ancora: AncoraDeBloqueio;
  /** Dias de tolerancia depois do vencimento. Zero bloqueia no proprio dia. */
  readonly diasDeCarencia: number;
  /** Fuso da UNIDADE (IANA). Sem fallback -- ADR-019 3. */
  readonly fusoDaUnidade: string;
}

/**
 * O instante em que a invoice passa a bloquear o acesso.
 *
 * Devolve UTC, porque e o que se grava e compara. A conta acontece no fuso da
 * unidade: "primeiro instante do dia" e meia-noite LA, nao aqui.
 *
 * `vencimento` e o `due_at` da invoice.
 */
export function instanteDeBloqueio(vencimento: Date, politica: PoliticaDeBloqueio): Date {
  if (!Number.isFinite(vencimento.getTime())) {
    throw new RangeError('vencimento invalido para calculo de bloqueio');
  }

  if (!Number.isInteger(politica.diasDeCarencia) || politica.diasDeCarencia < 0) {
    throw new RangeError(
      `carencia invalida: ${String(politica.diasDeCarencia)} -- deve ser inteiro nao negativo`,
    );
  }

  const diaLocal = dataLocalDe(vencimento, politica.fusoDaUnidade);

  return meiaNoiteLocalEmUtc(
    { ...diaLocal, dia: diaLocal.dia + politica.diasDeCarencia },
    politica.fusoDaUnidade,
  );
}

/**
 * A invoice ja deve bloquear neste instante?
 *
 * `>=` e nao `>`: o ADR-019 diz "PRIMEIRO instante". A meia-noite exata ja
 * bloqueia -- com `>`, o aluno teria a madrugada inteira de sobra por causa de
 * um sinal.
 */
export function deveBloquear(
  vencimento: Date,
  politica: PoliticaDeBloqueio,
  agora: Date,
): boolean {
  return agora.getTime() >= instanteDeBloqueio(vencimento, politica).getTime();
}

interface DataLocal {
  readonly ano: number;
  readonly mes: number;
  readonly dia: number;
}

/**
 * Que dia era, no fuso da unidade, no instante dado.
 *
 * `Intl` e nao aritmetica de milissegundos: uma invoice que vence as 21h em
 * Sao Paulo ja e o dia seguinte em UTC, e contar a carencia sobre o dia
 * errado adianta o bloqueio em 24 horas.
 */
function dataLocalDe(instante: Date, timeZone: string): DataLocal {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instante);

  const valor = (tipo: string): number => {
    const parte = partes.find((p) => p.type === tipo)?.value;

    if (parte === undefined) {
      throw new RangeError(`fuso invalido para calculo de bloqueio: ${timeZone}`);
    }

    return Number(parte);
  };

  return { ano: valor('year'), mes: valor('month'), dia: valor('day') };
}

/**
 * O instante UTC da meia-noite local de uma data.
 *
 * NAO EXISTE API DIRETA para isto. O metodo: chutar a meia-noite como se o
 * fuso fosse UTC, medir o quanto o fuso real desloca naquele instante, e
 * corrigir. Duas passadas porque o proprio deslocamento muda com a data --
 * horario de verao -- e a primeira correcao pode cair do outro lado da
 * virada.
 *
 * `dia` pode passar do fim do mes (`31 + 3`): `Date.UTC` normaliza sozinho, e
 * e por isso que a soma de carencia pode ser feita antes de chegar aqui.
 */
function meiaNoiteLocalEmUtc(data: DataLocal, timeZone: string): Date {
  const alvo = Date.UTC(data.ano, data.mes - 1, data.dia, 0, 0, 0, 0);
  let palpite = alvo;

  /**
   * ## O dia em que a meia-noite NAO EXISTE
   *
   * A revisao de codigo suspeitou que duas passadas nao bastariam em fusos de
   * meia hora. Varri 2026 inteiro nos fusos citados e eles convergem -- mas a
   * varredura achou OUTRO caso, pior e real: **06/09/2026 em
   * `America/Santiago`**.
   *
   * O horario de verao do Chile comeca a meia-noite: o relogio pula de 23:59
   * direto para 01:00, e **as 00:00 daquele dia simplesmente nao acontecem**.
   * O ponto fixo nao existe, e o laco oscila entre 03:00Z e 04:00Z para
   * sempre -- duas passadas, oito, mil.
   *
   * Um laco que aceitasse o ultimo palpite devolveria 03:00Z ou 04:00Z
   * conforme a paridade do numero de passadas. Bloqueio uma hora deslocado,
   * sem erro, uma vez por ano, na academia que ninguem olha -- o "bug de um
   * dia escondido" que o ADR-019 existe para impedir, na sua forma mais
   * dificil de achar.
   *
   * ## O que fazemos: a PRIMEIRA hora que existe
   *
   * Quando a meia-noite nao existe, o bloqueio vale do primeiro instante que
   * existe naquele dia -- 01:00 local, no caso do Chile. E a leitura fiel do
   * ADR-019 ("primeiro instante de `due_date + grace_period`"): o dia comecou,
   * so comecou mais tarde.
   *
   * Detectamos pela ida e volta: se o palpite convertido de volta para data
   * local cair no DIA CERTO, ele serve -- ainda que a hora nao seja 00:00.
   * Se cair em outro dia, e defeito de verdade e falhamos alto.
   */
  for (let passada = 0; passada < 4; passada += 1) {
    const corrigido = alvo - deslocamentoEmMs(new Date(palpite), timeZone);

    if (corrigido === palpite) {
      return new Date(palpite);
    }

    palpite = corrigido;
  }

  /**
   * Nao houve ponto fixo. Dos dois candidatos da oscilacao, vale o MAIS CEDO
   * que ainda cai no dia certo -- e o primeiro instante que existe.
   */
  const candidatos = [palpite, alvo - deslocamentoEmMs(new Date(palpite), timeZone)].sort(
    (a, b) => a - b,
  );

  for (const candidato of candidatos) {
    const local = dataLocalDe(new Date(candidato), timeZone);

    if (local.ano === data.ano && local.mes === data.mes && local.dia === data.dia) {
      return new Date(candidato);
    }
  }

  throw new RangeError(
    `nao foi possivel resolver o inicio de ${String(data.ano)}-${String(data.mes)}-${String(data.dia)} em ${timeZone}`,
  );
}

/**
 * Quantos milissegundos o fuso esta a frente de UTC NESTE instante.
 *
 * Positivo a leste de Greenwich. Sao Paulo devolve -10800000 (UTC-3).
 */
function deslocamentoEmMs(instante: Date, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);

  const valor = (tipo: string): number => {
    const parte = partes.find((p) => p.type === tipo)?.value;

    if (parte === undefined) {
      throw new RangeError(`fuso invalido para calculo de bloqueio: ${timeZone}`);
    }

    return Number(parte);
  };

  const comoSeFosseUtc = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
    valor('second'),
  );

  return comoSeFosseUtc - instante.getTime();
}
