import type { FatorDeContexto, AvisoDeFaixa } from './contexto-de-saude.js';
import type { TipoDeMedida } from './medida.js';

/**
 * Snapshot pseudonimizado enviado ao provedor de IA (`M3-FR-015`,
 * `M3-NFR-009`, F21, Slice 3.5).
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`).
 *
 * ---------------------------------------------------------------------------
 * ESTE ARQUIVO E A FRONTEIRA DE PRIVACIDADE DO PRODUTO.
 * ---------------------------------------------------------------------------
 *
 * Tudo que sai daqui atravessa a fronteira do Brasil e chega a um terceiro.
 * O ADR-036 so fechou o ponto remanescente do ADR-008 -- transferencia
 * internacional de dado SENSIVEL -- pela combinacao de duas coisas:
 * pseudonimizacao na entrada (decisao 2) e contrato de nao-treinamento
 * (decisao 3). A segunda e ato de terceiro; a PRIMEIRA E ESTE CODIGO.
 *
 * Por isso o snapshot e construido por LISTA BRANCA e nunca por copia com
 * omissao: `{...aluno, nome: undefined}` continua carregando todo campo que
 * alguem adicionar amanha ao objeto de origem, e o vazamento apareceria numa
 * fatia futura sem ninguem ter tocado neste arquivo. Aqui, campo novo so
 * viaja se for escrito a mao abaixo.
 *
 * O que NUNCA entra, e cada um por uma razao diferente:
 *
 *   - nome, CPF, e-mail, telefone, data de nascimento, foto, template
 *     biometrico -- identificador direto (`M3-NFR-009`);
 *   - `studentId` -- e o identificador do titular no NOSSO banco; manda-lo
 *     transformaria pseudonimizacao em rotulo estavel, que reidentifica por
 *     correlacao entre chamadas;
 *   - QUALQUER campo de origem `ECG` -- traçado, bpm, o texto do achado
 *     (ADR-035 decisao 4). Vai apenas o BOOLEANO de pendencia: sem ele a
 *     analise diria "esta tudo otimo" com pendencia cardiaca aberta, o que e
 *     pior que silencio; COM o texto do achado, a IA vira a interprete e o
 *     produto vira dispositivo medico sob a RDC 657/2022.
 *
 * A `analysisRef` e um identificador OPACO da analise, gerado por nos, sem
 * relacao derivavel com o aluno. Existe para casar a resposta do provedor com
 * a linha de auditoria -- nao para o provedor saber de quem e.
 */

/** Idade em faixa, nao em anos: 34 e quase um identificador; "30-39" nao e. */
export type FaixaEtaria = '<20' | '20-29' | '30-39' | '40-49' | '50-59' | '60+';

/** Sexo biologico importa para faixa de referencia de composicao corporal. */
export type SexoBiologico = 'MALE' | 'FEMALE' | 'UNDECLARED';

/** Uma medida da serie, ja em unidade canonica. */
export interface MedidaDoSnapshot {
  readonly type: TipoDeMedida;
  readonly value: number;
  readonly unit: string | null;
}

/** Uma avaliacao publicada, reduzida ao que a analise precisa. */
export interface AvaliacaoDoSnapshot {
  /**
   * Data local `AAAA-MM-DD`, nao instante: a hora da pesagem nao acrescenta
   * nada a analise e estreita o conjunto de quem poderia ser aquela pessoa.
   */
  readonly assessedAtLocal: string;
  readonly measurements: readonly MedidaDoSnapshot[];
}

export interface MetaDoSnapshot {
  readonly type: TipoDeMedida;
  readonly baseline: number;
  readonly target: number;
  readonly unit: string | null;
  /** Fracao do caminho andada (F20). `null` quando nao ha o que calcular. */
  readonly fraction: number | null;
}

export interface FrequenciaDoSnapshot {
  readonly totalSessions: number;
  /** Proporcao de semanas com sessao. `null` quando nao ha periodo elegivel. */
  readonly consistencyRatio: number | null;
  /**
   * `false` quando nao ha passagem confirmada no periodo (F20).
   *
   * Viaja porque frequencia zero tem DUAS causas que pedem frases opostas: o
   * aluno nao veio, ou o sistema nao viu. Sem isto o modelo escreveria
   * "voce nao treinou neste periodo" para quem treinou todos os dias com a
   * catraca destravada.
   */
  readonly confirmedSource: boolean;
}

export interface SnapshotDeAnalise {
  /** Identificador OPACO desta analise. Nao deriva do aluno. */
  readonly analysisRef: string;
  readonly ageRange: FaixaEtaria;
  readonly biologicalSex: SexoBiologico;
  /** Cronologica, da mais antiga para a mais recente. */
  readonly assessments: readonly AvaliacaoDoSnapshot[];
  readonly goals: readonly MetaDoSnapshot[];
  readonly attendance: FrequenciaDoSnapshot;

  /** ADR-037: os fatores ativos, para a analise nao contradizer a regra. */
  readonly contextFactors: readonly FatorDeContexto[];
  /**
   * ADR-037: o que a regra deterministica JA suprimiu.
   *
   * Sem isto o modelo le "agua intracelular 31,5 acima de 30,4" e escreve o
   * ponto de atencao que o fator `SUPLEMENTACAO_CREATINA` acabou de tirar --
   * reintroduzindo em prosa o alarme falso que o ADR-037 existe para matar.
   */
  readonly suppressedFindings: readonly AvisoDeFaixa[];
  /** ADR-037: gestacao bloqueia a analise inteira, nao suprime avisos. */
  readonly analysisBlocked: boolean;

  /** ADR-035 decisao 4: ESTADO, nunca o achado. */
  readonly pendingMedicalReferral: boolean;
  readonly pendingReferralSince: string | null;
}

/** Dados do aluno como a fronteira os recebe -- e o que NAO pode viajar. */
export interface AlunoParaSnapshot {
  readonly birthDate: Date | null;
  readonly biologicalSex: SexoBiologico | null;
}

const FAIXAS: readonly { ate: number; faixa: FaixaEtaria }[] = [
  { ate: 19, faixa: '<20' },
  { ate: 29, faixa: '20-29' },
  { ate: 39, faixa: '30-39' },
  { ate: 49, faixa: '40-49' },
  { ate: 59, faixa: '50-59' },
];

/**
 * Idade em faixa de dez anos.
 *
 * Faixa e nao numero porque idade exata, combinada com sexo e uma serie de
 * pesagens datadas, estreita muito o conjunto de quem aquela pessoa pode ser.
 * A analise nao perde nada: faixa de referencia de composicao corporal e
 * definida por decada, nao por ano.
 *
 * Sem data de nascimento devolve `40-49`, a faixa central -- e nao um
 * `null` que o prompt teria de tratar. Aluno sem nascimento cadastrado
 * existe na base importada do Pacto.
 */
export function faixaEtaria(nascimento: Date | null, agora: Date): FaixaEtaria {
  if (nascimento === null) return '40-49';

  let anos = agora.getUTCFullYear() - nascimento.getUTCFullYear();
  const mes = agora.getUTCMonth() - nascimento.getUTCMonth();

  if (mes < 0 || (mes === 0 && agora.getUTCDate() < nascimento.getUTCDate())) {
    anos -= 1;
  }

  return FAIXAS.find((f) => anos <= f.ate)?.faixa ?? '60+';
}

/** O que a fronteira reune antes de montar o snapshot. */
export interface EntradaDoSnapshot {
  readonly analysisRef: string;
  readonly aluno: AlunoParaSnapshot;
  readonly avaliacoes: readonly AvaliacaoDoSnapshot[];
  readonly metas: readonly MetaDoSnapshot[];
  readonly frequencia: FrequenciaDoSnapshot;
  readonly fatores: readonly FatorDeContexto[];
  readonly suprimidos: readonly AvisoDeFaixa[];
  readonly analiseBloqueada: boolean;
  readonly pendenciaMedicaAberta: boolean;
  readonly pendenciaDesde: string | null;
  readonly agora: Date;
}

/**
 * Monta o snapshot -- LISTA BRANCA, campo a campo.
 *
 * Nao ha spread de objeto nenhum aqui, e a ausencia e deliberada: espalhar a
 * entidade e omitir o que incomoda deixa a porta aberta para todo campo
 * futuro. Se um dia `AvaliacaoDoSnapshot` ganhar um campo que nao devia
 * viajar, este arquivo tem de mudar -- e a revisao ve.
 */
export function montarSnapshot(entrada: EntradaDoSnapshot): SnapshotDeAnalise {
  return {
    analysisRef: entrada.analysisRef,
    ageRange: faixaEtaria(entrada.aluno.birthDate, entrada.agora),
    biologicalSex: entrada.aluno.biologicalSex ?? 'UNDECLARED',
    assessments: entrada.avaliacoes.map((avaliacao) => ({
      assessedAtLocal: avaliacao.assessedAtLocal,
      measurements: avaliacao.measurements.map((medida) => ({
        type: medida.type,
        value: medida.value,
        unit: medida.unit,
      })),
    })),
    goals: entrada.metas.map((meta) => ({
      type: meta.type,
      baseline: meta.baseline,
      target: meta.target,
      unit: meta.unit,
      fraction: meta.fraction,
    })),
    attendance: {
      totalSessions: entrada.frequencia.totalSessions,
      consistencyRatio: entrada.frequencia.consistencyRatio,
      confirmedSource: entrada.frequencia.confirmedSource,
    },
    contextFactors: [...entrada.fatores],
    suppressedFindings: [...entrada.suprimidos],
    analysisBlocked: entrada.analiseBloqueada,
    pendingMedicalReferral: entrada.pendenciaMedicaAberta,
    pendingReferralSince: entrada.pendenciaDesde,
  };
}

/**
 * Termos que NAO podem aparecer em nenhum lugar do snapshot serializado.
 *
 * Rede de seguranca, nao a defesa principal -- a defesa e a lista branca do
 * `montarSnapshot`. Esta lista existe porque lista branca protege contra
 * campo novo no TIPO, e nao contra alguem enfiando PII dentro de um campo
 * que ja e permitido (um `unit` que virasse texto livre, por exemplo).
 */
const PROIBIDOS: readonly RegExp[] = [
  // CPF com ou sem mascara.
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
  // E-mail.
  /[\w.+-]+@[\w-]+\.[\w.-]+/,
  // Telefone brasileiro com DDD.
  /\(?\d{2}\)?\s?9?\d{4}-?\d{4}/,
  // Chaves que nao deveriam existir na serializacao.
  /"(name|fullName|cpf|email|phone|birthDate|photo|studentId|template)"\s*:/i,
];

/**
 * Confere que o snapshot serializado nao carrega PII nem campo de ECG.
 *
 * Chamada ANTES de cada envio, na fronteira. Falhar alto e o ponto: um
 * snapshot com PII nao pode ser "corrigido" no meio do caminho e seguir --
 * o dado ja teria sido montado errado, e o proximo campo escaparia igual.
 */
export function conferirPseudonimizacao(snapshot: SnapshotDeAnalise): void {
  // A `analysisRef` sai da varredura, e a razao e medida, nao teorica: ela e
  // hex de 32 caracteres gerado por nos, e o padrao de telefone brasileiro
  // (`\d{2}\s?9?\d{4}-?\d{4}`) casa com hex suficientemente numerico em ~8%
  // dos sorteios. Mantendo-a dentro, uma analise a cada doze seria recusada
  // por "PII" que nunca existiu -- de forma aleatoria e sem causa aparente
  // para quem opera. Achado da propria suite de integracao desta fatia.
  //
  // Excluir e seguro porque a referencia NAO vem de dado do aluno: e
  // `randomBytes(16)`, sem relacao derivavel com ele. O que a guarda precisa
  // varrer e o CONTEUDO -- e ele continua inteiro abaixo.
  const { analysisRef: _referenciaOpaca, ...conteudo } = snapshot;
  const serializado = JSON.stringify(conteudo);

  for (const proibido of PROIBIDOS) {
    if (proibido.test(serializado)) {
      // A mensagem NAO inclui o trecho casado: ele seria justamente o dado
      // pessoal, e ele acabaria no log de erro -- que o `CLAUDE.md` proibe.
      throw new Error(
        `snapshot de analise recusado: padrao proibido no payload (${String(proibido)})`,
      );
    }
  }
}
