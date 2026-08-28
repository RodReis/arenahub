import { beforeEach, describe, expect, it } from '@jest/globals';

import { EngagementXpService } from './engagement-xp.service.js';
import { FakePortaDeXp } from './engagement-xp.repository.fake.js';
import type { TenantContext } from '../../common/tenant/tenant-context.js';

const contexto = { tenantId: 't1', actorId: 'u1' } as TenantContext;
const AGORA = new Date('2026-08-20T12:00:00Z');

describe('EngagementXpService.sincronizarXp', () => {
  let fake: FakePortaDeXp;
  let servico: EngagementXpService;

  beforeEach(() => {
    fake = new FakePortaDeXp();
    servico = new EngagementXpService(fake);
  });

  it('concede XP por sessao ainda nao pontuada', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    const resumo = await servico.sincronizarXp(contexto, 'aluno-1', AGORA);

    expect(resumo.concedidos).toBe(1);
    expect(resumo.saldoDoMes).toBe(10);
  });

  it('nao concede duas vezes pela mesma sessao', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    await servico.sincronizarXp(contexto, 'aluno-1', AGORA);
    const segunda = await servico.sincronizarXp(contexto, 'aluno-1', AGORA);

    expect(segunda.concedidos).toBe(0);
    expect(segunda.saldoDoMes).toBe(10);
  });

  /*
   * A colisao de unicidade e SUCESSO, nao erro. Sem isto, duas abas abertas
   * no totem fariam a segunda estourar 500 na cara do aluno.
   */
  it('trata colisao de unicidade como sucesso idempotente', async () => {
    fake.comRegra({ points: 10 });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);
    fake.colidirNaProximaEscrita();

    await expect(servico.sincronizarXp(contexto, 'aluno-1', AGORA)).resolves.toMatchObject({
      concedidos: 0,
    });
  });

  it('sessao sem regra vigente na data nao gera movimento', async () => {
    fake.comRegra({ points: 10, effectiveFrom: new Date('2026-09-01T00:00:00Z') });
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).concedidos).toBe(0);
  });

  it('desbloqueia a conquista de primeiro treino', async () => {
    fake.comRegra({ points: 10 });
    fake.comDefinicoes([{ id: 'd1', code: 'primeiro-treino', version: 1, title: 'Primeiro treino', criterionKind: 'SESSOES_ACUMULADAS', threshold: 1 }]);
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).conquistasNovas).toEqual([
      'primeiro-treino',
    ]);
  });

  /*
   * `M5-BR-002`: recusar o ranking nao reduz XP. O servico de XP nao chama
   * `resolverExposicao` -- e este teste e o que impede alguem de "corrigir"
   * isso mais tarde achando que e coerencia.
   */
  it('concede XP mesmo para aluno em opt-out de ranking', async () => {
    fake.comRegra({ points: 10 });
    fake.comOptOut('aluno-1');
    fake.comSessoes([{ id: 's1', occurredAt: new Date('2026-08-10T12:00:00Z'), fusoDaUnidade: 'America/Sao_Paulo' }]);

    expect((await servico.sincronizarXp(contexto, 'aluno-1', AGORA)).saldoDoMes).toBe(10);
  });

  /*
   * `M5-FR-006`: conquista sai de fato VERIFICADO. A GRANT original de uma
   * sessao estornada permanece no ledger (append-only), mas o REVERSAL que
   * a anula tem de contar contra o marco -- senao a contagem fica presa no
   * numero antigo mesmo apos a correcao.
   */
  it('sessao revertida nao conta para o marco', async () => {
    const sessaoEm = (indice: number) => ({
      id: `s${indice}`,
      occurredAt: new Date(`2026-08-${String(indice).padStart(2, '0')}T12:00:00Z`),
      fusoDaUnidade: 'America/Sao_Paulo',
    });
    const dezSessoes = Array.from({ length: 10 }, (_valor, indice) => sessaoEm(indice + 1));

    fake.comRegra({ points: 10 });
    fake.comDefinicoes([
      { id: 'd1', code: 'dez-treinos', version: 1, title: '10 treinos', criterionKind: 'SESSOES_ACUMULADAS', threshold: 10 },
    ]);
    // So 9 das 10 sessoes na primeira rodada -- o marco de 10 NAO desbloqueia
    // ainda. Se as 10 entrassem de uma vez, o desbloqueio aconteceria ANTES
    // da reversao, e "revogar conquista ja desbloqueada" e escopo da Task 11
    // (`reverse-achievement`), fora desta correcao.
    fake.comSessoes(dezSessoes.slice(0, 9));
    await servico.sincronizarXp(contexto, 'aluno-1', AGORA);
    expect(await fake.conquistasDoAluno(contexto, 'aluno-1')).not.toContain('d1');

    // Estorna uma das 9 e adiciona uma decima nova: bruto chegaria a "10
    // GRANT historicas", liquido continua em 9 validas.
    fake.reverterSessao('s1');
    fake.comSessoes([sessaoEm(10)]);

    await servico.sincronizarXp(contexto, 'aluno-1', AGORA);

    // Com 9 sessoes validas (10 GRANT - 1 revertida), o marco de 10 continua
    // fechado.
    expect(await fake.conquistasDoAluno(contexto, 'aluno-1')).not.toContain('d1');
  });
});

describe('EngagementXpService.obterConsistencia', () => {
  let fake: FakePortaDeXp;
  let servico: EngagementXpService;

  /** Uma sessao no dia local `AAAA-MM-DD`, meio-dia -- longe da virada. */
  function sessaoNoDia(dataLocal: string, id = dataLocal) {
    return { id, occurredAt: new Date(`${dataLocal}T15:00:00Z`), fusoDaUnidade: FUSO };
  }

  const FUSO = 'America/Sao_Paulo';

  beforeEach(() => {
    fake = new FakePortaDeXp();
    servico = new EngagementXpService(fake);
    fake.comAluno('aluno-1', FUSO);
  });

  it('devolve zero para aluno sem nenhuma sessao', async () => {
    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    expect(consistencia).toMatchObject({ atual: 0, recorde: 0, diasPorSemana: 3 });
  });

  it('conta a semana que bateu a meta', async () => {
    fake.comSessoes([
      sessaoNoDia('2026-08-17'),
      sessaoNoDia('2026-08-19'),
      sessaoNoDia('2026-08-21'),
    ]);

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    expect(consistencia.atual).toBe(1);
  });

  it('nao paga a mais por treinar todo dia -- `M5-BR-005`', async () => {
    fake.comSessoes(
      ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-22'].map(
        (dia) => sessaoNoDia(dia),
      ),
    );

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    // Seis dias numa semana continuam valendo UMA semana de streak.
    expect(consistencia.atual).toBe(1);
  });

  it('pausa aprovada nao rompe o streak -- `M5-FR-009`', async () => {
    fake.comSessoes([
      sessaoNoDia('2026-08-17'),
      sessaoNoDia('2026-08-19'),
      sessaoNoDia('2026-08-21'),
      sessaoNoDia('2026-09-07'),
      sessaoNoDia('2026-09-09'),
      sessaoNoDia('2026-09-11'),
    ]);
    fake.comPausa('aluno-1', { inicio: '2026-08-24', fim: '2026-09-06' });

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-09-13', FUSO);

    expect(consistencia.atual).toBe(2);
  });

  it('SEM a pausa, o mesmo historico rompe o streak', async () => {
    // O par do teste acima: prova que foi a PAUSA que preservou o streak, e
    // nao um preenchimento de semana que nunca acontece.
    fake.comSessoes([
      sessaoNoDia('2026-08-17'),
      sessaoNoDia('2026-08-19'),
      sessaoNoDia('2026-08-21'),
      sessaoNoDia('2026-09-07'),
      sessaoNoDia('2026-09-09'),
      sessaoNoDia('2026-09-11'),
    ]);

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-09-13', FUSO);

    expect(consistencia).toMatchObject({ atual: 1, recorde: 1 });
  });

  it('nao conta o mesmo dia duas vezes quando o aluno treina em duas unidades', async () => {
    // Duas sessoes no MESMO dia local, unidades diferentes: e um dia treinado.
    fake.comSessoes([
      { id: 'a', occurredAt: new Date('2026-08-17T12:00:00Z'), fusoDaUnidade: FUSO },
      { id: 'b', occurredAt: new Date('2026-08-17T22:00:00Z'), fusoDaUnidade: FUSO },
      sessaoNoDia('2026-08-19'),
    ]);

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    // Dois dias distintos, meta de tres -- nao qualifica.
    expect(consistencia.atual).toBe(0);
  });

  it('limita as semanas EXIBIDAS sem truncar o streak calculado', async () => {
    // 15 semanas seguidas qualificadas: a tela recebe 12, mas `atual` conta
    // as 15. Truncar antes de resumir romperia o streak de quem tem historico
    // mais longo que a janela.
    const dias: string[] = [];
    for (let semana = 0; semana < 15; semana += 1) {
      const segunda = new Date(Date.UTC(2026, 4, 4) + semana * 7 * 86_400_000);
      for (const offset of [0, 2, 4]) {
        dias.push(new Date(segunda.getTime() + offset * 86_400_000).toISOString().slice(0, 10));
      }
    }

    fake.comSessoes(dias.map((dia) => sessaoNoDia(dia)));

    const ultimaSegunda = dias[dias.length - 3]!;
    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', ultimaSegunda, FUSO);

    expect(consistencia.semanas).toHaveLength(12);
    expect(consistencia.atual).toBe(15);
  });

  it('devolve as semanas da mais recente para a mais antiga', async () => {
    fake.comSessoes([
      sessaoNoDia('2026-08-17'),
      sessaoNoDia('2026-08-19'),
      sessaoNoDia('2026-08-21'),
      sessaoNoDia('2026-08-24'),
    ]);

    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    expect(consistencia.semanas.map((semana) => semana.inicio)).toEqual([
      '2026-08-24',
      '2026-08-17',
    ]);
  });

  it('carrega a politica vigente na resposta -- a tela nunca repete a meta', async () => {
    const consistencia = await servico.obterConsistencia(contexto, 'aluno-1', '2026-08-27', FUSO);

    expect(consistencia.politica).toBe('semana-civil-local@1');
  });
});
