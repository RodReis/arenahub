import { type ResultadoLiberacao, type TurnstileAdapter } from '../domain/turnstile.js';

/**
 * Adapter da catraca Topdata Inner -- NAO IMPLEMENTADO.
 *
 * POR QUE NAO ESTA IMPLEMENTADO
 * -----------------------------
 * Mesmo motivo do `TopdataFacialAdapter`: a documentacao do SDK esta em PDF
 * fora deste repositorio, e o plano de apoio do MVP 0 proibe inventar
 * chamada. Mas aqui o risco e MAIOR, e vale dizer por que.
 *
 * O adapter facial escreve numa base. Este MOVE UMA CATRACA. Um comando
 * inventado que por acaso funcione parcialmente -- abre mas nao confirma,
 * ou abre duas vezes -- produz efeito fisico numa catraca instalada, em
 * teste, numa unidade em funcionamento. "Parece que funcionou" e o pior
 * resultado possivel neste arquivo.
 *
 * O QUE FALTA, EM ORDEM
 * ---------------------
 *   1. documentacao do SDK no repositorio (`docs/vendor/topdata/`);
 *   2. decidir o transporte -- a F1 estabeleceu TCP/IP puro, sem porta COM;
 *   3. **janela combinada com a operacao** -- diferente do facial, testar
 *      isto significa girar a catraca de verdade, e a unidade esta em uso;
 *   4. procedimento de parada de emergencia definido (gate do PRD §4,
 *      item 7) -- este item existe no gate exatamente para o momento em que
 *      este arquivo passar a funcionar.
 *
 * ATE LA, `USE_SIMULATOR=true` e o caminho suportado, e e o padrao.
 */

export class TopdataInnerAdapterNaoImplementadoError extends Error {
  readonly code = 'EDGE_TOPDATA_INNER_NAO_IMPLEMENTADO';

  constructor(operacao: string) {
    super(
      [
        `TopdataInnerAdapter.${operacao}() nao esta implementado.`,
        '',
        'Este adapter comanda uma catraca fisica instalada e em uso. Ele nao',
        'sera implementado sem a documentacao do SDK, janela combinada com a',
        'operacao e procedimento de parada de emergencia definido.',
        '',
        'Ver docs/DEVELOPMENT.md, MVP 0, e o gate do PRD §4.',
        '',
        'Para desenvolver e rodar testes sem hardware, use USE_SIMULATOR=true',
        '(o padrao).',
      ].join('\n'),
    );
    this.name = 'TopdataInnerAdapterNaoImplementadoError';
  }
}

export class TopdataInnerAdapter implements TurnstileAdapter {
  readonly nome = 'topdata-inner (nao implementado)';

  liberar(_comandoId: string, _timeoutMs: number): Promise<ResultadoLiberacao> {
    throw new TopdataInnerAdapterNaoImplementadoError('liberar');
  }

  encerrar(): Promise<void> {
    // Nao lanca, pelo mesmo motivo do adapter facial: shutdown gracioso
    // (`M0-NFR-007`) nao pode explodir por causa de conexao que nunca abriu.
    return Promise.resolve();
  }
}
