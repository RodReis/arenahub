import { describe, expect, it } from 'vitest';

import {
  formatarPercentual,
  resumirOperacao,
  situacaoDoDispositivo,
  situacaoDoEdge,
  type EntradaDoResumo,
} from './situacao';

const AGORA = new Date('2026-10-04T12:00:00.000Z');
const HA_10_S = '2026-10-04T11:59:50.000Z';
const HA_22_H = '2026-10-03T14:00:00.000Z';

describe('situação do Edge', () => {
  it('responde dentro do limite de silêncio', () => {
    expect(situacaoDoEdge({ status: 'ACTIVE', ultimoHeartbeat: HA_10_S }, AGORA)).toMatchObject({
      label: 'Respondendo',
      tom: 'positivo',
      foraDoAr: false,
    });
  });

  it('silêncio longo é sem resposta e conta como fora do ar', () => {
    expect(situacaoDoEdge({ status: 'ACTIVE', ultimoHeartbeat: HA_22_H }, AGORA)).toMatchObject({
      label: 'Sem resposta',
      tom: 'negativo',
      foraDoAr: true,
    });
  });

  it('nunca ter falado também é sem resposta', () => {
    expect(situacaoDoEdge({ status: 'ACTIVE', ultimoHeartbeat: null }, AGORA).foraDoAr).toBe(true);
  });

  /** O servidor só avalia Edge ACTIVE: vermelho sem alerta seria contradição. */
  it('Edge suspenso não é falha, mesmo mudo', () => {
    expect(situacaoDoEdge({ status: 'SUSPENDED', ultimoHeartbeat: HA_22_H }, AGORA)).toMatchObject({
      label: 'Suspenso',
      tom: 'neutro',
      foraDoAr: false,
    });
  });
});

describe('situação do dispositivo', () => {
  it('manutenção e aposentadoria têm rótulos diferentes', () => {
    const emManutencao = situacaoDoDispositivo(
      { status: 'MAINTENANCE', ultimoHeartbeat: null },
      AGORA,
    );
    const aposentado = situacaoDoDispositivo({ status: 'RETIRED', ultimoHeartbeat: null }, AGORA);

    expect(emManutencao.label).toBe('Em manutenção');
    expect(aposentado.label).toBe('Aposentado');
    expect(emManutencao.foraDoAr || aposentado.foraDoAr).toBe(false);
  });

  it('ativo e mudo conta como fora do ar', () => {
    expect(
      situacaoDoDispositivo({ status: 'ACTIVE', ultimoHeartbeat: HA_22_H }, AGORA).foraDoAr,
    ).toBe(true);
  });
});

const TRANQUILO: EntradaDoResumo = {
  criticos: 0,
  criticosReconhecidos: 0,
  demais: 0,
  criticoMaisAntigoHa: null,
  edgesForaDoAr: 0,
  dispositivosForaDoAr: 0,
  totalDeEdges: 1,
  alertasIndisponiveis: false,
};

describe('resumo da operação', () => {
  it('diz que está tudo bem só quando leu tudo e tudo está bem', () => {
    expect(resumirOperacao(TRANQUILO)).toMatchObject({
      nivel: 'ok',
      titulo: 'Nenhum problema crítico agora.',
    });
  });

  it('conta críticos no singular e no plural, com a idade do mais antigo', () => {
    const um = resumirOperacao({ ...TRANQUILO, criticos: 1, criticoMaisAntigoHa: 'há 22h' });
    const tres = resumirOperacao({ ...TRANQUILO, criticos: 3, criticoMaisAntigoHa: 'há 22h' });

    expect(um.titulo).toBe('1 problema crítico impedindo acesso agora.');
    expect(tres.titulo).toBe('3 problemas críticos impedindo acesso agora.');
    expect(tres).toMatchObject({ nivel: 'critico', apoio: 'O mais antigo, há 22h' });
  });

  it('crítico reconhecido continua crítico, mas diz que alguém já viu', () => {
    const resumo = resumirOperacao({
      ...TRANQUILO,
      criticos: 3,
      criticosReconhecidos: 1,
      criticoMaisAntigoHa: 'há 5 min',
    });

    expect(resumo.nivel).toBe('critico');
    expect(resumo.apoio).toBe('O mais antigo, há 5 min · 1 já reconhecido');
  });

  /** O defeito que este teste existe para pegar: tela calada = tela tranquila. */
  it('alerta ilegível NÃO vira "nenhum problema"', () => {
    const resumo = resumirOperacao({ ...TRANQUILO, alertasIndisponiveis: true });

    expect(resumo.nivel).toBe('indisponivel');
    expect(resumo.titulo).not.toMatch(/Nenhum problema/);
  });

  it('equipamento mudo sem alerta ainda aberto não vira "tudo bem"', () => {
    const resumo = resumirOperacao({ ...TRANQUILO, edgesForaDoAr: 1 });

    expect(resumo.nivel).toBe('atencao');
    expect(resumo.titulo).toMatch(/sem resposta/);
  });

  it('sem Edge cadastrado a catraca não decide nada', () => {
    const resumo = resumirOperacao({ ...TRANQUILO, totalDeEdges: 0 });

    expect(resumo.nivel).toBe('atencao');
    expect(resumo.apoio).toMatch(/Nenhum Edge cadastrado/);
  });

  it('alerta que não é crítico pinta atenção, não alarme', () => {
    expect(resumirOperacao({ ...TRANQUILO, demais: 2 })).toMatchObject({
      nivel: 'atencao',
      apoio: '2 alertas de atenção abertos.',
    });
  });
});

describe('percentual', () => {
  it('usa vírgula decimal', () => {
    expect(formatarPercentual(98.5)).toBe('98,5%');
    expect(formatarPercentual(100)).toBe('100%');
  });
});
