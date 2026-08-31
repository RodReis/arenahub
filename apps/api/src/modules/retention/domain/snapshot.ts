/**
 * O snapshot de features e seu checksum (F36, Slice 6.1).
 *
 * PURO: sem banco, sem relogio. O hash entra por parametro (a funcao de
 * digest), para que este arquivo continue testavel sem `node:crypto`.
 *
 * ---------------------------------------------------------------------------
 * O CHECKSUM E A PROVA DO ACEITE, NAO UM CAMPO DE AUDITORIA.
 * ---------------------------------------------------------------------------
 *
 * O aceite da Slice 6.1 e "um snapshot passado pode ser reproduzido apenas com
 * dados disponiveis naquela data". Isso e uma afirmacao VERIFICAVEL, e o
 * checksum e como se verifica: reconstruir a mesma data de observacao com o
 * mesmo corte de conhecimento tem de produzir o mesmo hash. Divergiu, alguma
 * feature leu estado corrente em vez de fato datado -- e o `SNAPSHOT_NAO_DETERMINISTICO`
 * do plano existe para gritar isso em vez de sobrescrever em silencio.
 *
 * Por isso a serializacao e CANONICA (ordem fixa, numero em texto): um
 * `JSON.stringify` de objeto cru mudaria o hash conforme a ordem de insercao
 * das chaves, e o alarme dispararia por motivo errado -- ou pior, deixaria de
 * disparar quando importa.
 */

import { completude, type ValorDeFeature } from './valor-de-feature.js';

/** A identidade de um snapshot -- o que o torna unico e reproduzivel. */
export interface IdentidadeDeSnapshot {
  readonly tenantId: string;
  readonly studentId: string;
  /** Versao do alvo (populacao, janelas, horizonte) -- `M6-FR-001`. */
  readonly versaoDeAlvo: string;
  /** Versao do catalogo de features -- `M6-FR-001`. */
  readonly versaoDeFeatures: string;
  readonly observadoEm: Date;
  readonly corteDeConhecimento: Date;
}

export interface SnapshotDeFeatures extends IdentidadeDeSnapshot {
  readonly valores: readonly ValorDeFeature[];
  /** Fracao de features observadas, em `[0, 1]` -- confianca, nao risco. */
  readonly completude: number;
  readonly checksum: string;
}

/**
 * Serializacao canonica: mesma entrada, mesmo texto, sempre.
 *
 * Tres decisoes que o determinismo exige:
 *
 *   1. features ORDENADAS por nome -- a ordem de calculo nao pode vazar para o
 *      hash, senao trocar a ordem das chamadas "muda" o snapshot;
 *   2. numero como TEXTO via `String()` -- `0.1 + 0.2` ja e uma armadilha de
 *      ponto flutuante, e serializar o numero cru deixaria a representacao
 *      variar entre plataformas;
 *   3. ausente vira `null|RAZAO` e presente vira `valor|` -- os dois nunca
 *      colidem, entao "0 observado" e "ausente" produzem hashes diferentes,
 *      que e a mesma distincao de `M6-BR-002` levada ate o checksum.
 *
 * O instante entra em ISO 8601 (UTC), nao em milissegundos: texto legivel
 * sobrevive a inspecao manual quando alguem for auditar uma divergencia.
 */
export function serializarCanonicamente(
  identidade: IdentidadeDeSnapshot,
  valores: readonly ValorDeFeature[],
): string {
  const cabecalho = [
    identidade.tenantId,
    identidade.studentId,
    identidade.versaoDeAlvo,
    identidade.versaoDeFeatures,
    identidade.observadoEm.toISOString(),
    identidade.corteDeConhecimento.toISOString(),
  ].join('');

  const linhas = [...valores]
    .sort((a, b) => a.nome.localeCompare(b.nome))
    .map((item) =>
      [
        item.nome,
        item.valor === null ? 'null' : String(item.valor),
        item.razao ?? '',
        item.procedencia,
      ].join(''),
    );

  return [cabecalho, ...linhas].join('\n');
}

/** Assina um digest hex a partir do texto canonico. */
export type FuncaoDeDigest = (texto: string) => string;

/**
 * Monta o snapshot completo.
 *
 * A completude e calculada aqui e nao recebida: derivar evita a segunda fonte
 * de verdade que diverge na primeira mudanca -- o mesmo raciocinio que a F32
 * usou para nao materializar streak numa tabela propria.
 */
export function montarSnapshot(
  identidade: IdentidadeDeSnapshot,
  valores: readonly ValorDeFeature[],
  digest: FuncaoDeDigest,
): SnapshotDeFeatures {
  return {
    ...identidade,
    valores,
    completude: completude(valores),
    checksum: digest(serializarCanonicamente(identidade, valores)),
  };
}

/**
 * `true` se duas materializacoes do mesmo recorte batem.
 *
 * Usada pela reconstrucao auditada (Task 5): a divergencia vira erro
 * `SNAPSHOT_NAO_DETERMINISTICO`, nunca sobrescrita silenciosa da revisao
 * original. Sobrescrever apagaria a evidencia de que o pipeline nao e
 * reproduzivel, que e precisamente o que se quer descobrir.
 */
export function reproduz(anterior: SnapshotDeFeatures, novo: SnapshotDeFeatures): boolean {
  return anterior.checksum === novo.checksum;
}
