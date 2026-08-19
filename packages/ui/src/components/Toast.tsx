'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { Icon, type IconName } from './Icon.js';
import estilos from './Toast.module.css';

export type ToastKind = 'info' | 'warn' | 'error';

interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  /**
   * `data-testid` do toast. Existe porque as telas que trocaram
   * `<p role="alert">` por toast ja carregavam testid que os E2E procuram --
   * a troca muda ONDE a mensagem aparece, nao SE ela aparece, e um testid
   * perdido derruba justamente o teste que provaria isso.
   */
  readonly testId?: string | undefined;
}

const ICONE: Record<ToastKind, IconName> = {
  info: 'check-circle',
  warn: 'alert-circle',
  error: 'x-circle',
};

interface ToastApi {
  readonly show: (kind: ToastKind, message: string, testId?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Toast para Info, Warn e error -- CLAUDE.md → Convencoes de codigo:
 * "Nao usar Alert para msg, sempre usar Toast".
 *
 * As telas de F6, F7 e F11 usam `role="alert"` cru desde que nasceram. Esta
 * fatia e a que torna a regra verdadeira.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([]);

  const show = useCallback((kind: ToastKind, message: string, testId?: string) => {
    setToasts((atuais) => {
      /**
       * Id derivado do tamanho da fila, nao de relogio nem de aleatorio.
       *
       * A lista e efemera e de UI: o id so precisa ser unico ENTRE os toasts
       * vivos. `Date.now()` colidiria em dois disparos no mesmo milissegundo,
       * e `Math.random()` quebraria render determinista no servidor.
       */
      const proximo = (atuais[atuais.length - 1]?.id ?? 0) + 1;

      return [...atuais, { id: proximo, kind, message, testId }];
    });
  }, []);

  const dispensar = useCallback((id: number) => {
    setToasts((atuais) => atuais.filter((toast) => toast.id !== id));
  }, []);

  const valor = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={valor}>
      {children}
      <div className={estilos['regiao']}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={estilos['toast']}
            data-kind={toast.kind}
            {...(toast.testId !== undefined ? { 'data-testid': toast.testId } : {})}
            /**
             * Erro INTERROMPE o leitor de tela (`alert`); confirmacao espera a
             * pausa (`status`). "Falha ao salvar" precisa chegar antes de a
             * pessoa sair da pagina; interromper a cada sucesso tornaria o
             * painel insuportavel para quem depende de leitor.
             */
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon name={ICONE[toast.kind]} />
            <span className={estilos['mensagem']}>{toast.message}</span>
            <button
              type="button"
              className={estilos['dispensar']}
              onClick={() => dispensar(toast.id)}
              aria-label="Dispensar"
            >
              <Icon name="x-circle" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const contexto = useContext(ToastContext);

  if (!contexto) {
    throw new Error('useToast exige <ToastProvider> acima na arvore.');
  }

  return contexto;
}
