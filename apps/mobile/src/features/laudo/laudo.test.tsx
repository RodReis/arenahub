import { render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { escalaDaFaixa, Laudo, type DadosDoLaudo, type RegiaoDoLaudo } from './laudo.js';

const regiaoVazia: RegiaoDoLaudo = { gorduraKg: null, musculoKg: null, leituraGordura: 'UNKNOWN', leituraMusculo: 'UNKNOWN' };

const base: DadosDoLaudo = {
  asOf: '2026-09-12T12:00:00.000Z',
  avaliacao: {
    data: '2026-08-03',
    metricas: [
      { tipo: 'WEIGHT', valor: 92.25, unidade: 'kg', leitura: 'ABOVE', faixaMin: 60.6, faixaMax: 82 },
      { tipo: 'BODY_FAT_PERCENT', valor: 24.4, unidade: 'percent', leitura: 'WITHIN', faixaMin: 10, faixaMax: 25 },
      { tipo: 'VISCERAL_FAT_LEVEL', valor: 9, unidade: null, leitura: 'UNKNOWN', faixaMin: null, faixaMax: null },
    ],
    regioes: {
      ARM_LEFT: { gorduraKg: 1.3, musculoKg: 3.8, leituraGordura: 'WITHIN', leituraMusculo: 'WITHIN' },
      ARM_RIGHT: regiaoVazia,
      TRUNK: regiaoVazia,
      LEG_LEFT: regiaoVazia,
      LEG_RIGHT: regiaoVazia,
    },
  },
};

const renderizar = (dados: DadosDoLaudo = base) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Laudo dados={dados} onVoltar={() => undefined} />
    </ProvedorDeTema>,
  );

describe('escalaDaFaixa', () => {
  it('a faixa fica no meio com folga, e o valor fora dela continua visivel', () => {
    const escala = escalaDaFaixa(92.25, 60.6, 82);
    expect(escala.zonaInicio).toBeGreaterThan(0);
    expect(escala.zonaInicio + escala.zonaLargura).toBeLessThan(1);
    expect(escala.marcador).toBeGreaterThan(escala.zonaInicio + escala.zonaLargura);
    expect(escala.marcador).toBeLessThanOrEqual(1);
  });

  it('faixa de largura zero nao divide por zero', () => {
    const escala = escalaDaFaixa(5, 5, 5);
    expect(Number.isFinite(escala.marcador)).toBe(true);
  });
});

describe('Laudo', () => {
  it('usa a LEITURA do servidor, com texto neutro -- nunca "excelente"', () => {
    renderizar();
    expect(screen.getByTestId('laudo-faixa-WEIGHT')).toHaveTextContent(/Acima da faixa/);
    expect(screen.getByTestId('laudo-faixa-BODY_FAT_PERCENT')).toHaveTextContent(/Na faixa/);
    expect(screen.queryByText(/excelente|bom|ruim/i)).toBeNull();
  });

  it('mostra a faixa de referencia do fabricante com a unidade', () => {
    renderizar();
    expect(screen.getByText('faixa de referência 60,6 – 82,0 kg')).toBeTruthy();
  });

  it('medida sem faixa diz que nao ha faixa, sem desenhar zona inventada', () => {
    renderizar();
    expect(screen.getByTestId('laudo-faixa-VISCERAL_FAT_LEVEL')).toHaveTextContent(/sem faixa de referência/);
  });

  it('regiao sem medida aparece como ausencia, nunca como 0 kg', () => {
    renderizar();
    expect(screen.getByTestId('laudo-regiao-TRUNK')).toHaveTextContent(/—/);
    expect(screen.queryByText('0 kg')).toBeNull();
  });

  it('declara que nao e diagnostico medico', () => {
    renderizar();
    expect(screen.getByText(/não é diagnóstico médico/)).toBeTruthy();
  });

  it('sem avaliacao publicada mostra o vazio', () => {
    renderizar({ asOf: base.asOf, avaliacao: null });
    expect(screen.getByTestId('laudo-vazio')).toBeTruthy();
  });
});
