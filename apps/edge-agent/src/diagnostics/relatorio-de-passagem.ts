/**
 * Medicao de latencia e matriz negativa em HARDWARE REAL -- `M1-NFR-002`,
 * `M1-AC-005`, `M1-AC-006`, plano F9 Task 6 Steps 2 e 3.
 *
 * ⚠️ **A MEDICAO COMANDA UMA CATRACA DE VERDADE.** Ela nao roda no `pnpm
 * test` nem no CI, e nao deve. Rode com a bancada montada, com alguem
 * olhando o equipamento.
 *
 * O QUE ELE MEDE, E POR QUE NAO DA PARA SIMULAR
 * ---------------------------------------------
 * O simulador responde em microssegundos e sempre confirma o giro. O
 * equipamento real tem tempo de rede, tempo de firmware, tempo mecanico do
 * solenoide e, principalmente, tem FALHA: o giro que nao acontece, o
 * reconhecimento que dispara duas vezes, a confirmacao que chega tarde.
 * Numero medido em simulador nao autoriza producao -- por isso o
 * `M1-NFR-002` pede hardware.
 *
 * ONDE MORA O QUE
 * ---------------
 * Este arquivo tem o CONTRATO e o CALCULO: a matriz de casos, o resumo de
 * percentis e o veredito. Tudo puro, tudo testado no CI por
 * `relatorio-de-hardware.spec.ts`.
 *
 * A CLI que fala com o equipamento vive ao lado, em
 * `medir-passagem-online.ts`. A separacao e o que permite o veredito ser
 * testado no CI enquanto a coleta espera a bancada.
 *
 * COMO RODAR
 * ----------
 *   1. Bancada montada: leitor facial e catraca na mesma unidade, ambos
 *      cadastrados e sincronizados (F8 concluida).
 *   2. `.env` do edge-agent apontando para o hardware, `USE_SIMULATOR=false`.
 *   3. API de pe e alcancavel a partir do PC da bancada.
 *   4. **Primeira passada com `--sem-comando`**: mede a decisao ponta a
 *      ponta sem acionar a catraca. E o passo 5 do rollout do MVP-01 §19,
 *      "unidade piloto em modo observacao".
 *   5. Depois, sem a flag, na janela assistida.
 *
 *   pnpm --filter @arenahub/edge-agent test:hardware:access -- --sem-comando
 *   pnpm --filter @arenahub/edge-agent test:hardware:access
 *
 * O relatorio sai em JSON no stdout e deve ser colado em
 * `docs/operations/smart-access/online-access-evidence.md`.
 */

/**
 * Percentis por nearest-rank.
 *
 * Mesma escolha do MVP 0 (`resumirLatencia`): com 100 amostras, interpolar
 * inventaria um valor que nunca foi medido. Num relatorio que autoriza
 * producao, numero inventado e pior que numero ausente.
 */
function percentil(ordenadas: readonly number[], p: number): number {
  const posicao = Math.ceil((p / 100) * ordenadas.length) - 1;

  return ordenadas[Math.min(Math.max(posicao, 0), ordenadas.length - 1)] ?? 0;
}

export interface AmostraDeLatencia {
  trial: number;
  /** Do reconhecimento ate a resposta da nuvem. */
  decisaoMs: number;
  /** Da resposta ate o equipamento confirmar o comando. Ausente com `--sem-comando`. */
  comandoMs?: number;
  outcome: 'ALLOW' | 'DENY';
  erro?: string;
}

export interface ResumoDeLatencia {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  erros: number;
}

export function resumir(amostras: readonly AmostraDeLatencia[]): ResumoDeLatencia {
  const validas = amostras
    .filter((a) => a.erro === undefined)
    .map((a) => a.decisaoMs + (a.comandoMs ?? 0))
    .sort((x, y) => x - y);

  return {
    n: validas.length,
    p50: percentil(validas, 50),
    p95: percentil(validas, 95),
    p99: percentil(validas, 99),
    max: validas[validas.length - 1] ?? 0,
    erros: amostras.length - validas.length,
  };
}

/**
 * Matriz negativa fisica -- `M1-AC-006`.
 *
 * Cada caso e uma forma diferente de o sistema errar para o lado perigoso.
 * `deveLiberar` e sempre `false` menos no controle: um teste em que nada
 * pode passar nao prova que algo passa quando deve.
 */
export const MATRIZ_NEGATIVA = [
  {
    caso: 'CONTROLE_VALIDO',
    descricao: 'Aluno ativo, direito vigente, dentro do horario e da unidade',
    deveLiberar: true,
  },
  {
    caso: 'DIREITO_EXPIRADO',
    descricao: 'Direito venceu ontem',
    deveLiberar: false,
  },
  {
    caso: 'FORA_DO_HORARIO',
    descricao: 'Direito valido, fora da janela configurada',
    deveLiberar: false,
  },
  {
    caso: 'ALUNO_BLOQUEADO',
    descricao: 'Aluno com status BLOCKED',
    deveLiberar: false,
  },
  {
    caso: 'BLOQUEIO_ADMINISTRATIVO',
    descricao: 'Bloqueio administrativo vigente, direito perfeito',
    deveLiberar: false,
  },
  {
    caso: 'BIOMETRIA_REVOGADA',
    descricao: 'Identidade revogada, ainda presente no leitor',
    deveLiberar: false,
  },
  {
    caso: 'IDENTIDADE_DESCONHECIDA',
    descricao: 'enrollid que a base nao conhece (cadastro de fabrica)',
    deveLiberar: false,
  },
  {
    caso: 'UNIDADE_ERRADA',
    descricao: 'Direito vale so em outra unidade',
    deveLiberar: false,
  },
  {
    caso: 'RECONHECIMENTO_DUPLICADO',
    descricao: 'Mesmo reconhecimento reenviado -- nao pode gerar segundo giro',
    deveLiberar: false,
  },
  {
    caso: 'NUVEM_INDISPONIVEL',
    descricao: 'API inalcancavel -- ate a Slice 1.5, e DENY explicito',
    deveLiberar: false,
  },
] as const;

export interface ResultadoDaMatriz {
  caso: string;
  descricao: string;
  deveLiberar: boolean;
  liberou: boolean;
  outcome: string;
  reason: string;
  accessEventId: string | null;
  aprovado: boolean;
}

export interface RelatorioDeHardware {
  executadoEm: string;
  modeloDoEquipamento: string;
  firmware: string;
  comandoFisicoHabilitado: boolean;
  trials: number;
  latencia: ResumoDeLatencia;
  limiteDoMvp0Ms: number | null;
  objetivoMs: number;
  dentroDoObjetivo: boolean;
  matriz: ResultadoDaMatriz[];
  matrizAprovada: boolean;
}

/**
 * Monta o relatorio a partir das medicoes.
 *
 * Funcao pura, exportada e testavel: a parte que fala com hardware e a que
 * nao roda no CI, mas o CALCULO do veredito roda. Sem isso, o unico teste do
 * criterio de aprovacao seria a propria bancada.
 */
export function montarRelatorio(entrada: {
  executadoEm: string;
  modeloDoEquipamento: string;
  firmware: string;
  comandoFisicoHabilitado: boolean;
  amostras: readonly AmostraDeLatencia[];
  matriz: readonly ResultadoDaMatriz[];
  limiteDoMvp0Ms: number | null;
}): RelatorioDeHardware {
  const latencia = resumir(entrada.amostras);

  // `M1-NFR-002`: limite homologado no MVP 0 quando existir; objetivo de
  // 300 ms sempre. O limite do MVP 0 VENCE quando for mais restritivo --
  // ele foi medido neste hardware, o objetivo e aspiracional.
  const objetivoMs = entrada.limiteDoMvp0Ms ?? 300;

  return {
    executadoEm: entrada.executadoEm,
    modeloDoEquipamento: entrada.modeloDoEquipamento,
    firmware: entrada.firmware,
    comandoFisicoHabilitado: entrada.comandoFisicoHabilitado,
    trials: entrada.amostras.length,
    latencia,
    limiteDoMvp0Ms: entrada.limiteDoMvp0Ms,
    objetivoMs,
    dentroDoObjetivo: latencia.p95 <= objetivoMs,
    matriz: [...entrada.matriz],
    // TODOS os casos precisam passar. Nao ha "aprovado com ressalva" numa
    // matriz cujo objeto e provar que ninguem entra sem direito.
    matrizAprovada: entrada.matriz.every((m) => m.aprovado),
  };
}
