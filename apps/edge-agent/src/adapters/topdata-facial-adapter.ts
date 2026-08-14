import {
  type EventoReconhecimento,
  type ExternalEnrollId,
  type FacialDeviceAdapter,
  type IdentidadeNoDispositivo,
  type ResultadoOperacao,
} from '../domain/facial-device.js';

/**
 * Adapter do leitor facial Topdata -- NAO IMPLEMENTADO.
 *
 * Este arquivo existe para o contrato ficar visivel e para o erro ser
 * imediato e explicito. Ele NAO tenta falar com o equipamento.
 *
 * POR QUE NAO ESTA IMPLEMENTADO
 * -----------------------------
 * A documentacao do SDK Topdata (Manual WebSocket Facial, Comandos do Leitor
 * Facial, SDK EasyInner) esta em PDF fora deste repositorio e nao foi lida.
 * Escrever chamada de API sem ela seria inventar assinatura -- e o plano de
 * apoio do MVP 0 proibe com todas as letras: "este plano nao inventa
 * chamadas EasyInner ou protocolo facial".
 *
 * Codigo inventado aqui seria pior que codigo ausente: pareceria pronto,
 * passaria em review e so quebraria na bancada, quando alguem estivesse na
 * frente do equipamento contando com ele.
 *
 * O QUE FALTA, EM ORDEM
 * ---------------------
 *   1. documentacao do SDK no repositorio (`docs/vendor/topdata/`);
 *   2. decidir o transporte: WebSocket, web server HTTP do proprio
 *      equipamento, ou DLL via bridge. A F1 ja estabeleceu que a topologia
 *      e TCP/IP puro, sem porta COM -- o que estreita o ADR-010;
 *   3. consentimento dos participantes (gate do PRD §4) antes de qualquer
 *      captura facial;
 *   4. implementar contra esta interface, sem alterar a interface para caber
 *      no SDK.
 *
 * ATE LA, `USE_SIMULATOR=true` e o caminho suportado, e e o padrao.
 */

export class TopdataAdapterNaoImplementadoError extends Error {
  readonly code = 'EDGE_TOPDATA_ADAPTER_NAO_IMPLEMENTADO';

  constructor(operacao: string) {
    super(
      [
        `TopdataFacialAdapter.${operacao}() nao esta implementado.`,
        '',
        'O adapter real depende da documentacao do SDK Topdata, que ainda nao',
        'esta neste repositorio. Ver docs/DEVELOPMENT.md, MVP 0.',
        '',
        'Para desenvolver e rodar testes sem hardware, use USE_SIMULATOR=true',
        '(o padrao).',
      ].join('\n'),
    );
    this.name = 'TopdataAdapterNaoImplementadoError';
  }
}

/**
 * Falha ALTO em toda operacao.
 *
 * A alternativa -- devolver `{ confirmado: false }` silenciosamente -- seria
 * pior: o chamador trataria como "o dispositivo recusou" e seguiria adiante,
 * quando na verdade nao ha adapter nenhum. Erro de programacao nao pode se
 * disfarcar de erro de operacao.
 */
export class TopdataFacialAdapter implements FacialDeviceAdapter {
  readonly nome = 'topdata-facial (nao implementado)';

  cadastrar(_identidade: IdentidadeNoDispositivo): Promise<ResultadoOperacao> {
    throw new TopdataAdapterNaoImplementadoError('cadastrar');
  }

  remover(_externalEnrollId: ExternalEnrollId): Promise<ResultadoOperacao> {
    throw new TopdataAdapterNaoImplementadoError('remover');
  }

  listar(): Promise<readonly IdentidadeNoDispositivo[]> {
    throw new TopdataAdapterNaoImplementadoError('listar');
  }

  aoReconhecer(_ouvinte: (evento: EventoReconhecimento) => void): void {
    throw new TopdataAdapterNaoImplementadoError('aoReconhecer');
  }

  encerrar(): Promise<void> {
    // Unica operacao que nao lanca: encerrar o que nunca abriu e no-op, e
    // fazer o shutdown gracioso (`M0-NFR-007`) explodir por causa disto
    // seria trocar um problema por outro pior.
    return Promise.resolve();
  }
}
