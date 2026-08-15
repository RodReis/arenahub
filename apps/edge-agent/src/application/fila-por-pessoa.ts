/**
 * Serializa trabalho por chave -- uma fila por pessoa.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Sem serializacao, dois reconhecimentos da MESMA pessoa processados em
 * paralelo produzem duas liberacoes fisicas, e nenhuma das duas defesas da
 * Slice 0.3 pega:
 *
 *   - a janela anti-repique nao pega porque ambos leem `ultimoAllowEm`
 *     ANTES de qualquer `registrarAllow` completar -- a leitura acontece
 *     antes do `await`, a escrita depois;
 *   - o `comandoId` idempotente nao pega porque cada tentativa tem
 *     `correlationId` proprio, entao para o adapter sao dois comandos
 *     legitimamente distintos.
 *
 * Reproduzido: `Promise.all` de dois `processarReconhecimento` da mesma
 * pessoa acionava a catraca duas vezes. `M0-AC-003` proibe.
 *
 * A correcao nao pode ser "lembrar de serializar no wiring": esse tipo de
 * pre-condicao implicita e exatamente o que se perde entre fatias. Aqui ela
 * e explicita e testada.
 *
 * Serializa POR PESSOA, nao globalmente: duas pessoas diferentes passando ao
 * mesmo tempo em catracas diferentes nao tem por que esperar uma pela outra.
 */
export class FilaPorPessoa {
  /** Ultima promessa em andamento para cada chave. */
  private readonly emAndamento = new Map<string, Promise<unknown>>();

  /**
   * Executa `trabalho` garantindo que nada mais com a mesma `chave` rode ao
   * mesmo tempo.
   *
   * A rejeicao de um trabalho NAO derruba os seguintes: cada um recebe seu
   * proprio resultado. Uma falha de comando na catraca nao pode travar a
   * fila daquela pessoa para sempre.
   */
  async executar<T>(chave: string, trabalho: () => Promise<T>): Promise<T> {
    const anterior = this.emAndamento.get(chave) ?? Promise.resolve();

    // Espera o anterior terminar, com sucesso ou nao. Os dois ramos chamam
    // `trabalho()` de proposito: so queremos ESPERAR, nunca herdar a falha.
    // Uma falha de comando na catraca nao pode travar a fila da pessoa.
    const meuTurno = anterior.then(
      () => trabalho(),
      () => trabalho(),
    );

    // O que fica no Map e a versao "amortecida": quem esperar por ela nunca
    // vê rejeicao, so o fim do turno.
    const marcador = meuTurno.catch(() => undefined);
    this.emAndamento.set(chave, marcador);

    try {
      return await meuTurno;
    } finally {
      // Limpa se ninguem entrou na fila depois de mim -- senao o Map cresce
      // sem parar num agente que roda por meses.
      if (this.emAndamento.get(chave) === marcador) {
        this.emAndamento.delete(chave);
      }
    }
  }

  /** Quantas chaves tem trabalho em andamento. Para diagnostico. */
  get tamanho(): number {
    return this.emAndamento.size;
  }
}
