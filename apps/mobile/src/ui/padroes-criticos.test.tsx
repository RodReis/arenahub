import { render, screen, fireEvent } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { View } from 'react-native';
import { APP_TOKENS } from '@arenahub/ui/app-tokens';
import { ProvedorDeTema } from './theme.js';
import { AvisoDeIA } from './AvisoDeIA.js';
import { Carteirinha } from './Carteirinha.js';
import { EstadoDeEspera } from './EstadoDeEspera.js';
import { OptInDeEngajamento } from './OptInDeEngajamento.js';

/**
 * Os QUATRO PADROES que o app nao pode errar -- SPEC-043 §1 e §4.
 *
 * Estes testes NAO conferem markup. Cada um afirma um invariante que, se cair,
 * produz dano real: o app declarar pagamento que o backend nao confirmou,
 * vazar PII numa tela mostrada a terceiro, publicar leitura de saude sem o
 * aviso, ou colocar o aluno num ranking sem ele pedir.
 */

const renderizar = (no: ReactElement, tema: 'dark' | 'light' = 'dark') =>
  render(<ProvedorDeTema forcarTema={tema}>{no}</ProvedorDeTema>);

describe('espera de pagamento — nunca afirma "Pago"', () => {
  /**
   * O invariante e sobre AFIRMACAO, nao sobre vocabulario.
   *
   * A primeira versao deste teste proibia a palavra "confirmado" na tela
   * inteira -- e reprovou por causa de "avisaremos quando o pagamento for
   * confirmado", que e justamente a promessa CERTA. Proibir a palavra teria
   * levado a reescrever o texto bom para satisfazer o teste ruim.
   *
   * O que nao pode existir e a forma AFIRMATIVA: "Pago", "Pagamento
   * confirmado", "Aprovado" -- estado, nao promessa futura.
   */
  const AFIRMACOES_PROIBIDAS = [
    /\bpago\b/i,
    /pagamento\s+(confirmado|aprovado|recebido)/i,
    /\baprovado\b/i,
    /\bquitad[oa]\b/i,
  ];

  it('nao afirma em lugar nenhum da tela que o pagamento ocorreu', () => {
    renderizar(<EstadoDeEspera prazo="até 2 minutos" onVoltar={jest.fn()} />);

    // A tela inteira, para que a afirmacao nao dependa de saber ONDE a frase
    // proibida apareceria.
    const texto = JSON.stringify(screen.toJSON());

    for (const proibida of AFIRMACOES_PROIBIDAS) {
      expect(texto).not.toMatch(proibida);
    }
    expect(screen.getByText('Aguardando confirmação')).toBeTruthy();
  });

  it('sempre oferece saida — o §4.10 proibe prender o aluno na espera', () => {
    const voltar = jest.fn();
    renderizar(<EstadoDeEspera prazo="até 2 minutos" onVoltar={voltar} />);

    fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
    expect(voltar).toHaveBeenCalledTimes(1);
  });

  it('diz o que acontece se o aluno sair da tela', () => {
    renderizar(<EstadoDeEspera prazo="até 2 minutos" onVoltar={jest.fn()} />);
    expect(screen.getByText(/avisaremos quando o pagamento for confirmado/i)).toBeTruthy();
  });
});

describe('carteirinha — token opaco, sem PII', () => {
  const CPF = '529.982.247-25';
  const abrir = () =>
    renderizar(
      <Carteirinha
        nome="Ana Souza"
        matricula="AH-4471"
        plano="Mensal"
        unidade="Arena Positiva"
        qr={<View testID="qr" />}
        segundosParaRenovar={28}
        onFechar={jest.fn()}
      />,
    );

  it('declara ao aluno que o codigo e de uso unico e sem dado pessoal', () => {
    abrir();
    expect(screen.getByText(/token de uso único, sem dados pessoais/i)).toBeTruthy();
  });

  it('nao tem como receber CPF: a prop nao existe no contrato', () => {
    abrir();
    expect(JSON.stringify(screen.toJSON())).not.toContain(CPF);
  });

  it('o QR nao inverte entre os temas — §2.11 armadilha 2', () => {
    /**
     * A afirmacao e sobre INVARIANCIA, nao sobre o hex.
     *
     * Escrever `'#FFFFFF'` aqui seria hex literal fora de `packages/ui/tokens`
     * -- a regra 1 do DS, que o lint pegou nesta linha. E a regra tem razao
     * mesmo num teste: o dia em que o token mudasse, este arquivo passaria a
     * ser a segunda verdade que diz qual e a cor certa.
     *
     * O que o QR exige e que fundo E TINTA nao invertam com o tema: a camera
     * do leitor nao decodifica o negativo. Isso se afirma comparando os dois
     * temas entre si, sem nomear a cor.
     */
    expect(APP_TOKENS.light.optico.qrBackground).toBe(APP_TOKENS.dark.optico.qrBackground);
    expect(APP_TOKENS.light.optico.qrInk).toBe(APP_TOKENS.dark.optico.qrInk);
  });
});

describe('saude e IA — aviso persistente', () => {
  it('carrega o codigo de disclaimer que a regra de arquitetura 8 exige', () => {
    renderizar(<AvisoDeIA modelVersion="g-2.1" promptVersion="p-7" />);
    expect(screen.getByText(/NOT_MEDICAL_DIAGNOSIS/)).toBeTruthy();
  });

  it('diz que nao e diagnostico medico', () => {
    renderizar(<AvisoDeIA modelVersion="g-2.1" promptVersion="p-7" />);
    expect(screen.getByText('Não é diagnóstico médico')).toBeTruthy();
  });

  it('nao oferece nenhum controle para fechar o aviso', () => {
    renderizar(<AvisoDeIA modelVersion="g-2.1" promptVersion="p-7" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('engajamento — opt-in desligado por padrao', () => {
  it('desligado, o texto diz que o aluno NAO aparece para os outros', () => {
    renderizar(<OptInDeEngajamento participando={false} onMudar={jest.fn()} />);
    expect(screen.getByText(/não aparece na lista dos outros/i)).toBeTruthy();
  });

  it('sair custa UM toque — o §5.4 permite no maximo dois', () => {
    const mudar = jest.fn();
    renderizar(<OptInDeEngajamento participando onMudar={mudar} />);

    fireEvent(screen.getByRole('switch'), 'valueChange', false);
    expect(mudar).toHaveBeenCalledWith(false);
  });

  it('o switch reflete o estado no papel de acessibilidade, nao so na cor', () => {
    renderizar(<OptInDeEngajamento participando={false} onMudar={jest.fn()} />);
    const props = screen.getByRole('switch').props as {
      accessibilityState?: { checked?: boolean };
    };
    expect(props.accessibilityState?.checked).toBe(false);
  });
});
