import type { TipoDeMedida } from './medida.js';

/**
 * Saida estruturada da IA e sua validacao (`M3-BR-010`, `M3-AC-008`,
 * regra de arquitetura no 8, F21).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * ---------------------------------------------------------------------------
 * A REGRA No 8 E INEGOCIAVEL, E ESTE ARQUIVO E ONDE ELA VIRA CODIGO.
 * ---------------------------------------------------------------------------
 *
 * "IA e OCR nunca publicam dado de saude sozinhos. Toda saida carrega
 * `disclaimerCode: 'NOT_MEDICAL_DIAGNOSIS'` e e REJEITADA se trouxer
 * diagnostico ou valor inexistente."
 *
 * Rejeitar e nao "limpar": um texto que diagnostica nao vira seguro depois de
 * apagar a frase ofensiva -- o raciocinio que a produziu contaminou o resto,
 * e editar a saida do modelo e assumir a autoria dela. A analise inteira cai,
 * e o registro da rejeicao fica (`M3-AC-008`).
 *
 * ---------------------------------------------------------------------------
 * "VALOR INEXISTENTE" E A METADE QUE COSTUMA SER ESQUECIDA.
 * ---------------------------------------------------------------------------
 *
 * Modelo de linguagem inventa numero com a mesma fluencia com que acerta. Uma
 * analise que cita "sua gordura caiu de 24,1% para 21,8%" quando o snapshot
 * so tem 24,1 e 22,3 e mais perigosa que uma que diagnostica: o diagnostico o
 * avaliador percebe, o numero errado ele repassa ao aluno. Por isso todo
 * numero citado na prosa e conferido contra o snapshot que gerou a analise.
 */

export type CodigoDeAviso = 'NOT_MEDICAL_DIAGNOSIS';

export type Direcao = 'UP' | 'DOWN' | 'STABLE';

export interface ObservacaoDeProgresso {
  readonly metric: string;
  readonly observation: string;
}

export interface TendenciaDeMetrica {
  readonly metric: string;
  readonly direction: Direcao;
}

export interface AchadoSuprimido {
  readonly metric: string;
  readonly reason: string;
}

/** Contrato do `MVP-03` secao 12, com as emendas dos ADR-035 e ADR-037. */
export interface SaidaDaAnalise {
  readonly summary: string;
  readonly progress: readonly ObservacaoDeProgresso[];
  readonly positivePoints: readonly string[];
  readonly attentionPoints: readonly string[];
  readonly trends: readonly TendenciaDeMetrica[];
  readonly goalProgress: readonly string[];
  readonly questionsForProfessional: readonly string[];
  readonly disclaimerCode: CodigoDeAviso;

  readonly pendingMedicalReferral: boolean;
  readonly pendingReferralSince: string | null;

  readonly contextFactors: readonly string[];
  readonly suppressedFindings: readonly AchadoSuprimido[];
  readonly analysisBlocked: boolean;
}

export type MotivoDeRejeicao =
  /** Faltou campo, tipo errado, `disclaimerCode` ausente ou diferente. */
  | 'SCHEMA_INVALID'
  /** Linguagem de diagnostico, prescricao ou conduta clinica. */
  | 'DIAGNOSTIC_LANGUAGE'
  /** Numero citado que nao existe no snapshot. */
  | 'VALUE_NOT_IN_SNAPSHOT'
  /** Reintroduziu em prosa um achado que a regra do ADR-037 suprimiu. */
  | 'SUPPRESSED_FINDING_REINTRODUCED'
  /** Escreveu analise apesar de `analysisBlocked` (gestacao). */
  | 'BLOCKED_ANALYSIS_ANSWERED';

export type ResultadoDaValidacao =
  | { readonly aceita: true; readonly saida: SaidaDaAnalise }
  | { readonly aceita: false; readonly motivo: MotivoDeRejeicao; readonly detalhe: string };

/**
 * Vocabulario que caracteriza DIAGNOSTICO ou CONDUTA.
 *
 * A lista mira o ato, nao o assunto: falar de gordura corporal e o proposito
 * do produto; dizer que o aluno "tem obesidade" e classificar uma pessoa numa
 * categoria clinica, que e o que a RDC 657/2022 usa para enquadrar software
 * como dispositivo medico (ADR-035).
 *
 * Fronteiras de palavra (`\b`) evitam o classico falso positivo: sem elas,
 * "recomendavel" casaria com "recomend" e "desidratacao" com "hidrat".
 */
const DIAGNOSTICO: readonly RegExp[] = [
  // Classificacao clinica atribuida ao aluno. As duas palavras seguintes
  // entram no casamento de proposito: sem elas o detalhe da auditoria diria
  // apenas "Voce tem", que nao informa o que o modelo escreveu.
  /\bvoc[eê]\s+(?:tem|apresenta|sofre\s+de|est[aá]\s+com)\s+\S+(?:\s+\S+)?/i,
  /\b(diagn[oó]stic\w*|patolog\w*|s[ií]ndrome|doen[çc]a)\b/i,
  /\b(obesidade|sobrepeso\s+cl[ií]nic\w*|desnutri[çc][aã]o|an[eê]mi\w*)\b/i,
  /\b(hipertens\w*|diabet\w*|fibrila[çc][aã]o|arritmi\w*|card[ií]ac\w*)\b/i,
  // Conduta e prescricao.
  /\b(prescrev\w*|receit\w*|dosagem|posologia)\b/i,
  /\b(recomendo|recomendamos|deve\s+tomar|tome\s+)\b/i,
  // SEM `\b` no fim: a fronteira depois de `\d` exige nao-digito colado, e o
  // que vem em "4 series de 12 repeticoes" e um ESPACO -- o padrao original
  // nunca casava, e uma prescricao de treino passava direto pela guarda.
  /\b(?:trein\w*\s+de\s+\d+|s[eé]ries\s+de\s+\d+|\d+\s*x\s*\d+\s+repeti\w*)/i,
  /\b(?:dieta\s+de\s+\d+|consuma\s+\d+|ingira\s+\d+)/i,
  // Tranquilizacao clinica -- tao perigosa quanto o alarme.
  /\b(n[aã]o\s+h[aá]\s+risco|est[aá]\s+saud[aá]vel|sem\s+problem\w*\s+de\s+sa[uú]de)\b/i,
];

/**
 * Como cada metrica aparece na prosa em pt-BR.
 *
 * Existe porque a saida do modelo e em portugues e o enum e em ingles.
 * Mapear a mao e chato e correto; derivar do enum produziria termo que nunca
 * casa, e uma guarda que nunca casa e indistinguivel de guarda ausente.
 */
const ROTULO_PT: Partial<Record<TipoDeMedida, readonly string[]>> = {
  BODY_FAT_PERCENT: ['gordura corporal', 'percentual de gordura'],
  BODY_FAT_MASS: ['massa de gordura'],
  LEAN_BODY_MASS: ['massa magra', 'massa livre de gordura'],
  SKELETAL_MUSCLE_MASS: ['massa muscular', 'musculo esqueletico', 'músculo esquelético'],
  TOTAL_BODY_WATER: ['agua corporal', 'água corporal', 'agua total', 'água total'],
  INTRACELLULAR_WATER: ['agua intracelular', 'água intracelular'],
  EXTRACELLULAR_WATER: ['agua extracelular', 'água extracelular'],
  PROTEIN_MASS: ['massa proteica', 'proteina', 'proteína'],
  MINERAL_MASS: ['mineral', 'minerais'],
  VISCERAL_FAT_LEVEL: ['gordura visceral'],
  BASAL_METABOLIC_RATE: ['metabolismo basal', 'taxa metabolica', 'taxa metabólica'],
  WAIST_CIRCUMFERENCE: ['circunferencia da cintura', 'circunferência da cintura', 'cintura'],
  HIP_CIRCUMFERENCE: ['circunferencia do quadril', 'circunferência do quadril', 'quadril'],
  WEIGHT: ['peso'],
  HEIGHT: ['altura'],
};

/** Numeros com uma ou mais casas decimais, ou inteiros de ate 4 digitos. */
const NUMERO = /\d+(?:[.,]\d+)?/g;

/**
 * Numeros que a prosa pode citar sem estar no snapshot.
 *
 * Ano, contagem de sessoes pequena e percentual de progresso aparecem
 * naturalmente e nao sao medida corporal. Sem esta folga, "voce treinou 3
 * vezes" seria rejeitado por um numero que a propria frequencia produziu.
 */
const TOLERANCIA = 0.05;

function ehQuaseIgual(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCIA;
}

/** Toda a prosa da saida, concatenada -- e onde os numeros sao procurados. */
function prosaInteira(saida: SaidaDaAnalise): string {
  return [
    saida.summary,
    ...saida.progress.map((p) => `${p.metric} ${p.observation}`),
    ...saida.positivePoints,
    ...saida.attentionPoints,
    ...saida.goalProgress,
    ...saida.questionsForProfessional,
    ...saida.suppressedFindings.map((s) => `${s.metric} ${s.reason}`),
  ].join('\n');
}

/** O que o validador precisa saber do snapshot que gerou a analise. */
export interface ContextoDaValidacao {
  /** Todo numero que o snapshot continha -- medidas, metas, agregados. */
  readonly numerosPermitidos: readonly number[];
  /** Achados que a regra do ADR-037 suprimiu, em forma de metrica. */
  readonly metricasSuprimidas: readonly TipoDeMedida[];
  readonly analiseBloqueada: boolean;
}

/**
 * `unknown` antes de validar (`CLAUDE.md`): a saida vem de um terceiro, e
 * confiar no formato dela e o mesmo erro de confiar em corpo de requisicao.
 */
function temFormato(bruta: unknown): bruta is SaidaDaAnalise {
  if (typeof bruta !== 'object' || bruta === null) return false;

  const s = bruta as Record<string, unknown>;

  const arrayDeTexto = (v: unknown): boolean =>
    Array.isArray(v) && v.every((i) => typeof i === 'string');

  return (
    typeof s['summary'] === 'string' &&
    Array.isArray(s['progress']) &&
    s['progress'].every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>)['metric'] === 'string' &&
        typeof (p as Record<string, unknown>)['observation'] === 'string',
    ) &&
    arrayDeTexto(s['positivePoints']) &&
    arrayDeTexto(s['attentionPoints']) &&
    Array.isArray(s['trends']) &&
    s['trends'].every(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        typeof (t as Record<string, unknown>)['metric'] === 'string' &&
        ['UP', 'DOWN', 'STABLE'].includes(
          (t as Record<string, unknown>)['direction'] as string,
        ),
    ) &&
    arrayDeTexto(s['goalProgress']) &&
    arrayDeTexto(s['questionsForProfessional']) &&
    // O disclaimer e literal, nao "alguma string": o `M3-BR-010` exige o
    // codigo exato, e aceitar qualquer texto aqui esvaziaria a regra no 8.
    s['disclaimerCode'] === 'NOT_MEDICAL_DIAGNOSIS' &&
    typeof s['pendingMedicalReferral'] === 'boolean' &&
    (s['pendingReferralSince'] === null || typeof s['pendingReferralSince'] === 'string') &&
    arrayDeTexto(s['contextFactors']) &&
    Array.isArray(s['suppressedFindings']) &&
    typeof s['analysisBlocked'] === 'boolean'
  );
}

/**
 * Valida a saida do provedor. Rejeitar e o caminho normal, nao a excecao.
 *
 * A ordem das checagens importa: formato primeiro (sem ele nao ha o que ler),
 * bloqueio depois (analise que nao devia existir nao precisa ter a prosa
 * conferida), e so entao o conteudo.
 */
export function validarSaida(
  bruta: unknown,
  contexto: ContextoDaValidacao,
): ResultadoDaValidacao {
  if (!temFormato(bruta)) {
    return {
      aceita: false,
      motivo: 'SCHEMA_INVALID',
      detalhe: 'saida fora do contrato do MVP-03 secao 12',
    };
  }

  const saida = bruta;

  // ADR-037: gestacao bloqueia a analise INTEIRA. Escrever prosa mesmo assim
  // e interpretar uma medicao que o proprio produto declarou nao
  // interpretavel.
  if (contexto.analiseBloqueada) {
    const escreveu =
      saida.summary.trim() !== '' ||
      saida.positivePoints.length > 0 ||
      saida.attentionPoints.length > 0 ||
      saida.progress.length > 0;

    if (escreveu || !saida.analysisBlocked) {
      return {
        aceita: false,
        motivo: 'BLOCKED_ANALYSIS_ANSWERED',
        detalhe: 'analise bloqueada por fator de contexto, mas a saida trouxe conteudo',
      };
    }

    return { aceita: true, saida };
  }

  const prosa = prosaInteira(saida);

  for (const padrao of DIAGNOSTICO) {
    const achado = padrao.exec(prosa);

    if (achado) {
      return {
        aceita: false,
        motivo: 'DIAGNOSTIC_LANGUAGE',
        // O trecho casado entra no detalhe de proposito: ele NAO e dado
        // pessoal (e texto gerado pelo modelo) e sem ele a auditoria do
        // `M3-AC-008` nao consegue dizer o que foi rejeitado.
        detalhe: `linguagem de diagnostico ou conduta: "${achado[0]}"`,
      };
    }
  }

  // ADR-037: o modelo recebeu a lista de suprimidos e mesmo assim escreveu
  // sobre eles -- reintroduzindo em prosa o alarme falso que a regra matou.
  //
  // A busca e por ROTULO EM PT-BR e nao pelo enum com underscore trocado por
  // espaco: a prosa sai em portugues ("agua intracelular"), e procurar
  // "intracellular water" nunca casaria -- a guarda passaria verde sem nunca
  // ter olhado para nada.
  for (const metrica of contexto.metricasSuprimidas) {
    const rotulo = ROTULO_PT[metrica];

    if (rotulo === undefined) continue;

    const mencionaComoAtencao = saida.attentionPoints.some((ponto) =>
      rotulo.some((termo) => ponto.toLowerCase().includes(termo)),
    );

    if (mencionaComoAtencao) {
      return {
        aceita: false,
        motivo: 'SUPPRESSED_FINDING_REINTRODUCED',
        detalhe: `ponto de atencao sobre metrica suprimida: ${metrica}`,
      };
    }
  }

  // Numero por ULTIMO, de proposito: prescricao ("4 series de 12") carrega
  // numero inexistente, e conferir numero primeiro registraria uma
  // prescricao como "valor inventado" -- perdendo, na auditoria do
  // `M3-AC-008`, o motivo que de fato importa.
  const citados = prosa.match(NUMERO) ?? [];

  for (const bruto of citados) {
    const numero = Number(bruto.replace(',', '.'));

    if (!Number.isFinite(numero)) continue;

    // Inteiro pequeno e ano nao sao medida: "3 sessoes", "2026". Exigir que
    // estejam no snapshot rejeitaria prosa correta.
    if (Number.isInteger(numero) && (numero <= 10 || (numero >= 1900 && numero <= 2200))) {
      continue;
    }

    if (!contexto.numerosPermitidos.some((permitido) => ehQuaseIgual(permitido, numero))) {
      return {
        aceita: false,
        motivo: 'VALUE_NOT_IN_SNAPSHOT',
        detalhe: `valor citado que nao existe no snapshot: ${bruto}`,
      };
    }
  }

  return { aceita: true, saida };
}

/**
 * Todo numero do snapshot, para o validador conferir contra a prosa.
 *
 * Reune medidas, metas e agregados de frequencia -- e nada mais: numero que
 * o modelo nao recebeu, ele nao pode citar.
 */
export function numerosDoSnapshot(snapshot: {
  assessments: readonly { measurements: readonly { value: number }[] }[];
  goals: readonly { baseline: number; target: number; fraction: number | null }[];
  attendance: { totalSessions: number; consistencyRatio: number | null };
}): number[] {
  const numeros: number[] = [];

  for (const avaliacao of snapshot.assessments) {
    for (const medida of avaliacao.measurements) numeros.push(medida.value);
  }

  for (const meta of snapshot.goals) {
    numeros.push(meta.baseline, meta.target);

    if (meta.fraction !== null) {
      numeros.push(meta.fraction);
      // O modelo tende a escrever a fracao como percentual ("50%"), e
      // rejeitar isso seria rejeitar prosa correta.
      numeros.push(Math.round(meta.fraction * 1000) / 10);
    }
  }

  numeros.push(snapshot.attendance.totalSessions);

  if (snapshot.attendance.consistencyRatio !== null) {
    numeros.push(snapshot.attendance.consistencyRatio);
    numeros.push(Math.round(snapshot.attendance.consistencyRatio * 1000) / 10);
  }

  return numeros;
}
