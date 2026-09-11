'use client';

import { useEffect, useRef } from 'react';

import { SensitiveAction } from './SensitiveAction.js';
import estilos from './ConfirmDialog.module.css';

interface Props {
  readonly open: boolean;
  /** VERBO REAL: "Inativar cliente", nunca "OK" (DS-PAINEL §6). */
  readonly verb: string;
  readonly summary: string;
  readonly onConfirm: (reason: string) => void;
  readonly onCancel: () => void;
  readonly testId?: string;
}

/**
 * Acao sensivel disparada de uma LINHA de tabela ou de um menu.
 *
 * O `SensitiveAction` continua sendo o conteudo — resumo, motivo obrigatorio e
 * verbo real —, e este componente so lhe da a camada. A separacao importa:
 * dentro de um formulario o bloco em fluxo esta certo, e embrulhar aquele caso
 * num modal seria interromper quem ja estava decidido.
 *
 * `showModal()` E NAO O ATRIBUTO `open`: so o metodo cria a camada superior,
 * prende o foco, torna o resto da pagina `inert` e liga o Esc. Um `<dialog
 * open>` renderiza igual e nao faz nenhuma das quatro coisas — e a diferenca
 * so aparece quando alguem navega por teclado.
 */
export function ConfirmDialog({ open, verb, summary, onConfirm, onCancel, testId }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const elemento = dialogo.current;

    if (elemento === null) return;

    if (open && !elemento.open) elemento.showModal();
    if (!open && elemento.open) elemento.close();
  }, [open]);

  return (
    <dialog
      ref={dialogo}
      className={estilos['dialogo']}
      aria-label={verb}
      /*
        O Esc do navegador dispara `cancel` antes de `close`: sem avisar quem
        chama, o estado do React continuaria dizendo "aberto" e o dialogo nao
        reabriria no proximo clique.
      */
      onCancel={(evento) => {
        evento.preventDefault();
        onCancel();
      }}
      data-testid={testId}
    >
      {/*
        O conteudo so monta com o dialogo aberto: o `SensitiveAction` guarda o
        motivo digitado em estado proprio, e mante-lo montado faria a proxima
        abertura vir com o texto da anterior — dentro de um menu de linha, com
        o motivo de OUTRO cliente.
      */}
      {open ? (
        <SensitiveAction verb={verb} summary={summary} onConfirm={onConfirm} onCancel={onCancel} />
      ) : null}
    </dialog>
  );
}
