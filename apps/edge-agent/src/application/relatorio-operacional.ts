import { resumirLatencia } from './orquestrar-passagem.js';

/**
 * Relatorio operacional -- `M0-AC-008`.
 *
 * "relatorio apresenta p50, p95, maximo, **taxa de erro** e **limitacoes
 * por equipamento**."
 *
 * Os dois ultimos itens sao os que mais somem de relatorio de POC, e sao os
 * que decidem se o MVP 0 vira MVP 1. Taxa de erro sem numero e "funcionou
 * bem"; limitacao nao registrada vira surpresa em producao.
 *
 * Funcao pura: recebe o que foi medido, devolve o resumo. Nao le relogio,
 * nao le banco.
 */

export type Limitacao = {
  /** Qual equipamento -- `catraca-01`, `facial-01`. */
  equipamento: string;
  /** O que nao da para fazer, em uma frase. */
  limitacao: string;
  /** De onde se sabe: manual, teste na bancada, resposta do suporte. */
  fonte: string;
};

export type EntradaRelatorio = {
  /** Latencias de decisao, em ms (`M0-NFR-001`). */
  latenciasMs: readonly number[];
  /** Tentativas que terminaram em `girou`. */
  passagensConfirmadas: number;
  /** Tentativas que terminaram em `timeout` -- liberou, ninguem passou. */
  passagensNaoRealizadas: number;
  /**
   * Tentativas com desfecho `desconhecido`.
   *
   * Conta SEPARADO de erro: "nao sei o que aconteceu" nao e a mesma coisa
   * que "deu errado", e juntar as duas esconde o problema mais grave dos
   * dois -- o sistema perdendo a noção do que houve.
   */
  desfechosDesconhecidos: number;
  /** Eventos ainda na fila. */
  backlog: number;
  /** Falhas de envio ao coletor. */
  falhasDeEnvio: number;
  limitacoes: readonly Limitacao[];
};

export type RelatorioOperacional = {
  latencia: { p50: number; p95: number; max: number; n: number } | null;
  /**
   * `M0-NFR-002` fixa o objetivo em p95 < 300 ms e diz que divergencia
   * "nao reprova automaticamente, mas exige analise". Por isso este campo
   * SINALIZA e nao julga.
   */
  p95DentroDoObjetivo: boolean | null;
  passagens: {
    confirmadas: number;
    naoRealizadas: number;
    desconhecidas: number;
    total: number;
  };
  /**
   * Fracao de tentativas que nao terminaram em giro confirmado.
   *
   * Inclui `desconhecido`: do ponto de vista de quem opera, uma tentativa
   * cujo desfecho o sistema nao soube dizer E um erro -- ainda que de outro
   * tipo.
   */
  taxaDeErro: number | null;
  fila: { backlog: number; falhasDeEnvio: number };
  limitacoes: readonly Limitacao[];
};

/** Objetivo do `M0-NFR-002`. */
export const OBJETIVO_P95_MS = 300;

export function montarRelatorio(entrada: EntradaRelatorio): RelatorioOperacional {
  const latencia = resumirLatencia(entrada.latenciasMs);

  const total =
    entrada.passagensConfirmadas +
    entrada.passagensNaoRealizadas +
    entrada.desfechosDesconhecidos;

  return {
    latencia,
    p95DentroDoObjetivo: latencia === null ? null : latencia.p95 < OBJETIVO_P95_MS,
    passagens: {
      confirmadas: entrada.passagensConfirmadas,
      naoRealizadas: entrada.passagensNaoRealizadas,
      desconhecidas: entrada.desfechosDesconhecidos,
      total,
    },
    // `null` sem tentativa nenhuma, nao 0. Zero por cento de erro em zero
    // tentativas e um numero excelente e vazio -- e ele apareceria no
    // relatorio como se significasse alguma coisa.
    taxaDeErro: total === 0 ? null : (total - entrada.passagensConfirmadas) / total,
    fila: { backlog: entrada.backlog, falhasDeEnvio: entrada.falhasDeEnvio },
    limitacoes: entrada.limitacoes,
  };
}

/**
 * Limitacoes que os manuais ja documentam, antes de qualquer teste.
 *
 * Estao aqui porque o `M0-AC-008` pede "limitacoes por equipamento" e estas
 * nao dependem de medicao -- vem da documentacao do fabricante. As que
 * dependem de bancada entram quando a bancada rodar.
 */
export const LIMITACOES_CONHECIDAS: readonly Limitacao[] = [
  {
    equipamento: 'catraca-01',
    limitacao:
      'a EasyInner.dll e Windows x86 e usa protocolo binario proprietario; ' +
      'exige processo Windows dedicado (ponte). Reimplementar exige NDA.',
    fonte: 'Manual de Integracao SDK Inner Acesso Rev. 00, §1.2 e §6.7',
  },
  {
    equipamento: 'catraca-01',
    limitacao:
      'nenhuma funcao de liberacao aceita id de comando: chamar duas vezes ' +
      'libera duas vezes. A idempotencia e inteiramente do integrador.',
    fonte: 'Manual SDK Inner Acesso §4.5',
  },
  {
    equipamento: 'catraca-01',
    limitacao:
      'a DLL e bloqueante e nao thread-safe; exige uma unica thread de ' +
      'comunicacao e gerencia ~30 equipamentos por instancia.',
    fonte: 'Manual SDK Inner Acesso §2.1 e §1.1',
  },
  {
    equipamento: 'facial-01',
    limitacao:
      'enrollid e numerico com no maximo 12 digitos, e o leitor precisa ' +
      'estar configurado em 18 digitos no menu para aceita-los.',
    fonte: 'Manual SDK Leitor de Biometria Facial Rev. 05, §5.4',
  },
  {
    equipamento: 'facial-01',
    limitacao:
      'o protocolo nao tem id de correlacao: a resposta so traz `ret` com o ' +
      'nome do comando, entao um comando de cada tipo por vez.',
    fonte: 'Manual de Comandos do Leitor Facial Rev. 03, §2',
  },
];
