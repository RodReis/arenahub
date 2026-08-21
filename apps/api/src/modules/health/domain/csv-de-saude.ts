import { formatarLinha } from '../../exports/domain/csv.js';

/**
 * Colunas da exportacao de historico corporal (`M3-FR-017`, `M3-AC-010`).
 *
 * Funcoes puras. A neutralizacao contra CSV injection vem de
 * `exports/domain/csv.js` -- o mesmo `formatarCelula` que a F11 usa, e nao
 * uma segunda implementacao: regra de escape duplicada e regra que diverge
 * na primeira correcao.
 *
 * ## O que estas colunas carregam, e por que
 *
 * `M3-AC-010` exige "avaliacoes, medidas, origem e datas", e `M3-NFR-006`
 * exige proveniencia consultavel. Por isso vao juntos:
 *
 * - **valor original E canonico**, com as duas unidades (INV-105): o
 *   canonico serve a comparacao, o original prova o que o aparelho reportou.
 *   Exportar so o canonico apagaria a informacao de que a balanca reportava
 *   em libras;
 * - **`corrects_assessment_id`** (INV-102): a cadeia de correcao inteira vai
 *   no arquivo. Quem confere fora do sistema precisa ver que aquele numero
 *   substitui outro -- sem isso, duas linhas do mesmo dia parecem duas
 *   medicoes, que e exatamente a leitura errada;
 * - **`superseded`**: marca a linha que JA foi corrigida. A original continua
 *   no arquivo porque ela prova que o numero errado circulou; some do
 *   grafico, nao da auditoria.
 *
 * ## O que NAO esta aqui
 *
 * CPF, telefone, endereco, foto, template biometrico, contexto de saude. A
 * exportacao e o caminho mais facil de dado sair da empresa. Fator de
 * contexto e dado de saude do art. 11 (ADR-037) e nao entra numa planilha que
 * a academia manda por e-mail; o nome do aluno vai porque sem ele o arquivo
 * nao serve para conferir de quem e o historico.
 */
export const COLUNAS_DE_MEDIDA = [
  'assessment_id',
  'student_id',
  'student_name',
  'assessed_at_utc',
  'assessed_at_local',
  'published_at_utc',
  'status',
  'source',
  'corrects_assessment_id',
  'superseded',
  'measurement_type',
  'original_value',
  'original_unit',
  'canonical_value',
  'canonical_unit',
  'evaluator_user_id',
] as const;

export interface MedidaExportavel {
  assessmentId: string;
  studentId: string;
  studentName: string;
  /** Instante UTC da MEDICAO, ISO-8601. */
  assessedAt: string;
  /** A mesma medicao no fuso da unidade, ja formatada por quem chama. */
  assessedAtLocal: string;
  publishedAt: string | null;
  status: string;
  source: string;
  /** Avaliacao que esta corrige, quando e uma correcao (INV-102). */
  correctsAssessmentId: string | null;
  /** Esta avaliacao ja foi corrigida por outra? */
  superseded: boolean;
  type: string;
  /** Valores como STRING: o `Decimal` do banco nao passa por `number`. */
  originalValue: string;
  originalUnit: string | null;
  canonicalValue: string;
  canonicalUnit: string | null;
  evaluatorUserId: string;
}

/**
 * Converte uma medida em linha CSV.
 *
 * Os valores chegam ja como STRING, direto do `Decimal` do banco (INV-106):
 * converter para `number` no caminho da exportacao introduziria o erro
 * binario justamente no arquivo que serve de prova. `0.1 + 0.2` nao fecha, e
 * quem confere a planilha contra o laudo veria a diferenca.
 */
export function linhaDeMedida(medida: MedidaExportavel): string {
  return formatarLinha([
    medida.assessmentId,
    medida.studentId,
    // Nome e campo livre vindo de cadastro -- e por onde a injecao de formula
    // entra. `formatarCelula` neutraliza; a coluna existe porque sem nome o
    // arquivo nao diz de quem e o historico.
    medida.studentName,
    medida.assessedAt,
    medida.assessedAtLocal,
    medida.publishedAt ?? '',
    medida.status,
    medida.source,
    medida.correctsAssessmentId ?? '',
    medida.superseded ? 'true' : 'false',
    medida.type,
    medida.originalValue,
    medida.originalUnit ?? '',
    medida.canonicalValue,
    medida.canonicalUnit ?? '',
    medida.evaluatorUserId,
  ]);
}

export function cabecalhoDeMedida(): string {
  return formatarLinha([...COLUNAS_DE_MEDIDA]);
}
