'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import { cadastrarAula, type EstadoDaAula } from '../../actions/classes';
import estilos from '../dialogo.module.css';

const DIAS_DA_SEMANA = [
  { valor: '0', rotulo: 'Domingo' },
  { valor: '1', rotulo: 'Segunda' },
  { valor: '2', rotulo: 'Terça' },
  { valor: '3', rotulo: 'Quarta' },
  { valor: '4', rotulo: 'Quinta' },
  { valor: '5', rotulo: 'Sexta' },
  { valor: '6', rotulo: 'Sábado' },
];

export interface Modalidade {
  readonly id: string;
  readonly name: string;
}

export interface Professor {
  readonly id: string;
  readonly fullName: string;
}

interface Props {
  readonly gymUnitId: string;
  readonly modalidades: readonly Modalidade[];
  readonly professores: readonly Professor[];
}

const ESTADO_INICIAL: EstadoDaAula = {};

function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-nova-aula">
      {pending ? 'Cadastrando…' : 'Cadastrar aula'}
    </Button>
  );
}

/**
 * Cadastro da grade de aula -- F77 (SPEC-077, ADR-061).
 *
 * MODAL, mesmo criterio de `ModalidadesDaUnidade`: cadastro de horario e
 * curto, e uma rota inteira faria a recepcao perder o contexto da semana
 * para preencher cinco campos.
 *
 * HORARIO EM MINUTOS DESDE A MEIA-NOITE (`startMinute`), nao string livre --
 * mesmo eixo de `PlanAccessWindow`. Este formulario pede `HH:mm` e converte
 * na hora do envio, para a recepcao digitar do jeito que pensa.
 */
export function FormularioDeAula({ gymUnitId, modalidades, professores }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(cadastrarAula, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  const [horaDeInicio, setHoraDeInicio] = useState('08:00');

  useToastDeErro(estado.erro, 'error', `erro-da-aula-${gymUnitId}`);

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
    // Mesmo padrao de `ModalidadesDaUnidade`: a recepcao cadastra a semana
    // inteira de uma sentada, e fechar a cada aula faria reabrir sete vezes.
    if (estado.sucesso) formulario.current?.reset();
  }, [estado.sucesso]);

  const startMinute = converterParaMinutos(horaDeInicio);

  return (
    <>
      <Button
        type="button"
        onClick={() => setAberto(true)}
        data-testid={`nova-aula-${gymUnitId}`}
      >
        Nova aula
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-nova-aula-${gymUnitId}`}
      >
        <div className={estilos['formularioDoDialogo']}>
          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-nova-aula-${gymUnitId}`}>
              Nova aula
            </h2>
          </div>

          <form ref={formulario} action={acao} className={estilos['corpoDoDialogo']}>
            <input type="hidden" name="gymUnitId" value={gymUnitId} />
            <input type="hidden" name="startMinute" value={startMinute} />

            <SelectField
              id={`modalidade-${gymUnitId}`}
              name="modalityId"
              label="Modalidade"
              required
              defaultValue={estado.valores?.modalityId ?? ''}
              data-testid="campo-modalidade-da-aula"
            >
              <option value="" disabled>
                Selecione a modalidade
              </option>
              {modalidades.map((modalidade) => (
                <option key={modalidade.id} value={modalidade.id}>
                  {modalidade.name}
                </option>
              ))}
            </SelectField>

            <SelectField
              id={`professor-${gymUnitId}`}
              name="trainerId"
              label="Professor"
              hint="Opcional -- quadra alugada pode não ter professor definido."
              defaultValue={estado.valores?.trainerId ?? ''}
              data-testid="campo-professor-da-aula"
            >
              <option value="">Sem professor definido</option>
              {professores.map((professor) => (
                <option key={professor.id} value={professor.id}>
                  {professor.fullName}
                </option>
              ))}
            </SelectField>

            <SelectField
              id={`dia-${gymUnitId}`}
              name="dayOfWeek"
              label="Dia da semana"
              required
              defaultValue={estado.valores?.dayOfWeek ?? ''}
              data-testid="campo-dia-da-aula"
            >
              <option value="" disabled>
                Selecione o dia
              </option>
              {DIAS_DA_SEMANA.map((dia) => (
                <option key={dia.valor} value={dia.valor}>
                  {dia.rotulo}
                </option>
              ))}
            </SelectField>

            <Field
              id={`hora-${gymUnitId}`}
              name="horaDeInicio"
              label="Horário de início"
              type="time"
              value={horaDeInicio}
              onChange={(evento) => setHoraDeInicio(evento.target.value)}
              required
              data-testid="campo-hora-da-aula"
            />

            <Field
              id={`duracao-${gymUnitId}`}
              name="durationMinutes"
              label="Duração (minutos)"
              type="number"
              min={1}
              defaultValue={estado.valores?.durationMinutes ?? '60'}
              required
              data-testid="campo-duracao-da-aula"
            />

            <Field
              id={`capacidade-${gymUnitId}`}
              name="capacity"
              label="Capacidade"
              type="number"
              min={1}
              defaultValue={estado.valores?.capacity ?? ''}
              required
              data-testid="campo-capacidade-da-aula"
            />

            <div className={estilos['rodapeDoDialogo']}>
              <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                Fechar
              </Button>
              <BotaoDeCadastro />
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}

/** `"08:00"` → `480`. Horário sem `:` (campo vazio) vira `0`, e o `required` do campo impede o envio. */
function converterParaMinutos(horaHHmm: string): number {
  const [hora, minuto] = horaHHmm.split(':').map(Number);

  return (hora ?? 0) * 60 + (minuto ?? 0);
}
