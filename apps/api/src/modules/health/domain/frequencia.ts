/**
 * Frequencia a partir de passagens confirmadas (`M3-FR-013`, Slice 3.4).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" e o fuso da
 * unidade entram por parametro.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO DELIBERADAMENTE NAO CALCULA: DURACAO DE TREINO.
 * ---------------------------------------------------------------------------
 *
 * A Slice 3.4 pede frequencia "sem inferir duracao de treino quando nao
 * houver saida confiavel", e hoje NAO ha: a catraca da Arena Positiva opera
 * liberada nos dois sentidos (ADR-029), entao ninguem registra saida. Subtrair
 * a primeira passagem da ultima produziria um numero com cara de medida --
 * "treinou 2h14" -- que na verdade e a distancia entre duas entradas. Numero
 * inventado com aparencia de dado e pior que campo vazio, porque o vazio se
 * pergunta e o inventado se acredita (INV-104, a mesma regra da F18).
 *
 * ---------------------------------------------------------------------------
 * A POLITICA DE AGRUPAMENTO E O DIA CIVIL LOCAL, E ISSO E VERSIONADO.
 * ---------------------------------------------------------------------------
 *
 * `M3-BR-008` manda agrupar "multiplas entradas na janela configurada" numa
 * sessao so, mas nao fixa a janela -- e escolher o tamanho e decisao de
 * produto. O PI decidiu DIA CIVIL em 21/08/2026, por duas razoes:
 *
 *   1. Sem saida confiavel, qualquer janela por horas (4h, 6h) seria arbitraria
 *      -- ela existiria para separar treinos cuja duracao ninguem mede.
 *   2. Frequencia semanal e mensal conta DIAS TREINADOS, que e como a recepcao
 *      e o aluno ja pensam ("treinei tres vezes essa semana").
 *
 * A politica vai gravada em cada sessao (`POLITICA_DE_SESSAO`). Trocar de
 * politica no futuro e REPROJETAR -- apagar as sessoes de uma versao e gerar
 * de novo a partir dos eventos brutos, que continuam intactos --, nunca migrar
 * numero ja calculado. Por isso a sessao guarda os ids das passagens que a
 * formaram: sem eles, a reprojecao teria de confiar no agregado que ela
 * mesma quer refazer.
 */

/**
 * Versao da politica que forma a sessao.
 *
 * Muda quando a REGRA muda (o tamanho da janela, o criterio de elegibilidade),
 * nunca quando o codigo e refatorado. Consumidor que compara numeros de duas
 * versoes diferentes esta comparando coisas diferentes, e a versao e o que
 * torna isso visivel em vez de silencioso.
 */
export const POLITICA_DE_SESSAO = 'dia-civil-local@1';

/**
 * Uma passagem que ja passou pelo filtro de elegibilidade.
 *
 * `passageId` e `accessEventId` viajam juntos de proposito: a sessao aponta
 * para a passagem (o fato fisico que a tornou elegivel) e para o evento (a
 * decisao que a originou). Guardar so um dos dois obrigaria quem audita a
 * fazer um join a mais para responder "por que este dia contou".
 */
export interface PassagemElegivel {
  readonly passageId: string;
  readonly accessEventId: string;
  readonly gymUnitId: string;
  /** Instante da decisao (relogio do servidor), nao o do equipamento. */
  readonly occurredAt: Date;
}

/**
 * Uma sessao projetada: um dia local em que o aluno entrou pelo menos uma vez.
 *
 * Nao ha `endedAt` nem `duracao` -- ver o bloco do topo. `primeiraEm` e
 * `ultimaEm` sao os extremos das passagens do dia e servem para auditar o
 * agrupamento, nao para subtrair um do outro.
 */
export interface SessaoProjetada {
  /** `AAAA-MM-DD` no fuso da unidade. E a identidade da sessao. */
  readonly dataLocal: string;
  readonly gymUnitId: string;
  readonly primeiraEm: Date;
  readonly ultimaEm: Date;
  /** Quantas passagens confirmadas caíram neste dia. */
  readonly passagens: number;
  /** Ids das passagens que formaram a sessao, em ordem cronologica. */
  readonly passageIds: readonly string[];
  readonly policyVersion: string;
}

/**
 * Agrupa passagens confirmadas em sessoes por dia civil local.
 *
 * Determinismo importa aqui tanto quanto no comparativo da F18: a mesma
 * entrada tem de produzir a mesma saida, ou reprojetar mudaria numero sem
 * ninguem ter mudado regra. Por isso a ordenacao desempata por `passageId`
 * quando dois instantes coincidem -- dois leitores podem gravar o mesmo
 * milissegundo, e sem desempate a ordem viria do banco, que nao promete
 * nenhuma.
 *
 * O agrupamento e por `(dia local, unidade)` e nao so por dia: quem treina de
 * manha na unidade A e a noite na B fez duas sessoes, em dois lugares. Somar
 * as duas num dia so apagaria a informacao de onde a pessoa estava, que e
 * justamente o que uma rede multiunidade precisa saber.
 */
export function projetarSessoes(
  passagens: readonly PassagemElegivel[],
  fuso: string,
  dataLocalDe: (instante: Date, fuso: string) => string,
): SessaoProjetada[] {
  const ordenadas = [...passagens].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.passageId.localeCompare(b.passageId),
  );

  const porDia = new Map<string, PassagemElegivel[]>();

  for (const passagem of ordenadas) {
    const dia = dataLocalDe(passagem.occurredAt, fuso);
    const chave = `${dia}|${passagem.gymUnitId}`;
    const atual = porDia.get(chave);

    if (atual) {
      atual.push(passagem);
    } else {
      porDia.set(chave, [passagem]);
    }
  }

  const sessoes: SessaoProjetada[] = [];

  for (const [chave, doDia] of porDia) {
    const [dataLocal, gymUnitId] = chave.split('|') as [string, string];
    const primeira = doDia[0]!;
    const ultima = doDia[doDia.length - 1]!;

    sessoes.push({
      dataLocal,
      gymUnitId,
      primeiraEm: primeira.occurredAt,
      ultimaEm: ultima.occurredAt,
      passagens: doDia.length,
      passageIds: doDia.map((p) => p.passageId),
      policyVersion: POLITICA_DE_SESSAO,
    });
  }

  // Ordem estavel de saida: por dia, depois por unidade. `Map` preserva a
  // ordem de insercao, que segue a cronologia -- mas duas unidades no mesmo
  // dia sairiam na ordem em que a primeira passagem de cada uma apareceu, e
  // isso muda se um evento chegar atrasado. Ordenar aqui fecha essa porta.
  return sessoes.sort(
    (a, b) => a.dataLocal.localeCompare(b.dataLocal) || a.gymUnitId.localeCompare(b.gymUnitId),
  );
}

/** Granularidade dos agregados pedidos pela Slice 3.4. */
export const GRANULARIDADES = ['SEMANAL', 'MENSAL', 'ANUAL'] as const;

export type Granularidade = (typeof GRANULARIDADES)[number];

export function ehGranularidade(valor: string): valor is Granularidade {
  return (GRANULARIDADES as readonly string[]).includes(valor);
}

/**
 * Um balde do agregado: quantos DIAS o aluno treinou no intervalo.
 *
 * `sessoes` conta dias distintos, nao passagens: quem entrou tres vezes na
 * terca treinou um dia. `passagens` fica ao lado para quem precisa auditar o
 * agrupamento, e e sempre >= `sessoes`.
 */
export interface BaldeDeFrequencia {
  /** Rotulo estavel: `2026-W34`, `2026-08` ou `2026`. */
  readonly rotulo: string;
  readonly sessoes: number;
  readonly passagens: number;
}

/**
 * Semana ISO-8601 de uma data local `AAAA-MM-DD`.
 *
 * ISO e nao "domingo a sabado" porque o rotulo precisa ser comparavel entre
 * anos e a semana ISO e a unica definicao com regra fechada para a virada de
 * ano -- 1 de janeiro pode pertencer a ultima semana do ano anterior, e um
 * calculo caseiro produziria `2026-W00` ou `2026-W53` conforme o mes.
 *
 * A conta roda em UTC de proposito: a data ja vem convertida para o fuso da
 * unidade por `dataLocalIso`, entao reconverter aqui aplicaria o fuso duas
 * vezes.
 */
export function semanaIso(dataLocal: string): string {
  const [ano, mes, dia] = dataLocal.split('-').map(Number) as [number, number, number];
  const data = new Date(Date.UTC(ano, mes - 1, dia));

  // Quinta-feira da mesma semana decide a que ano a semana pertence (ISO-8601).
  // `getUTCDay()` e 0 no domingo; `|| 7` move o domingo para o fim, como o ISO
  // manda -- sem isso, o domingo puxaria a semana para a anterior.
  const diaIso = data.getUTCDay() || 7;
  data.setUTCDate(data.getUTCDate() + 4 - diaIso);

  const anoDaSemana = data.getUTCFullYear();
  const primeiroDeJaneiro = new Date(Date.UTC(anoDaSemana, 0, 1));
  const numero = Math.ceil(((data.getTime() - primeiroDeJaneiro.getTime()) / 86_400_000 + 1) / 7);

  return `${anoDaSemana}-W${String(numero).padStart(2, '0')}`;
}

/** O rotulo do balde a que uma data local pertence, por granularidade. */
export function rotuloDoBalde(dataLocal: string, granularidade: Granularidade): string {
  if (granularidade === 'SEMANAL') return semanaIso(dataLocal);
  if (granularidade === 'MENSAL') return dataLocal.slice(0, 7);

  return dataLocal.slice(0, 4);
}

/**
 * Agrega sessoes em baldes.
 *
 * Balde sem sessao NAO aparece: a serie traz o que aconteceu, e quem desenha
 * o grafico decide se preenche a lacuna. Emitir zero aqui afirmaria "nao
 * treinou nesta semana", e essa afirmacao e falsa quando a semana esta fora do
 * periodo consultado ou quando a fonte estava degradada -- a mesma distincao
 * entre ausencia e zero que o INV-104 faz para medida.
 */
export function agregarFrequencia(
  sessoes: readonly SessaoProjetada[],
  granularidade: Granularidade,
): BaldeDeFrequencia[] {
  const baldes = new Map<string, { sessoes: number; passagens: number }>();

  for (const sessao of sessoes) {
    const rotulo = rotuloDoBalde(sessao.dataLocal, granularidade);
    const atual = baldes.get(rotulo);

    if (atual) {
      atual.sessoes += 1;
      atual.passagens += sessao.passagens;
    } else {
      baldes.set(rotulo, { sessoes: 1, passagens: sessao.passagens });
    }
  }

  return [...baldes.entries()]
    .map(([rotulo, v]) => ({ rotulo, sessoes: v.sessoes, passagens: v.passagens }))
    .sort((a, b) => a.rotulo.localeCompare(b.rotulo));
}

/**
 * Consistencia: a proporcao de semanas do periodo em que houve ao menos uma
 * sessao.
 *
 * NAO e aderencia, disciplina nem efeito sobre a saude -- e a contagem de
 * semanas com presenca dividida pelo total de semanas. A Slice 3.4 pede
 * "consistencia" e o aceite exige que as limitacoes fiquem explicitas; o nome
 * do campo e a unica defesa contra alguem ler o numero como julgamento do
 * aluno.
 *
 * `semanasElegiveis` vem de fora porque so quem conhece o periodo consultado
 * sabe quantas semanas ele tem -- contar as semanas em que houve sessao
 * dividiria por si mesmo e devolveria 100% para quem treinou uma vez.
 *
 * Devolve `null` quando nao ha semana elegivel, e nao `0`: periodo vazio nao
 * e "consistencia zero", e dividir por zero produziria `NaN` na tela.
 */
export function consistencia(
  sessoes: readonly SessaoProjetada[],
  semanasElegiveis: number,
): { semanasComSessao: number; semanasElegiveis: number; proporcao: number | null } {
  const semanas = new Set(sessoes.map((s) => semanaIso(s.dataLocal)));

  if (!Number.isInteger(semanasElegiveis) || semanasElegiveis <= 0) {
    return { semanasComSessao: semanas.size, semanasElegiveis: 0, proporcao: null };
  }

  return {
    semanasComSessao: semanas.size,
    semanasElegiveis,
    // Arredondar para 4 casas evita que 1/3 vire `0.3333333333333333` na
    // resposta JSON, sem transformar em percentual: quem exibe decide isso.
    proporcao: Math.round((semanas.size / semanasElegiveis) * 10_000) / 10_000,
  };
}
