import { describe, expect, it } from '@jest/globals';

import {
  CONFIG_PADRAO_DO_TOTEM,
  MAXIMO_DE_PATROCINADORES,
  ROTULO_PADRAO_DE_PATROCINIO,
  blocoDaTelaPublicaSchema,
  blocosEmRodizio,
  indicadoresDaUnidadeSchema,
  kioskConfigSchema,
  resolverConfig,
  rotuloDePatrocinio,
} from './kiosk-config.js';

describe('resolverConfig -- tres camadas, a mais especifica vence', () => {
  it('devolve o padrao quando nenhuma camada existe', () => {
    expect(resolverConfig({})).toEqual(CONFIG_PADRAO_DO_TOTEM);
  });

  it('a unidade sobrescreve o tenant', () => {
    const resultado = resolverConfig({
      tenant: { sessao: { duracaoSegundos: 45 } },
      unidade: { sessao: { duracaoSegundos: 90 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(90);
  });

  it('o dispositivo sobrescreve a unidade', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 90 } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('campo ausente na camada especifica NAO apaga o da camada de baixo', () => {
    const resultado = resolverConfig({
      unidade: { marca: { nomeDaAcademia: 'Arena Centro' } },
      dispositivo: { sessao: { duracaoSegundos: 120 } },
    });

    // O dispositivo falou so de sessao -- a marca da unidade sobrevive.
    expect(resultado.marca.nomeDaAcademia).toBe('Arena Centro');
    expect(resultado.sessao.duracaoSegundos).toBe(120);
  });

  it('camada invalida e IGNORADA, nao derruba a resolucao', () => {
    const resultado = resolverConfig({
      unidade: { sessao: { duracaoSegundos: 'noventa' } },
    });

    expect(resultado.sessao.duracaoSegundos).toBe(
      CONFIG_PADRAO_DO_TOTEM.sessao.duracaoSegundos,
    );
  });

  it('nenhum modulo vem habilitado na F49', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.modulos).toEqual({
      pagamento: false,
      historicoDePagamentos: false,
      avaliacao: false,
      evolucao: false,
      historicoDeAvaliacoes: false,
      ranking: false,
      xp: false,
      // F34: nasce desligado como todos os outros (`M5-BR-001`).
      desafios: false,
    });
  });

  it('o unico metodo de identificacao habilitado e o CPF', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.identificacao).toEqual({
      cpf: true,
      facial: false,
      qrCodeDoApp: false,
    });
  });
});

describe('blocos da tela publica (F51)', () => {
  const blocoVideo = {
    id: 'b1',
    habilitado: true,
    tipo: 'VIDEO' as const,
    titulo: 'Quem forma a nossa equipe',
    legenda: 'Conheca os professores.',
    midiaKey: 'tenants/t/kiosk-media/u/abc.mp4',
    linkExterno: null,
  };

  const blocoEventos = {
    id: 'b2',
    habilitado: false,
    tipo: 'EVENTOS' as const,
    titulo: 'Proximos eventos',
    itens: [{ data: '2026-08-30', titulo: 'Aulao de Spinning', informacao: '19h' }],
  };

  it('nenhum bloco vem habilitado no padrao -- a tela nasce so com hero e CTA', () => {
    expect(CONFIG_PADRAO_DO_TOTEM.blocos.itens).toEqual([]);
    expect(blocosEmRodizio(CONFIG_PADRAO_DO_TOTEM)).toEqual([]);
  });

  it('o rodizio leva SO os habilitados, na ordem do array', () => {
    const config = {
      ...CONFIG_PADRAO_DO_TOTEM,
      blocos: {
        tempoPorBlocoSegundos: 12 as const,
        itens: [blocoEventos, blocoVideo],
      },
    };

    expect(blocosEmRodizio(config).map((b) => b.id)).toEqual(['b1']);
  });

  it('a ORDEM do array e a ordem do rodizio -- inverter o array inverte a tela', () => {
    const dois = [blocoVideo, { ...blocoEventos, habilitado: true }];

    const emOrdem = blocosEmRodizio({
      ...CONFIG_PADRAO_DO_TOTEM,
      blocos: { tempoPorBlocoSegundos: 12, itens: dois },
    });
    const invertido = blocosEmRodizio({
      ...CONFIG_PADRAO_DO_TOTEM,
      blocos: { tempoPorBlocoSegundos: 12, itens: [...dois].reverse() },
    });

    expect(emOrdem.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(invertido.map((b) => b.id)).toEqual(['b2', 'b1']);
  });

  it('camada de dispositivo SUBSTITUI a lista de blocos, nunca concatena', () => {
    const resultado = resolverConfig({
      unidade: { blocos: { tempoPorBlocoSegundos: 8, itens: [blocoVideo] } },
      dispositivo: { blocos: { itens: [blocoEventos] } },
    });

    // Concatenar produziria ordem de rodizio que ninguem definiu.
    expect(resultado.blocos.itens.map((b) => b.id)).toEqual(['b2']);
    // ...e o tempo da unidade sobrevive: o dispositivo so falou de `itens`.
    expect(resultado.blocos.tempoPorBlocoSegundos).toBe(8);
  });

  it('bloco de tipo desconhecido invalida a camada, que e ignorada', () => {
    const resultado = resolverConfig({
      unidade: {
        blocos: { itens: [{ id: 'x', habilitado: true, tipo: 'RANKING' }] },
      },
    });

    expect(resultado.blocos.itens).toEqual([]);
  });

  it('video exige legenda -- DS-TOTEM §4 pede video sem som E com legenda', () => {
    const semLegenda = { ...blocoVideo, legenda: '' };

    expect(blocoDaTelaPublicaSchema.safeParse(semLegenda).success).toBe(false);
  });
});

describe('faixa de patrocinadores (ADR-042, Decisao 4)', () => {
  it('rotulo vazio cai no padrao, nunca em nada', () => {
    expect(rotuloDePatrocinio('')).toBe(ROTULO_PADRAO_DE_PATROCINIO);
    expect(rotuloDePatrocinio('   ')).toBe(ROTULO_PADRAO_DE_PATROCINIO);
  });

  it('rotulo configurado vence o padrao', () => {
    expect(rotuloDePatrocinio(' Apoio ')).toBe('Apoio');
  });

  it('aceita ate 6 marcas e recusa a setima', () => {
    const marca = { nome: 'Marca', logotipoUrl: null };
    const comSeis = Array.from({ length: MAXIMO_DE_PATROCINADORES }, () => marca);

    const seis = kioskConfigSchema.shape.patrocinio.safeParse({
      habilitado: true,
      rotulo: '',
      marcas: comSeis,
    });
    const sete = kioskConfigSchema.shape.patrocinio.safeParse({
      habilitado: true,
      rotulo: '',
      marcas: [...comSeis, marca],
    });

    expect(seis.success).toBe(true);
    expect(sete.success).toBe(false);
  });

  it('NAO existe campo de contagem, clique ou periodo no contrato', () => {
    // A ausencia deles E a trava: o `parse` DESCARTA campo estranho, entao
    // um contador enviado pelo painel nao chega ao banco (`M3.5-BR-006`).
    const parsed = kioskConfigSchema.shape.patrocinio.parse({
      habilitado: true,
      rotulo: 'Apoio',
      marcas: [{ nome: 'Marca', logotipoUrl: null }],
      impressoes: 42,
      urlDeDestino: 'https://exemplo.com',
      veiculaAte: '2026-12-31',
    });

    expect(parsed).not.toHaveProperty('impressoes');
    expect(parsed).not.toHaveProperty('urlDeDestino');
    expect(parsed).not.toHaveProperty('veiculaAte');
  });
});

describe('indicadores da unidade -- M3.5-BR-001', () => {
  it('aceita dois inteiros nao negativos e o placar', () => {
    const parsed = indicadoresDaUnidadeSchema.parse({
      checkinsDeHoje: 312,
      treinandoAgora: 47,
      placar: [{ position: 1, nomeExibido: 'Ana', points: 50 }],
      desafio: null,
    });

    expect(parsed).toEqual({
      checkinsDeHoje: 312,
      treinandoAgora: 47,
      placar: [{ position: 1, nomeExibido: 'Ana', points: 50 }],
      desafio: null,
    });
  });

  it('placar vazio e aceito -- modulo desligado ou placar retido', () => {
    const parsed = indicadoresDaUnidadeSchema.parse({
      checkinsDeHoje: 0,
      treinandoAgora: 0,
      placar: [],
      desafio: null,
    });

    expect(parsed.placar).toEqual([]);
  });

  it('DESCARTA qualquer dado de aluno que venha junto', () => {
    const parsed = indicadoresDaUnidadeSchema.parse({
      checkinsDeHoje: 1,
      treinandoAgora: 1,
      placar: [],
      desafio: null,
      alunos: [{ nome: 'Fulano de Tal', studentId: 'uuid' }],
    });

    expect(parsed).not.toHaveProperty('alunos');
  });

  it('DESCARTA studentId dentro de uma entrada do placar', () => {
    const parsed = indicadoresDaUnidadeSchema.parse({
      checkinsDeHoje: 1,
      treinandoAgora: 1,
      placar: [{ position: 1, nomeExibido: 'Ana', points: 50, studentId: 'uuid-vazado' }],
      desafio: null,
    });

    expect(parsed.placar[0]).not.toHaveProperty('studentId');
  });

  it('recusa contagem negativa e fracionaria', () => {
    expect(
      indicadoresDaUnidadeSchema.safeParse({ checkinsDeHoje: -1, treinandoAgora: 0, placar: [], desafio: null })
        .success,
    ).toBe(false);
    expect(
      indicadoresDaUnidadeSchema.safeParse({ checkinsDeHoje: 1.5, treinandoAgora: 0, placar: [] })
        .success,
    ).toBe(false);
  });
});

describe('desafio na tela publica -- M3.5-BR-001 (F34, ADR-048 emenda 2)', () => {
  it('aceita o desafio em cartaz', () => {
    const r = indicadoresDaUnidadeSchema.safeParse({
      checkinsDeHoje: 0,
      treinandoAgora: 0,
      placar: [],
      desafio: { titulo: 'Setembro Ativo', meta: 8, diasRestantes: 5 },
    });

    expect(r.success).toBe(true);
  });

  it('aceita `null` -- nenhum desafio aberto, e o bloco sai do carrossel', () => {
    const r = indicadoresDaUnidadeSchema.safeParse({
      checkinsDeHoje: 0,
      treinandoAgora: 0,
      placar: [],
      desafio: null,
    });

    expect(r.success).toBe(true);
  });

  /**
   * DADO DE ALUNO NAO VAI PARA A PAREDE.
   *
   * O schema e `.strict()`-equivalente por construcao: campo extra e
   * DESCARTADO, nunca repassado. Este teste prova que um `studentId` que
   * escape do servidor nao chega a tela -- mesma guarda que
   * `entradaPublicaDoPlacarSchema` ja tem.
   */
  it('descarta campo estranho no desafio, inclusive identificador de aluno', () => {
    const r = indicadoresDaUnidadeSchema.parse({
      checkinsDeHoje: 0,
      treinandoAgora: 0,
      placar: [],
      desafio: {
        titulo: 'Setembro Ativo',
        meta: 8,
        diasRestantes: 5,
        studentId: 'uuid-vazado',
        inscritos: 293,
      },
    });

    expect(r.desafio).toEqual({ titulo: 'Setembro Ativo', meta: 8, diasRestantes: 5 });
  });

  it('recusa dias restantes negativo -- desafio vencido nao vai para a parede', () => {
    const r = indicadoresDaUnidadeSchema.safeParse({
      checkinsDeHoje: 0,
      treinandoAgora: 0,
      placar: [],
      desafio: { titulo: 'Vencido', meta: 8, diasRestantes: -1 },
    });

    expect(r.success).toBe(false);
  });
});
