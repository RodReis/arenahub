import { describe, expect, it } from 'vitest';

import {
  ROTULO_DE_ENTITLEMENT,
  ROTULO_DE_EVENTO,
  ROTULO_DE_ORIGEM,
  ROTULO_DE_SITUACAO,
  diaDaSemana,
  horaDoMinuto,
  impedeAcesso,
  janelaLegivel,
  situacoesPossiveis,
  vigenteAgora,
} from './formatar';

// Instante fixo: o "agora" entra por parâmetro justamente para o teste não
// depender do relógio de quem roda.
const AGORA = new Date('2026-08-16T12:00:00.000Z');

describe('situação do aluno', () => {
  it('traduz as sete situações', () => {
    for (const situacao of [
      'LEAD',
      'TRIAL',
      'ACTIVE',
      'SUSPENDED',
      'BLOCKED',
      'CANCELLED',
      'ARCHIVED',
    ]) {
      expect(ROTULO_DE_SITUACAO[situacao]).toBeTruthy();
    }
  });

  it('SUSPENDED não impede acesso -- INV-033 lista só BLOCKED, CANCELLED e ARCHIVED', () => {
    // O erro que este teste impede: tratar "suspenso" como "sem acesso" faria
    // a recepção liberar manualmente quem já entra sozinho.
    expect(impedeAcesso('SUSPENDED')).toBe(false);
    expect(impedeAcesso('ACTIVE')).toBe(false);
    expect(impedeAcesso('TRIAL')).toBe(false);
    expect(impedeAcesso('LEAD')).toBe(false);
  });

  it('BLOCKED, CANCELLED e ARCHIVED impedem acesso', () => {
    expect(impedeAcesso('BLOCKED')).toBe(true);
    expect(impedeAcesso('CANCELLED')).toBe(true);
    expect(impedeAcesso('ARCHIVED')).toBe(true);
  });
});

describe('transições de situação', () => {
  it('ARCHIVED é terminal -- nenhuma saída', () => {
    expect(situacoesPossiveis('ARCHIVED')).toHaveLength(0);
  });

  it('não oferece a própria situação como destino', () => {
    // Um select que oferece "Ativo" para quem já está ativo produz um 409
    // depois do clique, sem o operador entender o que fez de errado.
    for (const situacao of Object.keys(ROTULO_DE_SITUACAO)) {
      expect(situacoesPossiveis(situacao)).not.toContain(situacao);
    }
  });

  it('só oferece destinos que existem como situação', () => {
    for (const situacao of Object.keys(ROTULO_DE_SITUACAO)) {
      for (const destino of situacoesPossiveis(situacao)) {
        expect(ROTULO_DE_SITUACAO[destino]).toBeTruthy();
      }
    }
  });

  it('situação desconhecida não quebra a tela', () => {
    expect(situacoesPossiveis('SITUACAO_QUE_NAO_EXISTE')).toHaveLength(0);
  });

  it('espelha TRANSICOES_DE_ALUNO do domínio, transição por transição', () => {
    // Cópia literal de `apps/api/src/modules/students/domain/student.ts:49`.
    //
    // A tabela vive lá porque é regra de domínio; aqui ela existe só para o
    // select não oferecer o que a API recusa. Duas cópias divergem na primeira
    // mudança -- este teste é o que transforma a divergência em falha de CI em
    // vez de um 409 na cara da recepção.
    //
    // Já divergiu uma vez: TRIAL→BLOCKED e BLOCKED→SUSPENDED foram escritos
    // aqui sem existir no domínio, e o e2e pegou.
    const DOMINIO: Record<string, string[]> = {
      LEAD: ['TRIAL', 'ACTIVE', 'CANCELLED', 'ARCHIVED'],
      TRIAL: ['ACTIVE', 'CANCELLED', 'ARCHIVED'],
      ACTIVE: ['SUSPENDED', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
      SUSPENDED: ['ACTIVE', 'BLOCKED', 'CANCELLED', 'ARCHIVED'],
      BLOCKED: ['ACTIVE', 'CANCELLED', 'ARCHIVED'],
      CANCELLED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: [],
    };

    for (const [origem, destinos] of Object.entries(DOMINIO)) {
      expect([...situacoesPossiveis(origem)].sort()).toEqual([...destinos].sort());
    }
  });
});

describe('janela de acesso', () => {
  it('converte minuto do dia em hora', () => {
    expect(horaDoMinuto(0)).toBe('00:00');
    expect(horaDoMinuto(360)).toBe('06:00');
    expect(horaDoMinuto(1080)).toBe('18:00');
    expect(horaDoMinuto(1319)).toBe('21:59');
  });

  it('1440 é fim do dia, não meia-noite -- janela até 24:00 comunica duração', () => {
    // `00:00` no fim da janela pareceria duração zero.
    expect(horaDoMinuto(1440)).toBe('24:00');
  });

  it('minuto fora da faixa vira traço, não NaN na tela', () => {
    expect(horaDoMinuto(-1)).toBe('—');
    expect(horaDoMinuto(1441)).toBe('—');
    expect(horaDoMinuto(12.5)).toBe('—');
  });

  it('dayOfWeek é ISO -- 1 é segunda, 7 é domingo', () => {
    expect(diaDaSemana(1)).toBe('Segunda');
    expect(diaDaSemana(7)).toBe('Domingo');
  });

  it('dia fora da faixa vira traço', () => {
    expect(diaDaSemana(0)).toBe('—');
    expect(diaDaSemana(8)).toBe('—');
  });

  it('monta a janela numa linha só', () => {
    expect(janelaLegivel({ dayOfWeek: 1, startMinute: 360, endMinute: 1320 })).toBe(
      'Segunda, 06:00–22:00',
    );
  });
});

describe('vigência do direito de acesso', () => {
  const base = {
    status: 'ACTIVE',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: '2026-09-01T00:00:00.000Z',
  };

  it('ativo e dentro do intervalo está vigente', () => {
    expect(vigenteAgora(base, AGORA)).toBe(true);
  });

  it('ativo mas ainda não começou não está vigente', () => {
    expect(
      vigenteAgora({ ...base, startsAt: '2026-09-01T00:00:00.000Z' }, AGORA),
    ).toBe(false);
  });

  it('ativo mas já terminou não está vigente', () => {
    expect(vigenteAgora({ ...base, endsAt: '2026-08-01T00:00:00.000Z' }, AGORA)).toBe(false);
  });

  it('suspenso não está vigente mesmo dentro do intervalo', () => {
    // O intervalo continua o mesmo; o que mudou foi o estado. Sem esta
    // verificação a ficha diria "vale agora" para um direito suspenso.
    expect(vigenteAgora({ ...base, status: 'SUSPENDED' }, AGORA)).toBe(false);
  });

  it('agendado, revogado e expirado não estão vigentes', () => {
    for (const status of ['SCHEDULED', 'REVOKED', 'EXPIRED']) {
      expect(vigenteAgora({ ...base, status }, AGORA)).toBe(false);
    }
  });

  it('data inválida não vira vigente por acidente', () => {
    expect(vigenteAgora({ ...base, startsAt: 'não é data' }, AGORA)).toBe(false);
    expect(vigenteAgora({ ...base, endsAt: '' }, AGORA)).toBe(false);
  });
});

describe('dicionários', () => {
  it('cobre os cinco estados de entitlement', () => {
    for (const status of ['SCHEDULED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED']) {
      expect(ROTULO_DE_ENTITLEMENT[status]).toBeTruthy();
    }
  });

  it('cobre as nove origens -- o enum é extensível (ADR-009)', () => {
    for (const origem of [
      'SUBSCRIPTION',
      'COURTESY',
      'EMPLOYEE',
      'PERSONAL_TRAINER',
      'VISITOR',
      'TRIAL_CLASS',
      'DEPENDENT',
      'PARTNER',
      'CORPORATE',
    ]) {
      expect(ROTULO_DE_ORIGEM[origem]).toBeTruthy();
    }
  });

  it('cobre os vinte tipos de evento da timeline', () => {
    expect(Object.keys(ROTULO_DE_EVENTO)).toHaveLength(20);
  });
});
