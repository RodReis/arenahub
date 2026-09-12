import { fireEvent, render, screen } from '@testing-library/react-native';

import { ProvedorDeTema } from '../../ui/theme.js';
import { Consentimentos, type DadosDosConsentimentos } from './consentimentos.js';

const base: DadosDosConsentimentos = {
  asOf: '2026-09-12T12:00:00.000Z',
  consentimentos: [
    {
      tipo: 'HEALTH',
      concedido: true,
      motivo: null,
      decididoEm: '2026-09-01T12:00:00.000Z',
      finalidade: 'Registrar avaliações físicas',
      versao: 1,
      editavel: true,
    },
  ],
};

/** `accessibilityState.disabled` do switch, tipado -- a prop do RN e `any`. */
function desabilitadoDoSwitch(testID: string): boolean {
  const props = screen.getByTestId(testID).props as {
    accessibilityState?: { disabled?: boolean };
  };

  return props.accessibilityState?.disabled === true;
}

const renderizar = (
  dados: Partial<DadosDosConsentimentos> = {},
  onMudar: (tipo: string, conceder: boolean) => void = () => undefined,
  salvando: string | null = null,
) =>
  render(
    <ProvedorDeTema forcarTema="dark">
      <Consentimentos
        dados={{ ...base, ...dados }}
        onMudar={onMudar}
        salvando={salvando}
        testID="consentimentos"
      />
    </ProvedorDeTema>,
  );

describe('Consentimentos', () => {
  it('o texto do estado desligado diz a CONSEQUENCIA, nao so que esta desligado', () => {
    /*
     * "Desativado" nao informa nada. Privacidade que o titular nao consegue
     * verificar na tela nao e escolha informada -- mesma regra do
     * `OptInDeEngajamento` (DS-APP §5.4).
     */
    renderizar({
      consentimentos: [{ ...base.consentimentos[0]!, concedido: false }],
    });

    expect(screen.getByText(/não são registradas/i)).toBeTruthy();
  });

  it('avisa quando a decisao e do responsavel legal (INV-143)', () => {
    renderizar({
      consentimentos: [{ ...base.consentimentos[0]!, editavel: false }],
    });

    expect(screen.getByText(/responsável legal/i)).toBeTruthy();
  });

  it('switch fica DESABILITADO para menor de idade', () => {
    // Sem isso a tela deixaria tocar e o servidor recusaria depois: o aluno
    // veria o switch mexer e voltar sozinho.
    renderizar({
      consentimentos: [{ ...base.consentimentos[0]!, editavel: false }],
    });

    expect(desabilitadoDoSwitch('consentimentos-HEALTH-switch')).toBe(true);
  });

  it('traduz o motivo da invalidez para o aluno', () => {
    renderizar({
      consentimentos: [
        {
          ...base.consentimentos[0]!,
          concedido: false,
          motivo: 'CONSENT_DOCUMENT_RETIRED',
        },
      ],
    });

    expect(screen.getByText(/texto mudou/i)).toBeTruthy();
  });

  it('avisa a decisao ao chamador quando o aluno mexe no switch', () => {
    const mudancas: [string, boolean][] = [];

    renderizar({}, (tipo, conceder) => mudancas.push([tipo, conceder]));

    fireEvent(screen.getByTestId('consentimentos-HEALTH-switch'), 'valueChange', false);

    expect(mudancas).toEqual([['HEALTH', false]]);
  });

  it('trava os switches enquanto uma decisao esta indo para o servidor', () => {
    // A decisao NAO e otimista: mostrar "revogado" antes da confirmacao diria
    // que o processamento parou quando ele pode nao ter parado (ADR-008).
    renderizar({}, () => undefined, 'HEALTH');

    expect(desabilitadoDoSwitch('consentimentos-HEALTH-switch')).toBe(true);
  });

  it('tipo que a tela nao conhece aparece com o codigo, em vez de sumir', () => {
    renderizar({
      consentimentos: [{ ...base.consentimentos[0]!, tipo: 'TIPO_NOVO' }],
    });

    expect(screen.getByText('TIPO_NOVO')).toBeTruthy();
  });
});
