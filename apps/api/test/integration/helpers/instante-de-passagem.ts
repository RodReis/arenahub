/**
 * Helper de fixture: escolhe QUANDO a passagem de catraca aconteceu, para
 * teste de integracao que grava presenca e depois consulta caso de uso que le
 * o relogio REAL (`new Date()` no controller), nao um `agora` injetado.
 *
 * As tres condicoes que o instante tem de satisfazer ao mesmo tempo:
 *
 *   1. ESTAR NO PASSADO em relacao a `agora` -- `frequenciaDoAluno` filtra
 *      `occurredAt: { lte: agora }`, entao passagem futura e excluida e
 *      nenhuma `StudentAttendanceSession` nasce. O saldo volta 0 e o teste
 *      falha com "No record was found".
 *
 *   2. CAIR NO DIA CIVIL LOCAL DE HOJE -- `agora - 1h` cego cai em ONTEM
 *      quando a suite roda entre 00:00 e 01:00 no fuso da academia, e a
 *      sessao nasce fora do dia/mes que o endpoint consulta.
 *
 *   3. NAO DEPENDER DE UMA FOLGA QUE O RELOGIO PODE NAO TER -- foi aqui que a
 *      versao anterior errou (issue #279). Ela pegava o MAIOR entre
 *      `agora - 1h` e `hoje local T00:05`, o que resolve (1) e (2)
 *      isoladamente mas se contradiz entre 00:00 e 00:05 local: nessa janela
 *      de cinco minutos `T00:05` ainda NAO ACONTECEU, ganha o maior, e a
 *      fixture nasce no futuro. Falhou no CI em 05/09/2026 as 00:01 local.
 *
 * A saida correta e o ponto medio entre a meia-noite local e `agora` quando
 * `agora` esta dentro da primeira hora do dia, e `agora - 1h` no resto do dia.
 * Assim (1) vale sempre por construcao -- o resultado e estritamente menor
 * que `agora` em qualquer horario -- e (2) vale porque o ponto medio nunca
 * cruza para tras da meia-noite.
 *
 * CONTRATO ADICIONAL, exigido pelo segundo consumidor
 * (`kiosk-tela-publica.int-spec.ts`): a distancia ate `agora` fica sempre
 * abaixo de 3h (`JANELA_DE_TREINO_HORAS`), senao `treinandoAgora` nao conta a
 * entrada. Vale por construcao -- no maximo 1h --, e tem teste proprio para
 * que uma mudanca futura aqui nao quebre calado um consumidor que nao sabe da
 * restricao.
 */

/** Meia-noite local de HOJE, no fuso dado, como instante absoluto. */
const meiaNoiteLocal = (agora: Date, fuso: string): Date => {
  const diaLocal = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);

  /*
   * O offset e lido do proprio `agora` em vez de escrito literal (`-03:00`):
   * horario de verao, se voltar, muda o offset e um literal passaria a
   * apontar para a hora errada sem nenhum teste reclamar.
   */
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    timeZoneName: 'longOffset',
  }).formatToParts(agora);
  const offset = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-03:00';

  return new Date(`${diaLocal}T00:00:00.000${offset.replace('GMT', '')}`);
};

/**
 * Instante de uma passagem de catraca que ja aconteceu e cai no dia civil
 * local de hoje, para qualquer horario de execucao da suite.
 */
export const instanteDePassagemDeHoje = (
  agora: Date = new Date(),
  fuso = 'America/Sao_Paulo',
): Date => {
  const meiaNoite = meiaNoiteLocal(agora, fuso);
  const umaHoraAtras = new Date(agora.getTime() - 60 * 60 * 1000);

  // Fora da primeira hora do dia local, `agora - 1h` ja satisfaz tudo.
  if (umaHoraAtras >= meiaNoite) return umaHoraAtras;

  /*
   * Dentro da primeira hora: o ponto medio entre a meia-noite local e `agora`.
   * Estritamente depois da meia-noite (mesmo dia civil) e estritamente antes
   * de `agora` (ja no passado) -- as duas condicoes, sem folga arbitraria.
   */
  return new Date(meiaNoite.getTime() + (agora.getTime() - meiaNoite.getTime()) / 2);
};
