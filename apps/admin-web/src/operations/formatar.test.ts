import { describe, expect, it } from 'vitest';

import {
  ROTULO_DE_MODO,
  ROTULO_DE_SEVERIDADE,
  estaSilencioso,
  idadeLegivel,
  traduzir,
} from './formatar';

const AGORA = new Date('2026-08-16T12:00:00.000Z');

describe('idade legível', () => {
  it('mostra segundos no primeiro minuto', () => {
    expect(idadeLegivel('2026-08-16T11:59:30.000Z', AGORA)).toBe('há 30s');
  });

  it('vira minutos depois de 60s', () => {
    expect(idadeLegivel('2026-08-16T11:55:00.000Z', AGORA)).toBe('há 5 min');
  });

  it('vira horas depois de 60 min', () => {
    expect(idadeLegivel('2026-08-16T09:00:00.000Z', AGORA)).toBe('há 3h');
  });

  it('vira dias depois de 24h', () => {
    expect(idadeLegivel('2026-08-14T12:00:00.000Z', AGORA)).toBe('há 2d');
  });

  it('diz "nunca" quando não há instante', () => {
    // Diferente de "há muito tempo": um Edge que nunca bateu é caso novo de
    // instalação, não equipamento que caiu.
    expect(idadeLegivel(null, AGORA)).toBe('nunca');
  });

  it('não mostra idade negativa quando o relógio do navegador está adiantado', () => {
    // "há -3 segundos" pareceria defeito da tela, não do relógio da máquina.
    expect(idadeLegivel('2026-08-16T12:00:05.000Z', AGORA)).toBe('agora');
  });

  it('não quebra com instante inválido', () => {
    expect(idadeLegivel('não-é-data', AGORA)).toBe('—');
  });
});

describe('silêncio', () => {
  it('considera saudável dentro de 90s', () => {
    expect(estaSilencioso('2026-08-16T11:59:00.000Z', AGORA)).toBe(false);
  });

  it('considera silencioso acima de 90s', () => {
    expect(estaSilencioso('2026-08-16T11:58:00.000Z', AGORA)).toBe(true);
  });

  it('trata ausência de heartbeat como silêncio', () => {
    expect(estaSilencioso(null, AGORA)).toBe(true);
  });

  it('trata instante inválido como silêncio -- na dúvida, alerta', () => {
    expect(estaSilencioso('lixo', AGORA)).toBe(true);
  });
});

/*
 * Os testes de `ROTULO_DE_RAZAO` e `ROTULO_DE_PASSAGEM` MUDARAM DE CASA junto
 * com os dicionarios, para `packages/ui/src/domain/state-labels.spec.ts`. La
 * eles ficaram mais fortes: a cobertura das razoes deixou de ser uma lista
 * escrita a mao e passa a percorrer `ALLOW_REASON`/`DENY_REASON` de
 * `@arenahub/access-policy`, entao um codigo novo no motor falha o teste em vez
 * de chegar a tela como badge vazio.
 *
 * UMA diferenca de comportamento veio junto, e e deliberada: `traduzir()` caia
 * para o codigo cru (`PAYMENT_OVERDUE` aparecia assim na tela) e `stateLabel`
 * devolve `undefined`, que o `StateBadge` renderiza como `—`. A troca e a
 * decisao do §7: codigo em ingles na tela vaza dominio para o usuario.
 */
describe('dicionários', () => {
  it('traduz severidade', () => {
    expect(ROTULO_DE_SEVERIDADE['CRITICAL']).toBe('Crítico');
  });

  it('cai para o próprio código quando não conhece', () => {
    // Vale para os dicionarios que FICARAM (modo, metodo, severidade): valor
    // novo do servidor aparece feio mas correto.
    expect(traduzir(ROTULO_DE_MODO, 'DESCONHECIDO')).toBe('DESCONHECIDO');
  });
});
