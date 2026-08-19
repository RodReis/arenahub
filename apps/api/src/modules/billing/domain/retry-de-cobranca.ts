/**
 * Politica de nova tentativa de cobranca recorrente. `MVP-02` 7, Slice 2.3
 * (`M2-FR-012`: "representar tentativa recorrente, falha, proxima tentativa e
 * cancelamento").
 *
 * FUNCAO PURA (`CLAUDE.md`): sem banco, sem rede, sem relogio. O "agora" e o
 * vencimento entram por parametro. E o que permite provar a politica inteira
 * em teste de tabela, sem subir nada.
 *
 * O PRD NAO DA OS NUMEROS -- ele exige representar a proxima tentativa, nao
 * escolhe quantas nem quando. Os valores vieram de decisao do PI em
 * 19/08/2026: **3 tentativas, em D+0, D+3 e D+7**, contadas a partir do
 * vencimento; esgotadas, a assinatura vai para `PAST_DUE` e quem decide o
 * bloqueio de acesso e a carencia (`BillingSettings.graceDays`), nao esta
 * funcao. Ficam em `BillingSettings` para serem ajustaveis por academia sem
 * deploy.
 */

/**
 * Recusa PERMANENTE nao tem proxima tentativa.
 *
 * Cartao cancelado, roubado ou conta encerrada devolvem o mesmo resultado na
 * segunda tentativa e na terceira: repetir so gera taxa e conta como recusa
 * contra a loja na adquirente. E a mesma distincao que `ErroDoProvedor` ja
 * carrega em `recuperavel`, e que `PaymentAttempt.failureIsPermanent` grava
 * -- aqui ela vira decisao.
 *
 * Decidido pelo PI em 19/08/2026.
 */
export interface TentativaDeCobranca {
  /** Quantas tentativas JA FORAM FEITAS para esta invoice. Nunca negativo. */
  readonly tentativasFeitas: number;
  /**
   * A ultima falha e definitiva? `undefined` quando ainda nao houve falha.
   *
   * O `| undefined` e explicito porque o projeto usa
   * `exactOptionalPropertyTypes`: sem ele, "campo ausente" e "campo presente
   * valendo undefined" seriam tipos diferentes, e quem le do banco tem o
   * segundo. Os TRES estados importam -- nunca falhou, falhou e da para
   * repetir, falhou e nao adianta.
   */
  readonly ultimaFalhaEPermanente?: boolean | undefined;
}

export interface PoliticaDeRetry {
  /**
   * Dias apos o vencimento em que cada tentativa acontece. O TAMANHO desta
   * lista e o numero maximo de tentativas -- nao existe um segundo campo
   * `maxTentativas` que possa discordar dele.
   */
  readonly offsetsEmDias: readonly number[];
}

/** Padrao decidido pelo PI em 19/08/2026. Sobrescrito por `BillingSettings`. */
export const OFFSETS_DE_RETRY_PADRAO: readonly number[] = [0, 3, 7];

export type ResultadoDoRetry =
  | { readonly deveTentar: true; readonly em: Date }
  | { readonly deveTentar: false; readonly motivo: MotivoDeParar };

/**
 * Por que paramos de tentar. Codigo estavel (`CLAUDE.md`): vira estado da
 * assinatura e texto para o operador, entao nao pode ser string solta.
 */
export type MotivoDeParar = 'RECUSA_PERMANENTE' | 'TENTATIVAS_ESGOTADAS';

/**
 * Quando (e se) a proxima cobranca deve ser tentada.
 *
 * `vencimento` e a data base -- as tentativas sao contadas a partir dela, nao
 * a partir da tentativa anterior. Encadear a partir da anterior faria uma
 * falha de rede as 23h59 empurrar todo o calendario do aluno em um dia.
 */
export function proximaTentativa(
  estado: TentativaDeCobranca,
  politica: PoliticaDeRetry,
  vencimento: Date,
): ResultadoDoRetry {
  if (estado.ultimaFalhaEPermanente === true) {
    return { deveTentar: false, motivo: 'RECUSA_PERMANENTE' };
  }

  const proximoIndice = estado.tentativasFeitas;

  if (proximoIndice >= politica.offsetsEmDias.length) {
    return { deveTentar: false, motivo: 'TENTATIVAS_ESGOTADAS' };
  }

  const offset = politica.offsetsEmDias[proximoIndice];

  /**
   * `offset` so e `undefined` se a lista tiver buraco, o que o tipo
   * `readonly number[]` nao impede em runtime -- entrada vem do banco.
   * Tratar como esgotado e a leitura segura: para de cobrar, nao cobra
   * numa data inventada.
   */
  if (offset === undefined) {
    return { deveTentar: false, motivo: 'TENTATIVAS_ESGOTADAS' };
  }

  return { deveTentar: true, em: somarDias(vencimento, offset) };
}

/**
 * Soma dias em UTC.
 *
 * EM UTC, `setUTCDate` e `+ n * 86400000` sao EQUIVALENTES -- UTC nao tem
 * horario de verao, todo dia tem 24 horas exatas. A escolha aqui e de
 * legibilidade, nao de correcao, e o comentario diz isso em vez de alegar
 * uma protecao que a funcao nao oferece.
 *
 * ONDE O DST IMPORTA DE VERDADE e na conversao para o fuso contratual do
 * tenant (`M2-BR-007`), que decide se a cobranca de "D+3" cai antes ou
 * depois da meia-noite local. Isso NAO acontece aqui: esta funcao devolve
 * instante em UTC, e quem apresenta ou agenda no fuso do tenant e o caso de
 * uso. Mover a regra de fuso para dentro desta funcao exigiria passar o
 * timezone -- e nao ha fatia que peca isso hoje.
 */
function somarDias(base: Date, dias: number): Date {
  const resultado = new Date(base.getTime());
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return resultado;
}
