import { describe, expect, it } from '@jest/globals';

import {
  SinalVitalInvalidoError,
  TIPOS_DE_SINAL_VITAL,
  UNIDADE_DO_SINAL,
  ehTipoDeSinalVital,
  validarSinalVital,
} from './sinal-vital.js';

describe('sinal-vital -- validacao de faixa (card #345)', () => {
  describe('BLOOD_PRESSURE', () => {
    it('aceita sistolica e diastolica plausiveis', () => {
      const validado = validarSinalVital({
        type: 'BLOOD_PRESSURE',
        value: 120,
        secondaryValue: 80,
      });

      expect(validado.value).toBe(120);
      expect(validado.secondaryValue).toBe(80);
      expect(validado.unit).toBe(UNIDADE_DO_SINAL.BLOOD_PRESSURE);
    });

    it('recusa sem diastolica -- pressao sem o segundo numero e leitura incompleta', () => {
      expect(() => validarSinalVital({ type: 'BLOOD_PRESSURE', value: 120 })).toThrow(
        SinalVitalInvalidoError,
      );
    });

    it('recusa diastolica maior ou igual a sistolica', () => {
      expect(() =>
        validarSinalVital({ type: 'BLOOD_PRESSURE', value: 80, secondaryValue: 80 }),
      ).toThrow(SinalVitalInvalidoError);
    });

    it('recusa sistolica fora da faixa fisicamente plausivel', () => {
      expect(() =>
        validarSinalVital({ type: 'BLOOD_PRESSURE', value: 999, secondaryValue: 80 }),
      ).toThrow(SinalVitalInvalidoError);
    });

    it('recusa diastolica fora da faixa fisicamente plausivel', () => {
      expect(() =>
        validarSinalVital({ type: 'BLOOD_PRESSURE', value: 120, secondaryValue: 999 }),
      ).toThrow(SinalVitalInvalidoError);
    });
  });

  describe('OXYGEN_SATURATION', () => {
    it('aceita valor plausivel, sem diastolica', () => {
      const validado = validarSinalVital({ type: 'OXYGEN_SATURATION', value: 97 });

      expect(validado.value).toBe(97);
      expect(validado.secondaryValue).toBeNull();
      expect(validado.unit).toBe('%');
    });

    it('recusa secondaryValue -- tipo unario nao aceita segundo numero', () => {
      expect(() =>
        validarSinalVital({ type: 'OXYGEN_SATURATION', value: 97, secondaryValue: 1 }),
      ).toThrow(SinalVitalInvalidoError);
    });

    it('recusa valor fora da faixa (acima de 100%)', () => {
      expect(() => validarSinalVital({ type: 'OXYGEN_SATURATION', value: 150 })).toThrow(
        SinalVitalInvalidoError,
      );
    });
  });

  describe('RESTING_HEART_RATE', () => {
    it('aceita valor plausivel', () => {
      const validado = validarSinalVital({ type: 'RESTING_HEART_RATE', value: 60 });

      expect(validado.value).toBe(60);
      expect(validado.unit).toBe('bpm');
    });

    it('recusa valor fora da faixa fisicamente plausivel', () => {
      expect(() => validarSinalVital({ type: 'RESTING_HEART_RATE', value: 400 })).toThrow(
        SinalVitalInvalidoError,
      );
    });
  });

  describe('ehTipoDeSinalVital', () => {
    it('reconhece os tres tipos fechados', () => {
      for (const tipo of TIPOS_DE_SINAL_VITAL) {
        expect(ehTipoDeSinalVital(tipo)).toBe(true);
      }
    });

    it('recusa tipo fora da lista fechada', () => {
      expect(ehTipoDeSinalVital('DIAGNOSIS')).toBe(false);
    });
  });
});
