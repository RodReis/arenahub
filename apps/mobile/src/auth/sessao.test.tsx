import { render, screen, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ProvedorDeSessao, useSessao } from './sessao.js';

/**
 * O que so o provedor decide: retomar a sessao na abertura, e nunca deixar
 * credencial no aparelho depois de sair.
 */
describe('ProvedorDeSessao', () => {
  let refreshGuardado: string | null;
  let limpezas: number;

  const armazenamento = {
    lerRefresh: () => Promise.resolve(refreshGuardado),
    salvarRefresh: (token: string) => {
      refreshGuardado = token;
      return Promise.resolve();
    },
    limpar: () => {
      refreshGuardado = null;
      limpezas += 1;
      return Promise.resolve();
    },
  };

  function Sonda() {
    const { estado, sair } = useSessao();

    return (
      <>
        <Text testID="estado">{estado.tipo}</Text>
        <Text testID="sair" onPress={() => void sair()}>
          sair
        </Text>
      </>
    );
  }

  const renderizar = () =>
    render(
      <ProvedorDeSessao armazenamento={armazenamento}>
        <Sonda />
      </ProvedorDeSessao>,
    );

  const responder = (status: number, corpo: unknown) =>
    Promise.resolve(new Response(JSON.stringify(corpo), { status }));

  beforeEach(() => {
    refreshGuardado = null;
    limpezas = 0;
    jest.clearAllMocks();
  });

  it('comeca CARREGANDO, nao ANONIMO', async () => {
    /*
     * A diferenca aparece na abertura do app: com `ANONIMO` inicial, quem tem
     * sessao valida ve a tela de login PISCAR antes do redirecionamento -- e
     * quem estiver numa rota protegida seria expulso no primeiro render.
     */
    refreshGuardado = 'refresh-valido';
    globalThis.fetch = jest.fn(() =>
      responder(200, { accessToken: 'a', refreshToken: 'r2', sessionId: 's1', expiraEm: 600 }),
    );

    renderizar();

    expect(screen.getByTestId('estado')).toHaveTextContent('CARREGANDO');
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('AUTENTICADO'));
  });

  it('sem refresh guardado vai direto para ANONIMO, sem chamar a API', async () => {
    globalThis.fetch = jest.fn();

    renderizar();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('ANONIMO'));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('refresh recusado cai em ANONIMO -- M4-AC-002', async () => {
    refreshGuardado = 'refresh-revogado';
    globalThis.fetch = jest.fn(() =>
      responder(401, { code: 'SESSAO_REVOGADA' }),
    );

    renderizar();

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('ANONIMO'));
    expect(refreshGuardado).toBeNull();
  });

  it('sair LIMPA o aparelho mesmo com a rede fora', async () => {
    /*
     * Quem toca em "sair" quer sair AGORA. Se a falha de rede abortasse a
     * limpeza, o refresh continuaria no SecureStore -- exatamente a
     * credencial que o aluno acreditava ter apagado.
     */
    refreshGuardado = 'refresh-valido';
    globalThis.fetch = jest
      .fn()
      .mockImplementationOnce(() =>
        responder(200, { accessToken: 'a', refreshToken: 'r2', sessionId: 's1', expiraEm: 600 }),
      )
      .mockImplementationOnce(() =>
        Promise.reject(new TypeError('Network request failed')),
      );

    renderizar();
    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('AUTENTICADO'));

    act(() => {
      (screen.getByTestId('sair').props as { onPress: () => void }).onPress();
    });

    await waitFor(() => expect(screen.getByTestId('estado')).toHaveTextContent('ANONIMO'));
    expect(refreshGuardado).toBeNull();
    expect(limpezas).toBeGreaterThan(0);
  });
});
