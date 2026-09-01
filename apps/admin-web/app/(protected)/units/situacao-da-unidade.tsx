'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, useToastDeErro } from '@arenahub/ui';

import estilos from '../dialogo.module.css';

import { alternarSituacaoDaUnidade, type EstadoDaUnidade } from '../../actions/units';

interface Props {
  readonly unitId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

const ESTADO_INICIAL: EstadoDaUnidade = {};

function BotaoDeConfirmacao({
  inativando,
  testId,
}: {
  readonly inativando: boolean;
  readonly testId: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant={inativando ? 'destructive' : 'solid'}
      disabled={pending}
      data-testid={testId}
    >
      {pending
        ? inativando
          ? 'Inativando…'
          : 'Reativando…'
        : inativando
          ? 'Inativar unidade'
          : 'Reativar unidade'}
    </Button>
  );
}

/**
 * Inativar e reativar unidade — ação de linha (issue #241).
 *
 * NÃO É EXCLUIR, e a diferença não é cosmética: dez tabelas referenciam
 * `GymUnit` com `onDelete: Cascade`. Apagar uma unidade levaria junto os
 * dispositivos, os eventos de acesso e as avaliações físicas registradas
 * nela — o histórico da operação inteira. Por isso não existe `DELETE` na
 * API, e a tela não promete um.
 *
 * As duas ações dividem o mesmo lugar da linha porque são a mesma decisão em
 * sentidos opostos: a unidade está em operação, ou não está.
 */
export function SituacaoDaUnidade({ unitId, code, name, status }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(alternarSituacaoDaUnidade, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  const inativando = status === 'ACTIVE';

  useToastDeErro(estado.erro, 'error', `erro-da-situacao-${unitId}`);
  useToastDeErro(
    estado.sucesso ? (inativando ? 'Unidade inativada.' : 'Unidade reativada.') : undefined,
    'info',
    `sucesso-da-situacao-${unitId}`,
  );

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // `showModal()` traz foco preso e backdrop; o atributo `open` não.
    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // Fechou pelo `Esc` ou pelo backdrop: sem isto o estado ficaria dizendo
    // "aberto" com o dialog fechado, e o próximo clique não abriria nada.
    const aoFechar = (): void => setAberto(false);
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, []);

  useEffect(() => {
    if (estado.sucesso) setAberto(false);
  }, [estado.sucesso]);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setAberto(true)}
        data-testid={`${inativando ? 'inativar' : 'reativar'}-unidade-${unitId}`}
      >
        {inativando ? 'Inativar' : 'Reativar'}
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-situacao-${unitId}`}
      >
        <form className={estilos['formularioDoDialogo']} action={acao}>
          <input type="hidden" name="unitId" value={unitId} />
          <input type="hidden" name="situacao" value={inativando ? 'INACTIVE' : 'ACTIVE'} />

          <div className={estilos['cabecalhoDoDialogo']}>
            {/*
              O TÍTULO DIZ O QUE VAI ACONTECER, com o nome do alvo -- e não
              "tem certeza?" (DS-PAINEL.md §4.15).
            */}
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-situacao-${unitId}`}>
              {inativando ? 'Inativar' : 'Reativar'} {name}
            </h2>
            <p className={estilos['codigoDoDialogo']}>{code}</p>
          </div>

          <div className={estilos['corpoDoDialogo']}>
            {inativando ? (
              <>
                {/*
                  O resumo diz o efeito E o que NÃO acontece: quem lê
                  "inativar" pensa em perder os alunos e o histórico, e é
                  exatamente o que não se perde.
                */}
                <p role="note" className={estilos['notaDoDialogo']}>
                  A unidade deixa de aparecer no cadastro de dispositivos e de novos alunos. Os
                  alunos, os equipamentos e os eventos de acesso já registrados nela{' '}
                  <strong>continuam existindo</strong> — nada é apagado.
                </p>

                {/* `hint` amarra a frase ao campo por `aria-describedby`. */}
                <Field
                  id={`situacao-motivo-unidade-${unitId}`}
                  name="reason"
                  label="Motivo (obrigatório)"
                  hint="Fica registrado com o seu nome e a data."
                  maxLength={500}
                  minLength={10}
                  required
                  data-testid={`campo-motivo-da-situacao-${unitId}`}
                />
              </>
            ) : (
              <p role="note" className={estilos['notaDoDialogo']}>
                A unidade volta a aparecer no cadastro de dispositivos e de novos alunos.
              </p>
            )}
          </div>

          <div className={estilos['rodapeDoDialogo']}>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoDeConfirmacao inativando={inativando} testId={`confirmar-situacao-da-unidade-${unitId}`} />
          </div>
        </form>
      </dialog>
    </>
  );
}
