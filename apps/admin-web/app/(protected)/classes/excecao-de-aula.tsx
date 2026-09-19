'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import { registrarExcecaoDeAula, type EstadoDaExcecao } from '../../actions/classes';
import estilos from '../dialogo.module.css';

import type { Professor } from './formulario-de-aula';

interface Props {
  readonly gymUnitId: string;
  readonly classId: string;
  readonly modalityName: string;
  readonly professores: readonly Professor[];
}

const ESTADO_INICIAL: EstadoDaExcecao = {};

function BotaoDeRegistro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-excecao-de-aula">
      {pending ? 'Registrando…' : 'Registrar'}
    </Button>
  );
}

/**
 * Exceção de calendário -- F77, comportamento exigido pela SPEC-077 §3:
 * cancelar UMA ocorrência (feriado, professor doente) ou trocar o professor
 * de UM dia específico, sem desfazer a grade.
 *
 * MODAL POR AULA, e não formulário embutido no cartão: a recepção escolhe
 * "cancelar" ou "trocar professor" com pouca frequência (feriado, imprevisto
 * pontual), e um formulário sempre visível competiria com a informação que a
 * grade existe para mostrar.
 */
export function ExcecaoDeAula({ gymUnitId, classId, modalityName, professores }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(registrarExcecaoDeAula, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);
  const [tipo, setTipo] = useState<'CANCELLED' | 'TRAINER_OVERRIDE'>('CANCELLED');

  useToastDeErro(estado.erro, 'error', `erro-da-excecao-${classId}`);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

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
        data-testid={`excecao-da-aula-${classId}`}
      >
        Exceção
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-excecao-${classId}`}
      >
        <div className={estilos['formularioDoDialogo']}>
          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-excecao-${classId}`}>
              Exceção de calendário
            </h2>
            <p className={estilos['codigoDoDialogo']}>{modalityName}</p>
          </div>

          <form action={acao} className={estilos['corpoDoDialogo']}>
            <input type="hidden" name="gymUnitId" value={gymUnitId} />
            <input type="hidden" name="classId" value={classId} />

            <Field
              id={`data-${classId}`}
              name="occurrenceDate"
              label="Data da ocorrência"
              type="date"
              required
              data-testid="campo-data-da-excecao"
            />

            <SelectField
              id={`tipo-${classId}`}
              name="type"
              label="O que fazer"
              value={tipo}
              onChange={(evento) => setTipo(evento.target.value as typeof tipo)}
              data-testid="campo-tipo-da-excecao"
            >
              <option value="CANCELLED">Cancelar a ocorrência</option>
              <option value="TRAINER_OVERRIDE">Trocar o professor</option>
            </SelectField>

            {tipo === 'TRAINER_OVERRIDE' ? (
              <SelectField
                id={`professor-substituto-${classId}`}
                name="overrideTrainerId"
                label="Professor substituto"
                required
                data-testid="campo-professor-substituto"
              >
                <option value="" disabled>
                  Selecione o professor
                </option>
                {professores.map((professor) => (
                  <option key={professor.id} value={professor.id}>
                    {professor.fullName}
                  </option>
                ))}
              </SelectField>
            ) : null}

            <p role="note" className={estilos['notaDoDialogo']}>
              A grade continua valendo nas outras semanas -- só esta data muda.
            </p>

            <div className={estilos['rodapeDoDialogo']}>
              <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                Fechar
              </Button>
              <BotaoDeRegistro />
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
