import { decidirRotacao } from './sessao-do-aluno.js';

const AGORA = new Date('2026-09-12T12:00:00Z');
const FUTURO = new Date('2026-10-12T12:00:00Z');
const PASSADO = new Date('2026-09-11T12:00:00Z');

const base = { status: 'ACTIVE' as const, expiresAt: FUTURO, familyId: 'fam-1' };

describe('decidirRotacao', () => {
  it('rotaciona a sessao ativa e dentro da validade', () => {
    expect(decidirRotacao(base, AGORA)).toEqual({ acao: 'ROTACIONAR' });
  });

  it('REVOGA A FAMILIA quando o refresh ja foi rotacionado -- e replay', () => {
    // Um elo ja rotacionado so volta se alguem guardou uma copia. Revogar a
    // familia inteira e a resposta certa porque nao da para saber qual das
    // duas partes e o dono: a que tem o token atual pode ser o atacante.
    expect(decidirRotacao({ ...base, status: 'ROTATED' }, AGORA)).toEqual({
      acao: 'REVOGAR_FAMILIA',
      motivo: 'REFRESH_REPLAY',
    });
  });

  it('recusa sessao ja revogada, sem revogar de novo', () => {
    expect(decidirRotacao({ ...base, status: 'REVOKED' }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_REVOGADA',
    });
  });

  it('recusa sessao expirada', () => {
    expect(decidirRotacao({ ...base, expiresAt: PASSADO }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_EXPIRADA',
    });
  });

  it('replay em sessao EXPIRADA ainda revoga a familia', () => {
    // O ataque nao deixa de ser ataque porque o token venceu. Se a expiracao
    // fosse checada primeiro, um replay tardio sairia como recusa comum --
    // sem revogar a familia e sem deixar rastro de que houve copia.
    expect(decidirRotacao({ ...base, status: 'ROTATED', expiresAt: PASSADO }, AGORA)).toEqual({
      acao: 'REVOGAR_FAMILIA',
      motivo: 'REFRESH_REPLAY',
    });
  });

  it('trata o instante EXATO da expiracao como expirado', () => {
    expect(decidirRotacao({ ...base, expiresAt: AGORA }, AGORA)).toEqual({
      acao: 'RECUSAR',
      motivo: 'SESSAO_EXPIRADA',
    });
  });
});
