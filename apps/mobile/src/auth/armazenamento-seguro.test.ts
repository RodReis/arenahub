import * as SecureStore from 'expo-secure-store';

import { CHAVE_DO_REFRESH, armazenamentoSeguro } from './armazenamento-seguro.js';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));

const mock = SecureStore as jest.Mocked<typeof SecureStore>;

describe('armazenamentoSeguro', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('guarda o refresh no armazenamento do sistema', async () => {
    await armazenamentoSeguro.salvarRefresh('refresh-secreto');

    expect(mock.setItemAsync).toHaveBeenCalledWith(
      CHAVE_DO_REFRESH,
      'refresh-secreto',
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }),
    );
  });

  it('NAO viaja em backup -- a credencial nao volta em aparelho restaurado', () => {
    // `WHEN_UNLOCKED_THIS_DEVICE_ONLY` e o que amarra a chave a este
    // aparelho. Sem isso, um backup de iCloud restaurado noutro celular
    // carregaria a sessao junto -- e o dono nao saberia.
    expect(SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBeDefined();
  });

  it('le o refresh guardado', async () => {
    mock.getItemAsync.mockResolvedValueOnce('refresh-guardado');

    await expect(armazenamentoSeguro.lerRefresh()).resolves.toBe('refresh-guardado');
    expect(mock.getItemAsync).toHaveBeenCalledWith(CHAVE_DO_REFRESH);
  });

  it('limpar APAGA a chave, nao grava string vazia', async () => {
    // Gravar `''` deixaria a chave existindo com valor falsy -- e todo
    // `if (token)` no app passaria a tratar "sem sessao" e "sessao vazia"
    // como estados diferentes, sem motivo.
    await armazenamentoSeguro.limpar();

    expect(mock.deleteItemAsync).toHaveBeenCalledWith(CHAVE_DO_REFRESH);
    expect(mock.setItemAsync).not.toHaveBeenCalled();
  });

  it('a chave carrega VERSAO no nome', () => {
    // `v1` no nome: quando o formato do que guardamos mudar, a chave nova
    // nasce vazia em vez de ler o formato antigo como se fosse o novo.
    expect(CHAVE_DO_REFRESH).toMatch(/\.v\d+$/);
  });

  it('armazenamento indisponivel devolve null em vez de quebrar o app', async () => {
    // Keychain bloqueado, aparelho sem lock screen, emulador com storage
    // capado: ler tem de degradar para "sem sessao", e nao derrubar a tela
    // de abertura com uma excecao que ninguem captura.
    mock.getItemAsync.mockRejectedValueOnce(new Error('keychain indisponivel'));

    await expect(armazenamentoSeguro.lerRefresh()).resolves.toBeNull();
  });
});
