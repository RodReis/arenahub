import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { criarCliente, ErroDeApi, type ArmazenamentoDeSessao } from '../api/cliente.js';
import { armazenamentoSeguro } from './armazenamento-seguro.js';
import { API_BASE_URL, APP_VERSION } from '../config.js';

export type EstadoDaSessao =
  /** Ainda lendo o armazenamento -- a tela mostra o shell, nao o login. */
  | { readonly tipo: 'CARREGANDO' }
  | { readonly tipo: 'ANONIMO' }
  | { readonly tipo: 'AUTENTICADO'; readonly sessionId: string };

interface ParDeTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

interface ValorDaSessao {
  readonly estado: EstadoDaSessao;
  readonly entrar: (dados: {
    tenantSlug: string;
    identificador: string;
    senha: string;
  }) => Promise<void>;
  readonly sair: () => Promise<void>;
  readonly cliente: ReturnType<typeof criarCliente>;
}

const SessaoContext = createContext<ValorDaSessao | null>(null);

/**
 * Estado de autenticacao do app.
 *
 * O ACCESS TOKEN VIVE AQUI, em `useRef` -- memoria, nunca disco. `useRef` e
 * nao `useState` de proposito: trocar o token nao pode re-renderizar a arvore
 * inteira, e ele muda a cada 10 minutos.
 *
 * O estado comeca em `CARREGANDO` e nao em `ANONIMO`. A diferenca aparece na
 * abertura do app: com `ANONIMO` como inicial, quem tem sessao valida ve a
 * tela de login PISCAR antes de ser redirecionado -- e, pior, quem estiver
 * numa rota protegida seria expulso no primeiro render.
 */
export function ProvedorDeSessao({
  children,
  armazenamento = armazenamentoSeguro,
}: {
  children: ReactNode;
  /** Injetavel para teste; a producao usa o SecureStore. */
  armazenamento?: ArmazenamentoDeSessao;
}) {
  const [estado, setEstado] = useState<EstadoDaSessao>({ tipo: 'CARREGANDO' });
  const acesso = useRef<string | null>(null);

  const aoPerderSessao = useCallback(() => {
    acesso.current = null;
    setEstado({ tipo: 'ANONIMO' });
  }, []);

  const cliente = useMemo(
    () =>
      criarCliente({
        baseUrl: API_BASE_URL,
        armazenamento,
        lerAcesso: () => acesso.current,
        guardarAcesso: (token) => {
          acesso.current = token;
        },
        aoPerderSessao,
        versaoDoApp: APP_VERSION,
      }),
    [armazenamento, aoPerderSessao],
  );

  /**
   * Na abertura, troca o refresh guardado por um par novo.
   *
   * E isto que entrega o `M4-AC-001`: o aluno volta ao app sem digitar senha
   * enquanto a sessao for valida e nao revogada. Se a troca falhar -- sessao
   * revogada, expirada, replay --, o cliente ja limpou o armazenamento e
   * chamou `aoPerderSessao`; aqui basta cair em `ANONIMO`.
   */
  useEffect(() => {
    let vivo = true;

    const retomar = async () => {
      const guardado = await armazenamento.lerRefresh();
      if (!guardado) {
        if (vivo) setEstado({ tipo: 'ANONIMO' });
        return;
      }

      try {
        const par = (await cliente.post('/api/v1/mobile/auth/refresh', {
          refreshToken: guardado,
        })) as ParDeTokens;

        acesso.current = par.accessToken;
        await armazenamento.salvarRefresh(par.refreshToken);
        if (vivo) setEstado({ tipo: 'AUTENTICADO', sessionId: par.sessionId });
      } catch {
        if (vivo) setEstado({ tipo: 'ANONIMO' });
      }
    };

    void retomar();

    // O efeito pode terminar depois que a tela saiu. Sem esta trava, o
    // `setEstado` de uma resposta atrasada avisaria um componente que ja
    // nao existe.
    return () => {
      vivo = false;
    };
  }, [armazenamento, cliente]);

  const entrar = useCallback(
    async (dados: { tenantSlug: string; identificador: string; senha: string }) => {
      const par = (await cliente.post('/api/v1/mobile/auth/login', dados)) as ParDeTokens;

      acesso.current = par.accessToken;
      await armazenamento.salvarRefresh(par.refreshToken);
      setEstado({ tipo: 'AUTENTICADO', sessionId: par.sessionId });
    },
    [armazenamento, cliente],
  );

  /**
   * Sair LIMPA O LOCAL mesmo se o servidor nao responder.
   *
   * Rede fora no momento do logout nao pode deixar a credencial no aparelho:
   * quem toca em "sair" quer sair agora, e o refresh que fica no SecureStore
   * e exatamente a credencial que ele achava ter apagado. O servidor
   * eventualmente expira a sessao sozinho.
   */
  const sair = useCallback(async () => {
    const guardado = await armazenamento.lerRefresh();

    try {
      if (guardado) {
        await cliente.post('/api/v1/mobile/auth/logout', { refreshToken: guardado });
      }
    } catch (erro) {
      // Falha de rede nao impede a limpeza local. Erro de API tambem nao --
      // o logout do servidor e idempotente e a sessao expira sozinha.
      if (!(erro instanceof ErroDeApi) && !(erro instanceof TypeError)) throw erro;
    } finally {
      await armazenamento.limpar();
      acesso.current = null;
      setEstado({ tipo: 'ANONIMO' });
    }
  }, [armazenamento, cliente]);

  const valor = useMemo<ValorDaSessao>(
    () => ({ estado, entrar, sair, cliente }),
    [estado, entrar, sair, cliente],
  );

  return <SessaoContext.Provider value={valor}>{children}</SessaoContext.Provider>;
}

export function useSessao(): ValorDaSessao {
  const valor = useContext(SessaoContext);
  if (!valor) throw new Error('useSessao fora do ProvedorDeSessao');

  return valor;
}
