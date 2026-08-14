import {
  type EventoReconhecimento,
  type ExternalEnrollId,
  type FacialDeviceAdapter,
  type IdentidadeNoDispositivo,
  type ResultadoOperacao,
} from '../domain/facial-device.js';

/**
 * Simulador contratual do dispositivo facial -- entrega da Slice 0.2.
 *
 * `M0-NFR-006` exige que o simulador rode em CI SEM HARDWARE. Ele nao imita
 * a Topdata: imita o CONTRATO (`FacialDeviceAdapter`). A diferenca importa --
 * imitar o fornecedor exigiria conhecer o SDK, que e justamente o que ainda
 * nao temos.
 *
 * O que ele simula de proposito, porque e onde o codigo costuma quebrar:
 *
 *   - cadastrar duas vezes o mesmo id NAO duplica (idempotencia);
 *   - remover o que nao existe e SUCESSO -- o estado desejado e ausencia,
 *     e ela ja vale (regra de arquitetura no 4: reprocessar e seguro);
 *   - `listar` devolve o estado real, o que permite detectar dado orfao;
 *   - da para injetar falha, para o caminho de erro ter teste.
 *
 * Dublê vive no boundary, nunca dentro da regra de dominio
 * (`docs/TESTING.md`).
 */
export class FacialSimulator implements FacialDeviceAdapter {
  readonly nome = 'simulador-facial';

  private readonly identidades = new Map<ExternalEnrollId, IdentidadeNoDispositivo>();
  private readonly ouvintes: ((evento: EventoReconhecimento) => void)[] = [];

  /** Falha injetada para o proximo comando, por operacao. */
  private falhaProgramada: { operacao: 'cadastrar' | 'remover'; razao: string } | null = null;

  /**
   * Programa a proxima operacao para falhar.
   *
   * Sem isto, o caminho de erro so seria testavel desligando o equipamento
   * de verdade -- e caminho de erro sem teste e o que quebra na bancada.
   */
  programarFalha(operacao: 'cadastrar' | 'remover', razao: string): void {
    this.falhaProgramada = { operacao, razao };
  }

  private consumirFalha(operacao: 'cadastrar' | 'remover'): string | null {
    if (this.falhaProgramada?.operacao !== operacao) return null;
    const razao = this.falhaProgramada.razao;
    this.falhaProgramada = null;
    return razao;
  }

  cadastrar(identidade: IdentidadeNoDispositivo): Promise<ResultadoOperacao> {
    const falha = this.consumirFalha('cadastrar');
    if (falha) return Promise.resolve({ confirmado: false, razao: falha });

    // Idempotente: o Map sobrescreve, entao cadastrar duas vezes deixa uma.
    this.identidades.set(identidade.externalEnrollId, identidade);
    return Promise.resolve({ confirmado: true });
  }

  remover(externalEnrollId: ExternalEnrollId): Promise<ResultadoOperacao> {
    const falha = this.consumirFalha('remover');
    if (falha) return Promise.resolve({ confirmado: false, razao: falha });

    // Remover o que nao existe e sucesso: a ausencia -- o estado desejado --
    // ja vale. Tratar como erro faria a reconciliacao travar em algo que ja
    // esta certo.
    this.identidades.delete(externalEnrollId);
    return Promise.resolve({ confirmado: true });
  }

  listar(): Promise<readonly IdentidadeNoDispositivo[]> {
    return Promise.resolve([...this.identidades.values()]);
  }

  aoReconhecer(ouvinte: (evento: EventoReconhecimento) => void): void {
    this.ouvintes.push(ouvinte);
  }

  /**
   * Dispara um reconhecimento, como o equipamento faria.
   *
   * `emAlguemDesconhecido` cobre o caso que o `M0-FR-005` precisa negar:
   * rosto que o dispositivo reconhece mas que nao esta na nossa base.
   */
  simularReconhecimento(
    externalEnrollId: ExternalEnrollId,
    ocorridoEm: Date,
    metodo: EventoReconhecimento['metodo'] = 'facial',
  ): void {
    const evento: EventoReconhecimento = { externalEnrollId, ocorridoEm, metodo };
    for (const ouvinte of this.ouvintes) ouvinte(evento);
  }

  encerrar(): Promise<void> {
    this.ouvintes.length = 0;
    return Promise.resolve();
  }
}
