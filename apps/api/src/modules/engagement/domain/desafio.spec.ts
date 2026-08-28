import { describe, expect, it } from '@jest/globals';

import {
  avaliarLimiteDoTemplate,
  progressoNoDesafio,
  podeInscrever,
  podeEditar,
  podeExcluir,
  podeCancelar,
  desfechoDaParticipacao,
  type LimiteDoTemplate,
  type JanelaDoDesafio,
} from './desafio.js';

/**
 * `assiduidade-semanal` do catalogo v1: no maximo 5 sessoes por semana, janela
 * de ate 60 dias.
 */
const LIMITE: LimiteDoTemplate = { maxSessoesPorSemana: 5, maxJanelaEmDias: 60 };

describe('avaliarLimiteDoTemplate (M5-BR-011)', () => {
  it('aceita meta dentro do teto profissional', () => {
    // 14 dias = 2 semanas; teto de 5/semana permite ate 10.
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-01',
      fim: '2026-09-14',
      meta: 10,
    });

    expect(r).toEqual({ permitido: true });
  });

  it('recusa meta que exige treino acima do teto semanal', () => {
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-01',
      fim: '2026-09-14',
      meta: 11,
    });

    expect(r).toEqual({
      permitido: false,
      motivo: 'FREQUENCIA_ACIMA_DO_LIMITE',
    });
  });

  /**
   * A armadilha que o teto POR SEMANA existe para pegar.
   *
   * Um teto "por janela" generoso (digamos 40) aprovaria meta 30 em 30 dias --
   * treino diario, sem um unico dia de descanso. Convertido para semanas,
   * 30 dias sao ~4,3 semanas: o teto e 21, e a meta cai.
   */
  it('recusa janela longa cuja meta equivale a treino diario', () => {
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-01',
      fim: '2026-09-30',
      meta: 30,
    });

    expect(r).toEqual({
      permitido: false,
      motivo: 'FREQUENCIA_ACIMA_DO_LIMITE',
    });
  });

  it('recusa janela mais longa que o template permite', () => {
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-01',
      fim: '2026-12-31',
      meta: 5,
    });

    expect(r).toEqual({ permitido: false, motivo: 'JANELA_LONGA_DEMAIS' });
  });

  it('recusa janela invertida', () => {
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-30',
      fim: '2026-09-01',
      meta: 5,
    });

    expect(r).toEqual({ permitido: false, motivo: 'JANELA_INVALIDA' });
  });

  it('recusa meta nao positiva', () => {
    const r = avaliarLimiteDoTemplate(LIMITE, {
      inicio: '2026-09-01',
      fim: '2026-09-14',
      meta: 0,
    });

    expect(r).toEqual({ permitido: false, motivo: 'META_INVALIDA' });
  });

  /**
   * Janela de um unico dia: inicio e fim iguais. Uma semana parcial ainda e
   * uma semana para efeito de teto -- e o teto de 5 vale.
   */
  it('trata janela de um dia como uma semana para o teto', () => {
    expect(
      avaliarLimiteDoTemplate(LIMITE, { inicio: '2026-09-01', fim: '2026-09-01', meta: 5 }),
    ).toEqual({ permitido: true });

    expect(
      avaliarLimiteDoTemplate(LIMITE, { inicio: '2026-09-01', fim: '2026-09-01', meta: 6 }),
    ).toEqual({ permitido: false, motivo: 'FREQUENCIA_ACIMA_DO_LIMITE' });
  });
});

describe('progressoNoDesafio', () => {
  const JANELA: JanelaDoDesafio = { inicio: '2026-09-01', fim: '2026-09-14' };

  it('conta apenas os dias dentro da janela', () => {
    const dias = ['2026-08-31', '2026-09-01', '2026-09-07', '2026-09-14', '2026-09-15'];

    expect(progressoNoDesafio(dias, JANELA)).toBe(3);
  });

  /**
   * Bordas INCLUSIVAS nos dois lados.
   *
   * A comparacao e de texto `AAAA-MM-DD`, ordenavel lexicograficamente -- nao
   * ha `Date` aqui, entao nao ha fuso a aplicar duas vezes. Excluir a borda
   * faria o treino do ultimo dia do desafio nao contar, e o aluno perderia a
   * meta pelo unico dia que mais importa.
   */
  it('inclui as duas bordas da janela', () => {
    expect(progressoNoDesafio(['2026-09-01'], JANELA)).toBe(1);
    expect(progressoNoDesafio(['2026-09-14'], JANELA)).toBe(1);
  });

  it('nao conta o mesmo dia duas vezes', () => {
    // A F24 ja deduplica por indice unico, mas a funcao nao pode DEPENDER
    // disso: quem chama pode juntar sessoes de duas unidades no mesmo dia.
    expect(progressoNoDesafio(['2026-09-02', '2026-09-02'], JANELA)).toBe(1);
  });

  it('devolve zero sem dias treinados', () => {
    expect(progressoNoDesafio([], JANELA)).toBe(0);
  });
});

describe('podeInscrever (M5-BR-001 -- OPT-IN)', () => {
  const HOJE = '2026-09-05';

  it('permite inscricao em desafio ativo dentro da janela', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-01', fim: '2026-09-14' },
        null,
        HOJE,
      ),
    ).toEqual({ permitido: true });
  });

  /**
   * A DIFERENCA DE REGIME (ADR-048, Decisao 2).
   *
   * Ausencia de participacao significa NAO INSCRITO -- o oposto de
   * `participaDoRanking()`, onde ausencia significa PARTICIPA. Este teste e o
   * canario contra alguem unificar os dois predicados.
   */
  it('sem participacao registrada, o aluno NAO esta inscrito', () => {
    const r = podeInscrever(
      { status: 'ACTIVE', inicio: '2026-09-01', fim: '2026-09-14' },
      null,
      HOJE,
    );

    // Permitido inscrever justamente PORQUE ainda nao esta inscrito.
    expect(r).toEqual({ permitido: true });
  });

  it('recusa inscricao repetida de quem ja esta inscrito', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-01', fim: '2026-09-14' },
        { status: 'JOINED' },
        HOJE,
      ),
    ).toEqual({ permitido: false, motivo: 'JA_INSCRITO' });
  });

  it('permite reinscricao de quem saiu', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-01', fim: '2026-09-14' },
        { status: 'LEFT' },
        HOJE,
      ),
    ).toEqual({ permitido: true });
  });

  it('recusa inscricao em desafio que ainda nao abriu', () => {
    expect(
      podeInscrever(
        { status: 'DRAFT', inicio: '2026-09-01', fim: '2026-09-14' },
        null,
        HOJE,
      ),
    ).toEqual({ permitido: false, motivo: 'DESAFIO_NAO_ESTA_ABERTO' });
  });

  it('recusa inscricao em desafio encerrado ou cancelado', () => {
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      expect(
        podeInscrever({ status, inicio: '2026-09-01', fim: '2026-09-14' }, null, HOJE),
      ).toEqual({ permitido: false, motivo: 'DESAFIO_NAO_ESTA_ABERTO' });
    }
  });

  /**
   * Desafio `ACTIVE` cuja janela ja passou: o encerramento ainda nao rodou.
   * Inscrever aqui criaria participante que nasce fracassado.
   */
  it('recusa inscricao depois do fim da janela, mesmo com status ACTIVE', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-01', fim: '2026-09-04' },
        null,
        HOJE,
      ),
    ).toEqual({ permitido: false, motivo: 'FORA_DA_JANELA' });
  });

  it('recusa inscricao antes do inicio da janela', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-10', fim: '2026-09-20' },
        null,
        HOJE,
      ),
    ).toEqual({ permitido: false, motivo: 'FORA_DA_JANELA' });
  });

  it('permite inscricao no ultimo dia da janela', () => {
    expect(
      podeInscrever(
        { status: 'ACTIVE', inicio: '2026-09-01', fim: HOJE },
        null,
        HOJE,
      ),
    ).toEqual({ permitido: true });
  });
});

describe('desfechoDaParticipacao', () => {
  it('conclui quando o progresso atinge a meta', () => {
    expect(desfechoDaParticipacao({ progresso: 10, meta: 10, janelaFechada: false })).toBe(
      'COMPLETED',
    );
  });

  it('conclui quando o progresso ultrapassa a meta', () => {
    expect(desfechoDaParticipacao({ progresso: 12, meta: 10, janelaFechada: false })).toBe(
      'COMPLETED',
    );
  });

  it('mantem em curso enquanto a janela nao fecha', () => {
    expect(desfechoDaParticipacao({ progresso: 4, meta: 10, janelaFechada: false })).toBe(
      'JOINED',
    );
  });

  it('falha quando a janela fecha sem a meta', () => {
    expect(desfechoDaParticipacao({ progresso: 9, meta: 10, janelaFechada: true })).toBe(
      'FAILED',
    );
  });

  /**
   * A meta batida VENCE o fechamento da janela.
   *
   * A ordem importa: avaliar `janelaFechada` primeiro marcaria como `FAILED`
   * quem bateu a meta no ultimo dia e so teve o desfecho calculado depois --
   * punindo exatamente quem cumpriu.
   */
  it('conclui quem bateu a meta, mesmo com a janela ja fechada', () => {
    expect(desfechoDaParticipacao({ progresso: 10, meta: 10, janelaFechada: true })).toBe(
      'COMPLETED',
    );
  });
});

describe('podeEditar', () => {
  it('permite editar desafio fechado sem participante', () => {
    expect(podeEditar({ status: 'DRAFT', participantes: 0 })).toEqual({ permitido: true });
  });

  /**
   * Desafio ABERTO com participante nao se edita.
   *
   * Mudar a meta de quem ja aderiu altera o compromisso DEPOIS do aceite --
   * o aluno entrou para bater 8 e acordaria tendo de bater 20. Mesmo
   * principio de `M5-BR-009`: regra que muda nao reescreve o passado.
   */
  it('recusa editar desafio com participante inscrito', () => {
    expect(podeEditar({ status: 'ACTIVE', participantes: 1 })).toEqual({
      permitido: false,
      motivo: 'TEM_PARTICIPANTE',
    });
  });

  /**
   * Aberto e VAZIO ainda se edita: ninguem assumiu compromisso nenhum, e
   * corrigir uma data errada e melhor do que obrigar a recriar.
   */
  it('permite editar desafio aberto que ninguem aderiu', () => {
    expect(podeEditar({ status: 'ACTIVE', participantes: 0 })).toEqual({ permitido: true });
  });

  it('recusa editar desafio encerrado ou cancelado, mesmo vazio', () => {
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      expect(podeEditar({ status, participantes: 0 })).toEqual({
        permitido: false,
        motivo: 'DESAFIO_ENCERRADO',
      });
    }
  });
});

describe('podeExcluir', () => {
  it('permite excluir desafio fechado sem participante', () => {
    expect(podeExcluir({ status: 'DRAFT', participantes: 0 })).toEqual({ permitido: true });
  });

  /**
   * EXCLUIR APAGA. Desafio com participante NAO se exclui: apagaria a adesao
   * e o aviso do aluno junto (`onDelete: Cascade`), e `M5-FR-014` manda
   * manter o historico. Para esse caso existe CANCELAR, que preserva tudo.
   */
  it('recusa excluir desafio com participante, mesmo em rascunho', () => {
    expect(podeExcluir({ status: 'DRAFT', participantes: 1 })).toEqual({
      permitido: false,
      motivo: 'TEM_PARTICIPANTE',
    });
  });

  it('recusa excluir desafio encerrado -- e historico', () => {
    expect(podeExcluir({ status: 'CLOSED', participantes: 0 })).toEqual({
      permitido: false,
      motivo: 'DESAFIO_ENCERRADO',
    });
  });

  it('permite excluir desafio aberto e vazio', () => {
    expect(podeExcluir({ status: 'ACTIVE', participantes: 0 })).toEqual({ permitido: true });
  });
});

describe('podeCancelar', () => {
  /**
   * CANCELAR e a saida para desafio COM participante: preserva a adesao, o
   * progresso e o aviso; so fecha a porta. E o oposto de excluir.
   */
  it('permite cancelar desafio aberto com participante', () => {
    expect(podeCancelar({ status: 'ACTIVE', participantes: 3 })).toEqual({ permitido: true });
  });

  it('permite cancelar rascunho', () => {
    expect(podeCancelar({ status: 'DRAFT', participantes: 0 })).toEqual({ permitido: true });
  });

  it('recusa cancelar o que ja terminou', () => {
    for (const status of ['CLOSED', 'CANCELLED'] as const) {
      expect(podeCancelar({ status, participantes: 0 })).toEqual({
        permitido: false,
        motivo: 'DESAFIO_ENCERRADO',
      });
    }
  });
});
