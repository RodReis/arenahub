/**
 * Relogio implausivel do equipamento -- decisao 3 da `SPEC-002` (17/08/2026).
 *
 * O `M0-FR-004` ordena eventos pelo horario DO EQUIPAMENTO. A janela fisica
 * de 17/08 mostrou o custo disso: o leitor mandou `ocorridoEm` congelado em
 * `15:47:28` em TODOS os reconhecimentos, e timestamp fixo embaralha a ordem.
 *
 * A decisao do PI foi dupla -- acertar o relogio do leitor E carimbar um
 * fallback no Edge:
 *
 *   **o `ocorridoEm` original NUNCA e sobrescrito.**
 *
 * Isso nao e detalhe de implementacao, e o que mantem o `M0-BR-004` intacto:
 * o fallback decide **ordem**, nao substitui **fato**. O que sobe para o
 * coletor continua sendo o horario que o equipamento afirmou; o que a fila
 * usa para ordenar e o que este modulo devolve.
 *
 * Acertar o relogio resolve ESTA bancada. Nao resolve o relogio errado do
 * proximo cliente -- por isso o fallback e codigo, nao procedimento.
 *
 * Funcao pura: sem banco, sem rede, sem relogio proprio. O "agora" e o
 * "ultimo visto" entram por parametro (convencao do `CLAUDE.md`).
 */

/**
 * Quanto o equipamento pode estar adiantado sem ser suspeito.
 *
 * Todo relogio desliza. Tratar 30 s de adiantamento como defeito carimbaria
 * fallback em bancada saudavel -- e fallback demais e tao ruim quanto de
 * menos: esconde que o relogio do equipamento nunca foi acertado.
 *
 * Dois minutos e valor de POC, decidido com o PI em 17/08/2026. Se a
 * operacao medir deriva maior, isto vira parametro de configuracao -- nao
 * numero maior escondido aqui.
 */
export const TOLERANCIA_FUTURO_MS = 120_000;

/** Por que o horario do equipamento nao foi aceito. Vai para o log. */
export const RAZAO_IMPLAUSIVEL = {
  /** `interpretarDataHora` nao entendeu o formato -- veio NaN. */
  INVALIDO: 'horario invalido',
  /** Repetido ou anterior ao ultimo visto: relogio parado ou retrocedendo. */
  NAO_AVANCOU: 'horario nao avancou desde o ultimo evento',
  /** Adiantado alem da tolerancia. */
  FUTURO: 'horario no futuro alem da tolerancia',
} as const;

export type RazaoImplausivel = (typeof RAZAO_IMPLAUSIVEL)[keyof typeof RAZAO_IMPLAUSIVEL];

export type AvaliacaoDeRelogio = {
  /**
   * A chave de ordenacao -- `ocorridoEm` quando ele merece confianca, o
   * `recebidoEm` quando nao.
   *
   * NAO e o horario do evento. O horario do evento e o `ocorridoEm`, e ele
   * segue intacto para o coletor.
   */
  ordenarPor: Date;
  implausivel: boolean;
  razao?: RazaoImplausivel;
};

/**
 * O horario do equipamento merece confianca para ordenar?
 *
 * `ultimoOcorridoEmPlausivel` e o ultimo horario ACEITO daquele dispositivo,
 * ou `null` no primeiro evento. O primeiro e sempre plausivel por falta de
 * regua, nao por acerto: o congelamento so se revela no segundo.
 */
export function avaliarRelogio(
  ocorridoEm: Date,
  recebidoEm: Date,
  ultimoOcorridoEmPlausivel: Date | null,
): AvaliacaoDeRelogio {
  // Fallback quebrado e pior que fallback ausente: um NaN no ORDER BY nao
  // aparece como erro, aparece como fila fora de ordem. Falha alto -- quem
  // carimba `recebidoEm` e o nosso codigo, entao NaN aqui e bug nosso.
  if (Number.isNaN(recebidoEm.getTime())) {
    throw new TypeError('recebidoEm invalido: o Edge carimba este horario, NaN aqui e bug nosso');
  }

  if (Number.isNaN(ocorridoEm.getTime())) {
    return { ordenarPor: recebidoEm, implausivel: true, razao: RAZAO_IMPLAUSIVEL.INVALIDO };
  }

  if (ocorridoEm.getTime() > recebidoEm.getTime() + TOLERANCIA_FUTURO_MS) {
    return { ordenarPor: recebidoEm, implausivel: true, razao: RAZAO_IMPLAUSIVEL.FUTURO };
  }

  // Repetido conta como nao-avancou: dois reconhecimentos no mesmo
  // milissegundo exato sao relogio parado, nao coincidencia.
  if (ultimoOcorridoEmPlausivel !== null && ocorridoEm.getTime() <= ultimoOcorridoEmPlausivel.getTime()) {
    return { ordenarPor: recebidoEm, implausivel: true, razao: RAZAO_IMPLAUSIVEL.NAO_AVANCOU };
  }

  return { ordenarPor: ocorridoEm, implausivel: false };
}

/**
 * Guarda o ultimo horario plausivel POR DISPOSITIVO.
 *
 * Por dispositivo, nao global: cada relogio pertence ao seu equipamento, e
 * relogio errado e defeito de um leitor, nao do predio. Com regua global,
 * dois leitores intercalando eventos legitimos marcariam um ao outro como
 * retrocesso -- e o MVP 1 poe dois leitores na mesma unidade.
 */
export class RastreadorDeRelogio {
  private readonly ultimoPorDispositivo = new Map<string, Date>();

  avaliar(dispositivo: string, ocorridoEm: Date, recebidoEm: Date): AvaliacaoDeRelogio {
    const avaliacao = avaliarRelogio(
      ocorridoEm,
      recebidoEm,
      this.ultimoPorDispositivo.get(dispositivo) ?? null,
    );

    // So o plausivel avanca a regua. Aceitar o implausivel a envenenaria:
    // um timestamp de 2099 faria todo evento seguinte parecer retrocesso.
    if (!avaliacao.implausivel) {
      this.ultimoPorDispositivo.set(dispositivo, ocorridoEm);
    }

    return avaliacao;
  }
}
