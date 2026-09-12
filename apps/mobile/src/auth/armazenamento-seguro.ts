import * as SecureStore from 'expo-secure-store';

/**
 * Onde o refresh token do aluno mora -- `M4-FR-003`.
 *
 * O ACCESS TOKEN NAO ENTRA AQUI, e a ausencia e a decisao. Ele vive so em
 * memoria, no provedor de sessao: em disco sobreviveria ao fechamento do app
 * e viraria credencial de longa duracao sem rotacao -- exatamente o que o
 * modelo de familia existe para evitar. Ele vale 10 minutos; perder na troca
 * de tela custa um refresh, nao um login.
 *
 * `v1` no nome da chave: quando o formato do que guardamos mudar, a chave
 * nova nasce vazia em vez de ler o formato antigo como se fosse o novo.
 */
export const CHAVE_DO_REFRESH = 'arenahub.refresh.v1';

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` amarra a credencial a ESTE aparelho.
 *
 * Sem isso, um backup de iCloud restaurado noutro celular carregaria a sessao
 * junto -- e o dono nao saberia que existe uma segunda copia viva.
 */
const OPCOES = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY } as const;

export const armazenamentoSeguro = {
  /**
   * Devolve `null` quando nao ha nada guardado E quando o armazenamento
   * falha.
   *
   * Keychain bloqueado, aparelho sem lock screen, emulador com storage
   * capado: nos tres o certo e degradar para "sem sessao" e mostrar o login.
   * Deixar a excecao subir derrubaria a tela de abertura com um erro que o
   * aluno nao tem como resolver.
   */
  async lerRefresh(): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(CHAVE_DO_REFRESH);
    } catch {
      return null;
    }
  },

  async salvarRefresh(token: string): Promise<void> {
    await SecureStore.setItemAsync(CHAVE_DO_REFRESH, token, OPCOES);
  },

  /**
   * APAGA a chave -- nao grava string vazia.
   *
   * Gravar `''` deixaria a chave existindo com valor falsy, e "sem sessao"
   * passaria a ter dois estados que todo `if` do app trataria igual, sem
   * motivo para existirem.
   */
  async limpar(): Promise<void> {
    await SecureStore.deleteItemAsync(CHAVE_DO_REFRESH);
  },
};
