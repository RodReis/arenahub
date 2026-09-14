import { describe, expect, it } from '@jest/globals';

import { instanteDePassagemDeHoje } from './instante-de-passagem.js';

/**
 * Issue #279 -- tres testes de `xp-e-ranking.int-spec.ts` falhavam no CI de
 * forma intermitente, e a janela era de CINCO MINUTOS por dia.
 *
 * NAO USA BANCO. A escolha do instante e calculo puro, e testa-la como
 * calculo puro e o que permite varrer os 1440 minutos do dia -- a versao
 * anterior do helper passaria em 1435 deles, que e exatamente por que o
 * defeito sobreviveu meses e so apareceu quando o CI, crescendo, passou a
 * cruzar a meia-noite de Sao Paulo.
 *
 * Mora em `test/integration/` porque e ali que vive o helper que ele prova, e
 * o projeto `unit` do Jest so varre `src/`.
 */
describe('#279 -- instante de passagem de fixture', () => {
  const FUSO = 'America/Sao_Paulo';

  const diaLocal = (instante: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: FUSO,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instante);

  /**
   * Os 1440 minutos de um dia civil, como instantes absolutos. O dia base e
   * 05/09/2026 -- a data real da falha registrada na issue.
   */
  const todosOsMinutosDoDia = (): Date[] => {
    const meiaNoiteLocal = new Date('2026-09-05T00:00:00.000-03:00');

    return Array.from(
      { length: 24 * 60 },
      (_, minuto) => new Date(meiaNoiteLocal.getTime() + minuto * 60 * 1000),
    );
  };

  /*
   * A condicao 1: ja aconteceu. `frequenciaDoAluno` filtra
   * `occurredAt: { lte: agora }` -- passagem futura e excluida, nenhuma
   * sessao nasce, e o teste de XP falha com "No record was found".
   *
   * O limite e `lte`, e nao `lt`: passagem no instante EXATO de `agora`
   * entra. Isso importa num unico minuto do dia -- 00:00:00 local, onde nao
   * existe instante que esteja ao mesmo tempo estritamente no passado E no
   * dia civil de hoje. Nesse caso a propria meia-noite e a resposta certa, e
   * o filtro do repositorio a aceita.
   */
  it('nao devolve instante no futuro em nenhum minuto do dia', () => {
    const futuros = todosOsMinutosDoDia().filter(
      (agora) => instanteDePassagemDeHoje(agora, FUSO) > agora,
    );

    expect(futuros.map((d) => d.toISOString())).toEqual([]);
  });

  /*
   * A condicao 2: cai no dia civil local de HOJE. `agora - 1h` cego cai em
   * ONTEM na primeira hora do dia, e a sessao nasce fora do dia/mes que o
   * endpoint consulta.
   */
  it('devolve instante no dia civil local de hoje em qualquer minuto do dia', () => {
    const foraDoDia = todosOsMinutosDoDia().filter(
      (agora) => diaLocal(instanteDePassagemDeHoje(agora, FUSO)) !== diaLocal(agora),
    );

    expect(foraDoDia.map((d) => d.toISOString())).toEqual([]);
  });

  /*
   * A condicao 3, exigida pelo SEGUNDO consumidor do helper
   * (`kiosk-tela-publica.int-spec.ts`): o instante tem de caber na JANELA DE
   * TREINO de 3h (`JANELA_DE_TREINO_HORAS`), senao `treinandoAgora` volta 0.
   *
   * Vale por construcao -- fora da primeira hora do dia a distancia e de
   * exatamente 1h, e dentro dela e no maximo 30 min --, mas prender isso num
   * teste evita que uma mudanca futura no helper quebre calada o outro
   * consumidor, que nao tem como saber da restricao.
   */
  it('devolve instante dentro da janela de treino de 3h em qualquer minuto do dia', () => {
    const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

    const foraDaJanela = todosOsMinutosDoDia().filter(
      (agora) => agora.getTime() - instanteDePassagemDeHoje(agora, FUSO).getTime() >= TRES_HORAS_MS,
    );

    expect(foraDaJanela.map((d) => d.toISOString())).toEqual([]);
  });

  /*
   * O minuto EXATO da falha registrada na issue: 05/09/2026 03:01 UTC, que e
   * 00:01 em Sao Paulo. A versao anterior escolhia `hoje T00:05 local` -- que
   * naquele instante ainda nao tinha acontecido.
   */
  it('nao devolve o futuro as 00:01 local, o minuto que quebrou o CI', () => {
    const agora = new Date('2026-09-05T03:01:00.000Z');

    const escolhido = instanteDePassagemDeHoje(agora, FUSO);

    expect(escolhido.getTime()).toBeLessThan(agora.getTime());
    expect(diaLocal(escolhido)).toBe('2026-09-05');
  });
});
