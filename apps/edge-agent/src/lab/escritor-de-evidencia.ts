import { writeFileSync } from 'node:fs';

export interface TentativaDeEvidencia {
  externalEnrollId: string;
  decisao: 'ALLOW' | 'DENY';
  latenciaMs: number;
}

export interface EvidenciaDeExecucao {
  executadoEm: string;
  modo: { facial: 'real' | 'simulador'; catraca: 'real' | 'simulador' };
  tentativas: readonly TentativaDeEvidencia[];
  percentis: { p50: number; p95: number; max: number };
}

const PADRAO_CPF = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/;

/**
 * Grava evidencia de execucao do `lab:run` -- insumo F59 SS5.3. NUNCA
 * contem PII nem template biometrico: so `externalEnrollId` (ja e
 * pseudonimo, ver `gerarExternalEnrollId`) e rotulo operacional.
 *
 * A checagem de CPF e defesa em profundidade -- quem chama nao deveria
 * passar CPF aqui, mas um `externalEnrollId` mal gerado em teste manual
 * e o tipo de erro que so aparece guardado, e falhar alto aqui e mais
 * barato que descobrir depois que um arquivo de evidencia vazou CPF.
 */
export function escreverEvidencia(caminho: string, dados: EvidenciaDeExecucao): void {
  for (const tentativa of dados.tentativas) {
    if (PADRAO_CPF.test(tentativa.externalEnrollId)) {
      throw new Error(
        `externalEnrollId parece CPF ("${tentativa.externalEnrollId}") -- evidencia nao pode conter PII`,
      );
    }
  }

  writeFileSync(caminho, JSON.stringify(dados, null, 2), 'utf-8');
}
