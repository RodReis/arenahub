'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from './unidades.module.css';

import { editarUnidade, type EstadoDaUnidade } from '../../actions/units';
import { FUSOS } from './fusos';

interface Props {
  readonly unitId: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
}

const ESTADO_INICIAL: EstadoDaUnidade = {};

function BotaoDeEdicao() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-edicao-da-unidade">
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

/**
 * Edição de unidade — ação de linha da tabela.
 *
 * MODAL e não rota própria: são dois campos, e uma tela inteira para nome e
 * fuso faria a operadora perder o contexto da lista para trocar uma palavra.
 * O cadastro tem rota (`/units/nova`) porque começa do zero e tem mais
 * campos; editar é pontual.
 *
 * `<dialog>` nativo: foco preso, `Esc` e backdrop de graça.
 */
export function EditarUnidade({ unitId, code, name, timezone }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(editarUnidade, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', `erro-da-unidade-${unitId}`);
  useToastDeErro(
    estado.sucesso ? 'Unidade atualizada.' : undefined,
    'info',
    `sucesso-da-unidade-${unitId}`,
  );

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    // `showModal()` é o que traz foco preso e backdrop -- o atributo `open`
    // abriria o dialog sem nada disso.
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
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`editar-unidade-${unitId}`}
      >
        Editar
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-edicao-${unitId}`}
      >
        <form className={estilos['formularioDoDialogo']} action={acao}>
          <input type="hidden" name="unitId" value={unitId} />

          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-edicao-${unitId}`}>
              Editar unidade
            </h2>
            {/* O código identifica DE QUAL unidade se trata -- o modal cobre a lista. */}
            <p className={estilos['codigoDoDialogo']}>{code}</p>
          </div>

          <div className={estilos['corpoDoDialogo']}>
            <Field
              id={`edicao-nome-unidade-${unitId}`}
              name="name"
              label="Nome"
              defaultValue={estado.valores?.name ?? name}
              maxLength={120}
              required
              data-testid="campo-edicao-nome-da-unidade"
            />

            <SelectField
              id={`edicao-fuso-unidade-${unitId}`}
              name="timezone"
              label="Fuso horário"
              defaultValue={estado.valores?.timezone ?? timezone}
              required
              data-testid="campo-edicao-fuso-da-unidade"
            >
              {FUSOS.map((fuso) => (
                <option key={fuso.valor} value={fuso.valor}>
                  {fuso.rotulo}
                </option>
              ))}
            </SelectField>

            {/*
              O CÓDIGO NÃO SE EDITA, e a tela diz por quê em vez de só omitir
              o campo: `PATCH /units/:id` não o aceita, porque ele é a
              referência estável que aparece em relatório e na conversa da
              operação. Quem procurar o campo aqui saberia que não é esquecimento.
            */}
            <p role="note" className={estilos['notaDoDialogo']}>
              O código <strong>{code}</strong> não muda depois que a unidade existe — ele identifica
              a unidade nos relatórios e nas outras telas.
            </p>

            {/*
              Mesmo aviso do cadastro: o fuso decide o horário de toda a
              operação da unidade, e o bloqueio por inadimplência o usa sem
              fallback (ADR-019).
            */}
            <p role="note" className={estilos['notaDoDialogo']}>
              Mudar o fuso muda o horário de toda a operação desta unidade — janela de acesso,
              vencimento e bloqueio.
            </p>
          </div>

          <div className={estilos['rodapeDoDialogo']}>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <BotaoDeEdicao />
          </div>
        </form>
      </dialog>
    </>
  );
}
