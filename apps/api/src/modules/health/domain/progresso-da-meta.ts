/**
 * Progresso de uma meta de saude (`M3-FR-012`, Slice 3.4).
 *
 * Funcoes puras: sem banco, sem relogio (`CLAUDE.md`). O "agora" entra por
 * parametro.
 *
 * ---------------------------------------------------------------------------
 * O QUE ISTO ACRESCENTA AO `ateAMeta` DA F18.
 * ---------------------------------------------------------------------------
 *
 * O comparativo da F18 responde "quanto FALTA" (`alvo - atual`). Isso e util
 * e insuficiente: faltar 3 kg e otimo para quem partiu de 10 e pessimo para
 * quem partiu de 3,5. A Slice 3.4 pede "progresso calculado", que e a fracao
 * do caminho ja andada -- e ela so existe com a BASELINE, que a F18 congelou
 * em `health_goals.baseline_value` justamente para isto.
 *
 * ---------------------------------------------------------------------------
 * A BASELINE E CONGELADA, E O CALCULO NUNCA A RECALCULA.
 * ---------------------------------------------------------------------------
 *
 * `baselineValue` foi gravado quando a meta nasceu e NAO se move, mesmo que a
 * avaliacao de partida seja corrigida depois (INV-102 permite correcao, e ela
 * cria linha nova). Se o progresso relesse a medicao original a cada consulta,
 * uma correcao de 3 meses atras mudaria o percentual de hoje sem ninguem ter
 * combinado nada -- a meta passaria a significar outra coisa retroativamente.
 * A F18 ja registrou essa escolha no schema; este arquivo apenas a honra.
 *
 * ---------------------------------------------------------------------------
 * A DIRECAO VEM DOS NUMEROS, NAO DE UM CAMPO DE PROTOCOLO.
 * ---------------------------------------------------------------------------
 *
 * O plano de apoio de 14/08 previa uma "direcao configurada pelo protocolo".
 * O modelo que a F18 entregou nao tem esse campo, e ele seria redundante:
 * `alvo < baseline` JA diz que a meta e reduzir, e `alvo > baseline` que e
 * aumentar. Um campo separado poderia CONTRADIZER os numeros -- meta marcada
 * como "reduzir" com alvo acima da base -- e ai haveria duas verdades sobre a
 * mesma linha. Deriva-se; nao se armazena.
 */

/** Estado do progresso, para a tela nao ter de inferir do numero. */
export type EstadoDaMeta =
  /** Ainda nao ha medicao posterior a baseline: nada a dizer. */
  | 'SEM_MEDICAO'
  /** O alvo ja e igual a baseline: nao ha caminho a andar. */
  | 'SEM_DISTANCIA'
  /** Andou na direcao do alvo, mas ainda nao chegou. */
  | 'EM_PROGRESSO'
  /** Atingiu ou passou do alvo. */
  | 'ATINGIDA'
  /** Moveu-se na direcao oposta a do alvo. */
  | 'AFASTOU';

export interface ProgressoDaMeta {
  readonly baseline: number;
  readonly alvo: number;
  /** Ultima medicao publicada do tipo. `null` quando nao ha nenhuma. */
  readonly atual: number | null;
  /**
   * Fracao do caminho andada, de 0 a 1. Passa de 1 quando o aluno superou o
   * alvo, e fica NEGATIVA quando ele se afastou -- truncar em [0,1] esconderia
   * exatamente os dois casos que o avaliador precisa ver.
   *
   * `null` quando nao ha o que calcular (sem medicao ou sem distancia).
   */
  readonly fracao: number | null;
  readonly estado: EstadoDaMeta;
  /** Dias entre `agora` e o prazo. Negativo quando ja venceu. */
  readonly diasAteOPrazo: number;
  /**
   * `true` quando o prazo passou sem a meta ter sido atingida.
   *
   * Meta vencida CONTINUA existindo e visivel -- o schema da F18 ja decidiu
   * isso ("apagar esconderia que o combinado nao foi cumprido"). Este campo
   * so torna o fato legivel sem a tela ter de comparar datas.
   */
  readonly vencida: boolean;
}

/** A meta como o calculo precisa dela -- o repositorio traduz a linha. */
export interface MetaParaProgresso {
  readonly baseline: number;
  readonly alvo: number;
  readonly prazo: Date;
  readonly achievedAt: Date | null;
}

const DIA_EM_MS = 86_400_000;

/**
 * Dias inteiros entre dois instantes, arredondando para baixo em modulo.
 *
 * `trunc` e nao `floor` porque o sinal carrega significado aqui: `floor(-0.5)`
 * daria `-1` e transformaria "vence hoje mais tarde" em "venceu ontem".
 */
function diasEntre(de: Date, ate: Date): number {
  return Math.trunc((ate.getTime() - de.getTime()) / DIA_EM_MS);
}

/**
 * Calcula o progresso de uma meta contra a ultima medicao publicada.
 *
 * `atual` e `null` quando o aluno nao tem medicao do tipo -- caso comum logo
 * apos cadastrar a meta, e que NAO e "progresso zero": zero afirmaria que ele
 * mediu e nao saiu do lugar.
 *
 * O prazo nao interrompe o calculo: meta vencida continua mostrando quanto foi
 * andado, porque o avaliador precisa da conversa "faltaram 2 kg", nao de um
 * campo em branco.
 */
export function calcularProgresso(
  meta: MetaParaProgresso,
  atual: number | null,
  agora: Date,
): ProgressoDaMeta {
  const diasAteOPrazo = diasEntre(agora, meta.prazo);
  const distancia = meta.alvo - meta.baseline;

  const base = {
    baseline: meta.baseline,
    alvo: meta.alvo,
    atual,
    diasAteOPrazo,
  };

  if (atual === null) {
    return { ...base, fracao: null, estado: 'SEM_MEDICAO', vencida: diasAteOPrazo < 0 };
  }

  // Alvo igual a baseline: a meta e "manter". Nao ha caminho a percorrer,
  // entao nao ha fracao -- dividir por zero produziria `Infinity`, e chamar
  // isso de "100% atingida" afirmaria um esforco que ninguem fez.
  if (distancia === 0) {
    const manteve = atual === meta.alvo;

    return {
      ...base,
      fracao: null,
      estado: manteve ? 'ATINGIDA' : 'SEM_DISTANCIA',
      vencida: diasAteOPrazo < 0 && !manteve,
    };
  }

  const andado = atual - meta.baseline;
  // A divisao normaliza o sinal: `andado` e `distancia` negativos (meta de
  // reduzir, aluno reduziu) produzem fracao POSITIVA. E por isso que o calculo
  // nao precisa saber se a meta era ganhar ou perder.
  const fracao = andado / distancia;
  const atingida = fracao >= 1;

  const estado: EstadoDaMeta = atingida ? 'ATINGIDA' : fracao < 0 ? 'AFASTOU' : 'EM_PROGRESSO';

  return {
    ...base,
    // 4 casas pela mesma razao da consistencia: evitar dizima na resposta JSON
    // sem decidir, aqui, se o consumidor quer percentual.
    fracao: Math.round(fracao * 10_000) / 10_000,
    estado,
    vencida: diasAteOPrazo < 0 && !atingida,
  };
}
