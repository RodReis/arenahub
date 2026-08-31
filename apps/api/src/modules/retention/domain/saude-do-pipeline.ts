/**
 * Saude do pipeline de retencao (F41, Slice 6.6, `M6-BR-009`).
 *
 * PURA: o "agora" entra por parametro.
 *
 * ---------------------------------------------------------------------------
 * A FALHA SEM SINTOMA
 * ---------------------------------------------------------------------------
 *
 * `M6-BR-009` trata do SCORE velho, e a F37 ja resolveu esse lado: todo score
 * sai com idade visivel. Falta o outro lado, que e pior: **o pipeline que
 * parou**.
 *
 * Quando o job nao roda, nao ha score novo -- e a fila simplesmente aparece
 * vazia. Fila vazia le-se como "nenhum aluno em risco hoje", que e uma boa
 * noticia. A operacao nao tem como distinguir "ninguem em risco" de "o job
 * morreu ha uma semana", e as duas exigem acoes opostas.
 *
 * Por isso o estado do pipeline e uma pergunta que se faz ao sistema, e nao um
 * alarme que depende de alguem notar a ausencia de alguma coisa.
 *
 * ---------------------------------------------------------------------------
 * DESLIGADO NAO E FALHA
 * ---------------------------------------------------------------------------
 *
 * Kill switch acionado e DECISAO. Alarmar por isso treinaria a operacao a
 * ignorar o alarme -- e alarme ignorado e pior do que alarme nenhum, porque dá
 * a sensacao de cobertura. `DESLIGADO` tem estado proprio e nao gera alerta.
 */

const MILISSEGUNDOS_POR_HORA = 3_600_000;

export type EstadoDoPipeline =
  /** Rodou dentro do prazo. */
  | 'SAUDAVEL'
  /** Passou do limite sem rodar -- alguem precisa olhar. */
  | 'ATRASADO'
  /** Kill switch acionado. E decisao, nao falha. */
  | 'DESLIGADO'
  /** Nunca houve snapshot. O estado do banco de desenvolvimento em 31/08/2026. */
  | 'NUNCA_RODOU';

export interface EstadoObservado {
  readonly ultimoSnapshotEm: Date | null;
  readonly scoringLigado: boolean;
}

export interface SaudeDoPipeline {
  readonly estado: EstadoDoPipeline;
  /** `null` quando nunca rodou -- nao ha de quando contar. */
  readonly horasSemRodar: number | null;
}

/**
 * 36 horas: uma rodada diaria mais meia de folga.
 *
 * Pega o job que nao rodou hoje sem alarmar por atraso de duas horas na
 * madrugada. Limiar mais apertado transformaria manutencao de rotina em
 * incidente.
 */
export const ATRASO_PADRAO_EM_HORAS = 36;

export function avaliarSaudeDoPipeline(
  observado: EstadoObservado,
  agora: Date,
  limiteEmHoras: number = ATRASO_PADRAO_EM_HORAS,
): SaudeDoPipeline {
  // Desligado vence tudo: enquanto o kill switch esta acionado, nao rodar e o
  // comportamento correto.
  if (!observado.scoringLigado) {
    return { estado: 'DESLIGADO', horasSemRodar: null };
  }

  if (observado.ultimoSnapshotEm === null) {
    return { estado: 'NUNCA_RODOU', horasSemRodar: null };
  }

  // Piso em zero: relogio para tras (NTP, fuso) daria idade negativa, e idade
  // negativa faria um pipeline parado parecer saudavel por acidente.
  const horasSemRodar = Math.max(
    0,
    Math.floor((agora.getTime() - observado.ultimoSnapshotEm.getTime()) / MILISSEGUNDOS_POR_HORA),
  );

  return {
    estado: horasSemRodar > limiteEmHoras ? 'ATRASADO' : 'SAUDAVEL',
    horasSemRodar,
  };
}
