import { describe, expect, it } from '@jest/globals';

import {
  ATRASO_PADRAO_EM_HORAS,
  avaliarSaudeDoPipeline,
} from './saude-do-pipeline.js';

const agora = new Date('2026-09-10T12:00:00.000Z');

describe('avaliarSaudeDoPipeline', () => {
  it('esta SAUDAVEL quando rodou hoje de madrugada', () => {
    const saude = avaliarSaudeDoPipeline(
      { ultimoSnapshotEm: new Date('2026-09-10T04:00:00.000Z'), scoringLigado: true },
      agora,
    );

    expect(saude).toMatchObject({ estado: 'SAUDAVEL', horasSemRodar: 8 });
  });

  it('acusa ATRASADO ao passar do limite', () => {
    const saude = avaliarSaudeDoPipeline(
      { ultimoSnapshotEm: new Date('2026-09-08T04:00:00.000Z'), scoringLigado: true },
      agora,
    );

    expect(saude.estado).toBe('ATRASADO');
    expect(saude.horasSemRodar).toBe(56);
  });

  it('trata a borda como saudavel', () => {
    const naBorda = new Date(agora.getTime() - ATRASO_PADRAO_EM_HORAS * 3_600_000);

    expect(
      avaliarSaudeDoPipeline({ ultimoSnapshotEm: naBorda, scoringLigado: true }, agora).estado,
    ).toBe('SAUDAVEL');
  });

  it('nao acusa atraso quando o scoring esta DESLIGADO', () => {
    // Kill switch acionado é decisão, não falha. Alarmar aqui treinaria a
    // operação a ignorar o alarme justamente quando ele importa.
    const saude = avaliarSaudeDoPipeline(
      { ultimoSnapshotEm: new Date('2026-08-01T04:00:00.000Z'), scoringLigado: false },
      agora,
    );

    expect(saude.estado).toBe('DESLIGADO');
  });

  it('acusa NUNCA_RODOU quando nao ha snapshot nenhum', () => {
    // O estado real do banco de desenvolvimento em 31/08/2026, e o que a
    // medição da F40 encontrou: o pipeline existe e nunca executou.
    const saude = avaliarSaudeDoPipeline({ ultimoSnapshotEm: null, scoringLigado: true }, agora);

    expect(saude).toMatchObject({ estado: 'NUNCA_RODOU', horasSemRodar: null });
  });

  it('desligado sem nunca ter rodado continua DESLIGADO', () => {
    expect(
      avaliarSaudeDoPipeline({ ultimoSnapshotEm: null, scoringLigado: false }, agora).estado,
    ).toBe('DESLIGADO');
  });

  it('trata relogio para tras como zero, nao como idade negativa', () => {
    const futuro = new Date('2026-09-11T00:00:00.000Z');

    expect(
      avaliarSaudeDoPipeline({ ultimoSnapshotEm: futuro, scoringLigado: true }, agora),
    ).toMatchObject({ estado: 'SAUDAVEL', horasSemRodar: 0 });
  });

  it('aceita limite configurado', () => {
    const saude = avaliarSaudeDoPipeline(
      { ultimoSnapshotEm: new Date('2026-09-10T04:00:00.000Z'), scoringLigado: true },
      agora,
      4,
    );

    expect(saude.estado).toBe('ATRASADO');
  });

  it('tem 36 horas como limite padrao', () => {
    // Uma rodada diária mais meio dia de folga: pega o job que não rodou hoje
    // sem alarmar por atraso de duas horas na madrugada.
    expect(ATRASO_PADRAO_EM_HORAS).toBe(36);
  });
});
