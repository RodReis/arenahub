import {
  decidirAcesso,
  type DecisaoAcesso,
  type PermissaoLocal,
} from '../domain/access-decision.js';
import { type EventoReconhecimento } from '../domain/facial-device.js';
import {
  type DesfechoPassagem,
  type SentidoGiro,
  type TurnstileAdapter,
} from '../domain/turnstile.js';
import { FilaPorPessoa } from './fila-por-pessoa.js';

/**
 * Do reconhecimento ate a passagem -- o coracao da Slice 0.3.
 *
 * A regra que este arquivo existe para garantir, e que o `M0-AC-004` mede:
 *
 *   **`DENY` NUNCA chega perto da catraca.**
 *
 * Nao e disciplina, e estrutura: o unico `liberar()` do arquivo esta depois
 * de um `return` no caminho de negativa. Nao ha como negar e acionar.
 */

/** Prazo para o equipamento confirmar giro. Valor de POC. */
export const TIMEOUT_PASSAGEM_MS = 8_000;

export type TentativaPassagem = {
  correlationId: string;
  externalEnrollId: string;
  decisao: DecisaoAcesso;
  /** Ausente quando a decisao foi `DENY` -- e essa ausencia e a prova. */
  desfecho?: DesfechoPassagem;
  /**
   * Do reconhecimento ate o comando de liberacao (`M0-NFR-001`).
   *
   * Nao inclui o tempo de giro: o que o ADR-004 quer saber e quanto DEMORA
   * PARA DECIDIR, nao quanto a pessoa leva para atravessar.
   */
  latenciaDecisaoMs: number;
  /** Duracao do giro, quando houve liberacao. */
  duracaoPassagemMs?: number;
};

export type DepsPassagem = {
  catraca: TurnstileAdapter;
  /** Busca a permissao local. Null = a bancada nao conhece essa pessoa. */
  buscarPermissao: (externalEnrollId: string) => PermissaoLocal | null;
  /** Registra que houve ALLOW, para a janela anti-repique valer. */
  registrarAllow: (externalEnrollId: string, em: Date) => void;
  /** Relogio monotonico, para medir latencia sem sofrer com ajuste de hora. */
  agoraMonotonicoMs: () => number;
  /**
   * Sentido do giro a comandar. Default `entrada`.
   *
   * Qual sentido gira fisicamente para dentro DEPENDE DA INSTALACAO -- o
   * manual e explicito que se descobre testando. Na bancada da Arena, o
   * mapeamento sentido -> lado fisico e um dado de campo, nao uma constante.
   */
  sentido?: SentidoGiro;
};

/**
 * Processa um reconhecimento -- SEM serializacao.
 *
 * ⚠️ NAO CHAME ESTA FUNCAO DIRETO no caminho de producao. Use
 * `criarProcessadorDePassagem`, que serializa por pessoa.
 *
 * Duas chamadas concorrentes para a MESMA pessoa acionam a catraca duas
 * vezes, e nenhuma das defesas pega: ambas leem `ultimoAllowEm` antes do
 * `await`, e cada uma tem `correlationId` proprio, entao o adapter ve dois
 * comandos distintos. Reproduzido, e proibido pelo `M0-AC-003`.
 *
 * Fica exportada porque testar a decisao isolada da fila e legitimo -- mas
 * o caminho suportado e o processador.
 *
 * O `comandoId` sai do `correlationId`: uma tentativa, um comando. Se o
 * mesmo reconhecimento for reprocessado -- reinicio, fila, retry -- o
 * `comandoId` se repete e o adapter reconhece que ja executou.
 */
export async function processarReconhecimento(
  deps: DepsPassagem,
  evento: EventoReconhecimento,
  correlationId: string,
  agora: Date,
  timeoutMs: number = TIMEOUT_PASSAGEM_MS,
): Promise<TentativaPassagem> {
  const inicio = deps.agoraMonotonicoMs();

  const permissao = deps.buscarPermissao(evento.externalEnrollId);
  const decisao = decidirAcesso(permissao, agora);

  const latenciaDecisaoMs = deps.agoraMonotonicoMs() - inicio;

  // M0-AC-004: acessos negados nao acionam fisicamente a catraca.
  //
  // O `return` aqui e a garantia. Nao ha caminho abaixo deste ponto que
  // chegue ao `liberar()` com uma decisao DENY -- e nao ha `liberar()`
  // acima dele.
  if (decisao.resultado === 'DENY') {
    return {
      correlationId,
      externalEnrollId: evento.externalEnrollId,
      decisao,
      latenciaDecisaoMs,
    };
  }

  const resultado = await deps.catraca.liberar(correlationId, timeoutMs, deps.sentido);

  // Só depois de liberar de fato: registrar antes faria uma falha de
  // comando consumir a janela anti-repique e negar a proxima tentativa
  // legitima da pessoa, que nem chegou a passar.
  deps.registrarAllow(evento.externalEnrollId, agora);

  return {
    correlationId,
    externalEnrollId: evento.externalEnrollId,
    decisao,
    desfecho: resultado.desfecho,
    latenciaDecisaoMs,
    duracaoPassagemMs: resultado.duracaoMs,
  };
}

/**
 * Cria o processador de passagem -- ESTE e o caminho de producao.
 *
 * Serializa por pessoa. Duas tentativas da mesma pessoa nunca correm em
 * paralelo, entao a janela anti-repique enxerga o `registrarAllow` da
 * anterior e o `M0-AC-003` se sustenta mesmo com o leitor disparando eventos
 * em rajada.
 *
 * Pessoas diferentes continuam em paralelo: nao ha razao para uma esperar
 * pela outra.
 *
 * Quem conectar `aoReconhecer` do dispositivo usa isto, nao
 * `processarReconhecimento` direto.
 */
export function criarProcessadorDePassagem(
  deps: DepsPassagem,
  timeoutMs: number = TIMEOUT_PASSAGEM_MS,
): (evento: EventoReconhecimento, correlationId: string, agora: Date) => Promise<TentativaPassagem> {
  const fila = new FilaPorPessoa();

  return (evento, correlationId, agora) =>
    fila.executar(evento.externalEnrollId, () =>
      processarReconhecimento(deps, evento, correlationId, agora, timeoutMs),
    );
}

/**
 * Percentis de latencia -- `M0-NFR-001` pede p50, p95 e maximo.
 *
 * Funcao pura sobre a lista de medicoes. O `M0-NFR-002` fixa o objetivo de
 * p95 abaixo de 300 ms e diz que divergencia "nao reprova automaticamente,
 * mas exige analise" -- por isso isto CALCULA e nao julga.
 */
export function resumirLatencia(amostras: readonly number[]): {
  p50: number;
  p95: number;
  max: number;
  n: number;
} | null {
  if (amostras.length === 0) return null;

  // NaN corrompe o sort em silencio: `NaN - x` e sempre NaN, que o motor
  // trata como 0, deixando o array mal ordenado sem erro nenhum. Metrica
  // errada e pior que metrica ausente -- ela sera citada num relatorio.
  const invalidas = amostras.filter((a) => !Number.isFinite(a));
  if (invalidas.length > 0) {
    throw new TypeError(
      `resumirLatencia recebeu ${invalidas.length} amostra(s) nao finita(s) -- ` +
        'medicao corrompida, corrija a origem em vez de mascarar o numero',
    );
  }

  const ordenadas = [...amostras].sort((a, b) => a - b);
  const percentil = (p: number): number => {
    // Nearest-rank: com poucas amostras -- o caso de uma bancada -- ele nao
    // inventa valor que nunca foi medido, ao contrario da interpolacao.
    const posicao = Math.ceil((p / 100) * ordenadas.length) - 1;
    return ordenadas[Math.min(Math.max(posicao, 0), ordenadas.length - 1)]!;
  };

  return {
    p50: percentil(50),
    p95: percentil(95),
    max: ordenadas[ordenadas.length - 1]!,
    n: ordenadas.length,
  };
}
