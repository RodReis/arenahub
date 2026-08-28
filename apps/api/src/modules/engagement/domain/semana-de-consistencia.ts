/**
 * Consistencia semanal e streak (F32, Slice 5.3).
 *
 * PURO: sem banco, sem relogio, sem fuso. O dia local, as pausas e o "hoje"
 * entram por parametro -- `CLAUDE.md`, "funcoes de calculo puras".
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO DELIBERADAMENTE NAO FAZ: CONVERTER FUSO.
 * ---------------------------------------------------------------------------
 *
 * Toda data aqui e `AAAA-MM-DD` NO FUSO DA UNIDADE, ja resolvido por quem
 * chama -- `StudentAttendanceSession.sessionDate` e `@db.Date` justamente por
 * isso (F24). Aceitar `Date` neste arquivo convidaria a reconverter o fuso na
 * leitura, aplicando-o duas vezes: o erro classico que joga o treino de
 * domingo a noite para a semana seguinte. Texto entra, texto sai.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NAO HA TABELA DE PROJECAO.
 * ---------------------------------------------------------------------------
 *
 * `StudentAttendanceSession` JA e a projecao de dias treinados, ja deduplicada
 * por `(aluno, dia local, unidade, politica)` no indice unico da F24. O streak
 * e uma funcao dela -- materializa-lo numa segunda tabela criaria uma segunda
 * fonte de verdade que precisa de rebuild e pode divergir da primeira, sem
 * nenhum ganho: o placar ao vivo da F31 (`posicaoAoVivoDoAluno`) resolveu o
 * mesmo problema pelo mesmo caminho.
 *
 * "Prevencao de multipla pontuacao diaria" (Slice 5.3) portanto NAO e uma
 * guarda escrita aqui: e o indice unico da F24, no banco. Um `if` nesta camada
 * seria a guarda que le antes de escrever, e perde a corrida por construcao.
 */

/** Um dia em que o aluno treinou -- `AAAA-MM-DD` no fuso da unidade. */
export interface DiaTreinado {
  readonly dataLocal: string;
}

/**
 * Uma pausa de assinatura aprovada, em dias locais.
 *
 * `fim: null` = pausa ainda aberta (o aluno nao retomou). Reconstruida pelo
 * repositorio a partir dos eventos `SUBSCRIPTION_PAUSED`/`SUBSCRIPTION_RESUMED`
 * da timeline -- `Subscription` guarda o STATUS corrente, nao o historico, e o
 * streak precisa saber que houve pausa em julho mesmo com a assinatura ativa
 * hoje.
 */
export interface PausaAprovada {
  readonly inicio: string;
  /** `null` = em aberto, cobre de `inicio` em diante. */
  readonly fim: string | null;
}

/**
 * A politica de consistencia. VERSIONADA pelo mesmo motivo de
 * `POLITICA_DE_SESSAO`: trocar a meta muda o que o numero significa, e quem
 * comparar streaks de duas versoes esta comparando coisas diferentes.
 */
export interface PoliticaDeStreak {
  readonly versao: string;
  /** Dias distintos que qualificam uma semana. */
  readonly diasPorSemana: number;
}

/**
 * `M5-BR-005`: semanas consistentes, nunca dias consecutivos ilimitados.
 *
 * Fechado por CONSTRUCAO -- nao existe campo `cadencia` que alguem possa
 * virar para `DIARIA`. A unica coisa configuravel e quantos dias qualificam a
 * semana; a semana em si e a unidade, sempre.
 *
 * Tres dias e a meta decidida pelo PI em 27/08/2026, com a semana comecando na
 * SEGUNDA (o domingo fecha a semana, nao abre a proxima).
 */
export const POLITICA_DE_STREAK: PoliticaDeStreak = {
  versao: 'semana-civil-local@1',
  diasPorSemana: 3,
};

export type StatusDaSemana = 'QUALIFICADA' | 'PERDIDA' | 'PAUSADA' | 'EM_ANDAMENTO';

/** Uma semana avaliada -- a unidade do streak. */
export interface SemanaAvaliada {
  /** Segunda-feira da semana, `AAAA-MM-DD`. E a identidade da semana. */
  readonly inicio: string;
  /** Domingo da semana, `AAAA-MM-DD`. */
  readonly fim: string;
  /** Dias DISTINTOS treinados. Passagem repetida no mesmo dia nao soma. */
  readonly diasTreinados: number;
  readonly status: StatusDaSemana;
}

export interface ResumoDeStreak {
  /** Semanas qualificadas seguidas ate hoje. Pausa nao rompe, nao soma. */
  readonly atual: number;
  /** A maior sequencia ja alcancada. */
  readonly recorde: number;
}

const MILISSEGUNDOS_POR_DIA = 86_400_000;

/**
 * Aritmetica de data em UTC, sobre texto `AAAA-MM-DD`.
 *
 * `Date.UTC` e nao `new Date('2026-08-24')` com getters locais: os getters
 * locais deslocariam o dia conforme o fuso do PROCESSO, e um servidor em
 * UTC-3 devolveria a semana anterior para toda segunda-feira. Como a entrada
 * ja e dia local resolvido, tratar tudo como UTC mantem a aritmetica exata --
 * nao ha horario de verao em meia-noite UTC.
 */
function paraUtc(dataLocal: string): number {
  const [ano, mes, dia] = dataLocal.split('-').map(Number) as [number, number, number];
  return Date.UTC(ano, mes - 1, dia);
}

function paraTexto(utc: number): string {
  return new Date(utc).toISOString().slice(0, 10);
}

/**
 * A segunda-feira da semana a que `dataLocal` pertence.
 *
 * `getUTCDay()` devolve 0 para domingo; o `|| 7` o move para o FIM da semana
 * em vez do comeco. Sem isso, domingo abriria uma semana propria de um dia so
 * -- e quem treinasse sabado e domingo teria duas semanas de uma tacada.
 */
export function inicioDaSemanaLocal(dataLocal: string): string {
  const utc = paraUtc(dataLocal);
  const diaDaSemana = new Date(utc).getUTCDay() || 7;

  return paraTexto(utc - (diaDaSemana - 1) * MILISSEGUNDOS_POR_DIA);
}

/** `true` se todo o intervalo `[inicio, fim]` cai dentro de alguma pausa. */
function semanaInteiraPausada(
  inicio: string,
  fim: string,
  pausas: readonly PausaAprovada[],
): boolean {
  /*
   * A semana INTEIRA, e nao "algum dia da semana": pausa parcial deixa dias
   * treinaveis de fora, e isentar a semana toda daria isencao de graca a quem
   * pausou um dia. Uma pausa so isenta o que ela realmente cobre.
   */
  return pausas.some(
    (pausa) => pausa.inicio <= inicio && (pausa.fim === null || fim <= pausa.fim),
  );
}

/**
 * Avalia todas as semanas entre o primeiro treino e hoje.
 *
 * Semanas SEM treino nenhum entram na lista como `PERDIDA` -- e o que impede o
 * streak de somar semanas nao adjacentes. Sem esse preenchimento, quem treinou
 * em agosto e voltou em outubro teria "duas semanas seguidas".
 *
 * Comparacao de datas por `<=` sobre texto: `AAAA-MM-DD` ordena
 * lexicograficamente na mesma ordem cronologica, entao nao ha conversao (nem
 * chance de errar fuso) para decidir se um dia esta dentro de uma pausa.
 */
export function avaliarSemanas(
  dias: readonly DiaTreinado[],
  pausas: readonly PausaAprovada[],
  politica: PoliticaDeStreak,
  hojeLocal: string,
): SemanaAvaliada[] {
  const semanaCorrente = inicioDaSemanaLocal(hojeLocal);

  // `Set` por semana: o mesmo dia repetido nao conta duas vezes. A F24 ja
  // garante uma linha por dia/unidade, mas quem treina em DUAS unidades no
  // mesmo dia tem duas sessoes -- e isso e um dia treinado, nao dois.
  const porSemana = new Map<string, Set<string>>();

  for (const { dataLocal } of dias) {
    const semana = inicioDaSemanaLocal(dataLocal);
    const atual = porSemana.get(semana);

    if (atual) {
      atual.add(dataLocal);
    } else {
      porSemana.set(semana, new Set([dataLocal]));
    }
  }

  const primeira = [...porSemana.keys()].sort()[0] ?? semanaCorrente;

  const semanas: SemanaAvaliada[] = [];

  for (
    let utc = paraUtc(primeira);
    utc <= paraUtc(semanaCorrente);
    utc += 7 * MILISSEGUNDOS_POR_DIA
  ) {
    const inicio = paraTexto(utc);
    const fim = paraTexto(utc + 6 * MILISSEGUNDOS_POR_DIA);
    const diasTreinados = porSemana.get(inicio)?.size ?? 0;

    semanas.push({ inicio, fim, diasTreinados, status: classificar(inicio, fim, diasTreinados) });
  }

  return semanas;

  function classificar(inicio: string, fim: string, diasTreinados: number): StatusDaSemana {
    /*
     * A META VENCE A PAUSA, e a ORDEM AQUI E O DESENHO: pausar nao proibe
     * treinar, entao quem bateu a meta ganha a semana mesmo pausado. Invertida,
     * esta cadeia esconderia a semana qualificada de quem treinou durante a
     * pausa -- punindo justamente o comportamento que a fatia quer premiar.
     */
    if (diasTreinados >= politica.diasPorSemana) return 'QUALIFICADA';

    // `M5-FR-009`: pausa aprovada nao rompe streak. Neutra, nao qualificada.
    if (semanaInteiraPausada(inicio, fim, pausas)) return 'PAUSADA';

    /*
     * A semana corrente ainda CORRE. Chama-la de perdida na segunda-feira de
     * manha culparia o aluno por um prazo aberto -- §13 do PRD proibe
     * linguagem de culpa, e o estado e o que a tela usa para escolher a frase.
     */
    if (inicio === semanaCorrente) return 'EM_ANDAMENTO';

    return 'PERDIDA';
  }
}

/**
 * O streak atual e o recorde, a partir das semanas avaliadas.
 *
 * `atual` conta de tras para frente: a semana CORRENTE em andamento e pulada
 * (nao rompe nem soma), a pausada e neutra, e a primeira `PERDIDA` para a
 * contagem. Sem pular a corrente, toda segunda-feira zeraria o streak de todo
 * mundo por algumas horas.
 */
export function resumirStreak(semanas: readonly SemanaAvaliada[]): ResumoDeStreak {
  let atual = 0;

  for (let i = semanas.length - 1; i >= 0; i -= 1) {
    const status = semanas[i]!.status;

    if (status === 'EM_ANDAMENTO' || status === 'PAUSADA') continue;
    if (status === 'PERDIDA') break;

    atual += 1;
  }

  let recorde = 0;
  let corrida = 0;

  for (const { status } of semanas) {
    if (status === 'PERDIDA') {
      corrida = 0;
      continue;
    }

    if (status === 'QUALIFICADA') corrida += 1;

    recorde = Math.max(recorde, corrida);
  }

  return { atual, recorde: Math.max(recorde, atual) };
}
