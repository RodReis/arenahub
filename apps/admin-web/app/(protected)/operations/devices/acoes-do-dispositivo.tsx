'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../../dialogo.module.css';

import {
  aposentarDispositivo,
  editarDispositivo,
  type EstadoDoDispositivo,
} from '../../../actions/devices';

interface Props {
  readonly deviceId: string;
  readonly serial: string;
  readonly model: string;
  readonly status: string;
  readonly firmware: string | null;
}

const ESTADO_INICIAL: EstadoDoDispositivo = {};

/**
 * As situações que a EDIÇÃO oferece.
 *
 * `RETIRED` não está aqui de propósito: aposentar é ação sensível e tem
 * caminho próprio, com motivo obrigatório (DS-PAINEL.md §5.1). Um select que
 * oferecesse "Aposentado" ao lado de "Ativo" faria a ação mais grave da tela
 * parecer uma troca de rótulo.
 */
const SITUACOES = [
  { valor: 'ACTIVE', rotulo: 'Ativo' },
  { valor: 'MAINTENANCE', rotulo: 'Em manutenção' },
];

function BotaoDeEdicao({ testId }: { readonly testId: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid={testId}>
      {pending ? 'Salvando…' : 'Salvar alterações'}
    </Button>
  );
}

function BotaoDeAposentadoria({ testId }: { readonly testId: string }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending}
      data-testid={testId}
    >
      {pending ? 'Aposentando…' : 'Aposentar dispositivo'}
    </Button>
  );
}

/**
 * `<dialog>` nativo com o mesmo ciclo do modal de unidade: `showModal()` traz
 * foco preso e backdrop, o evento `close` devolve o estado quando alguém sai
 * pelo `Esc`, e o sucesso fecha a caixa.
 */
function useDialogo(aberto: boolean, fechar: () => void, sucesso: unknown) {
  const dialogo = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    if (aberto && !elemento.open) elemento.showModal();
    if (!aberto && elemento.open) elemento.close();
  }, [aberto]);

  useEffect(() => {
    const elemento = dialogo.current;
    if (!elemento) return;

    const aoFechar = (): void => fechar();
    elemento.addEventListener('close', aoFechar);

    return () => elemento.removeEventListener('close', aoFechar);
  }, [fechar]);

  useEffect(() => {
    if (sucesso) fechar();
  }, [sucesso, fechar]);

  return dialogo;
}

/**
 * Ações de linha do equipamento — editar e aposentar (issue #241).
 *
 * `PATCH /api/v1/devices/:id` aceita situação e firmware desde sempre, e a
 * tabela não tinha ação nenhuma: um leitor só mudava de situação por `curl`.
 *
 * As DUAS ações são separadas porque têm peso diferente. Editar é rotina —
 * marcar manutenção, atualizar firmware. Aposentar tira o equipamento de
 * operação e é o mais perto de excluir que existe aqui (não há `DELETE`:
 * `AccessEvent` referencia o dispositivo, e apagá-lo levaria o histórico de
 * quem passou na catraca).
 */
export function AcoesDoDispositivo({ deviceId, serial, model, status, firmware }: Props) {
  const [editando, setEditando] = useState(false);
  const [aposentando, setAposentando] = useState(false);

  const [estadoDaEdicao, acaoDeEditar] = useActionState(editarDispositivo, ESTADO_INICIAL);
  const [estadoDaBaixa, acaoDeAposentar] = useActionState(aposentarDispositivo, ESTADO_INICIAL);

  useToastDeErro(estadoDaEdicao.erro, 'error', `erro-do-dispositivo-${deviceId}`);
  useToastDeErro(
    estadoDaEdicao.sucesso ? 'Dispositivo atualizado.' : undefined,
    'info',
    `sucesso-do-dispositivo-${deviceId}`,
  );
  useToastDeErro(estadoDaBaixa.erro, 'error', `erro-da-baixa-${deviceId}`);
  useToastDeErro(
    estadoDaBaixa.sucesso ? `Dispositivo ${serial} aposentado.` : undefined,
    'info',
    `sucesso-da-baixa-${deviceId}`,
  );

  const dialogoDeEdicao = useDialogo(
    editando,
    () => setEditando(false),
    estadoDaEdicao.sucesso,
  );
  const dialogoDeBaixa = useDialogo(
    aposentando,
    () => setAposentando(false),
    estadoDaBaixa.sucesso,
  );

  /*
   * APOSENTADO NÃO SE APOSENTA DE NOVO, e nem se edita: `PATCH` aceitaria a
   * chamada, mas oferecer as duas ações a um equipamento que já saiu de
   * operação é convidar a um clique sem efeito. Reativar é caminho de outra
   * fatia -- ninguém pediu, e inventá-lo aqui seria escopo que o card não tem.
   */
  const aposentado = status === 'RETIRED';

  if (aposentado) return null;

  return (
    <div className={estilos['acaoDaLinha']}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setEditando(true)}
        data-testid={`editar-dispositivo-${deviceId}`}
      >
        Editar
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => setAposentando(true)}
        data-testid={`aposentar-dispositivo-${deviceId}`}
      >
        Aposentar
      </Button>

      <dialog
        ref={dialogoDeEdicao}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-edicao-dispositivo-${deviceId}`}
      >
        <form className={estilos['formularioDoDialogo']} action={acaoDeEditar}>
          <input type="hidden" name="deviceId" value={deviceId} />

          <div className={estilos['cabecalhoDoDialogo']}>
            <h2
              className={estilos['tituloDoDialogo']}
              id={`titulo-edicao-dispositivo-${deviceId}`}
            >
              Editar {model}
            </h2>
            {/* A série identifica DE QUAL equipamento se trata -- o modal cobre a lista. */}
            <p className={estilos['codigoDoDialogo']}>{serial}</p>
          </div>

          <div className={estilos['corpoDoDialogo']}>
            <SelectField
              id={`edicao-situacao-dispositivo-${deviceId}`}
              name="status"
              label="Situação"
              defaultValue={estadoDaEdicao.valores?.['status'] ?? status}
              required
              data-testid={`campo-situacao-do-dispositivo-${deviceId}`}
            >
              {SITUACOES.map((situacao) => (
                <option key={situacao.valor} value={situacao.valor}>
                  {situacao.rotulo}
                </option>
              ))}
            </SelectField>

            <Field
              id={`edicao-firmware-dispositivo-${deviceId}`}
              name="firmware"
              label="Firmware"
              defaultValue={estadoDaEdicao.valores?.['firmware'] ?? firmware ?? ''}
              maxLength={40}
              data-testid={`campo-firmware-do-dispositivo-${deviceId}`}
            />

            {/*
              O QUE NÃO SE EDITA, e por quê -- em vez de só omitir os campos.
              Unidade, tipo, modelo e série identificam o equipamento FÍSICO
              parafusado na parede; trocá-los faria o histórico de acesso
              apontar para um aparelho que nunca leu aquele rosto.
            */}
            <p role="note" className={estilos['notaDoDialogo']}>
              Unidade, tipo, modelo e série não mudam depois do cadastro — eles identificam o
              equipamento físico nos eventos de acesso já registrados.
            </p>

            <p role="note" className={estilos['notaDoDialogo']}>
              Em manutenção, o equipamento continua cadastrado e para de receber sincronização de
              alunos.
            </p>
          </div>

          <div className={estilos['rodapeDoDialogo']}>
            <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
            <BotaoDeEdicao testId={`confirmar-edicao-do-dispositivo-${deviceId}`} />
          </div>
        </form>
      </dialog>

      <dialog
        ref={dialogoDeBaixa}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-baixa-dispositivo-${deviceId}`}
      >
        <form className={estilos['formularioDoDialogo']} action={acaoDeAposentar}>
          <input type="hidden" name="deviceId" value={deviceId} />

          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-baixa-dispositivo-${deviceId}`}>
              Aposentar {model}
            </h2>
            <p className={estilos['codigoDoDialogo']}>{serial}</p>
          </div>

          <div className={estilos['corpoDoDialogo']}>
            {/*
              O RESUMO DIZ O EFEITO, não pergunta "tem certeza?" -- DS-PAINEL.md
              §4.15. E diz também o que NÃO acontece: quem lê "aposentar" pensa
              em perder o histórico, e é justamente o que não se perde.
            */}
            <p role="note" className={estilos['notaDoDialogo']}>
              O equipamento sai de operação e para de receber alunos. Os eventos de acesso já
              registrados por ele <strong>continuam no histórico</strong> — nada é apagado.
            </p>

            <Field
              id={`baixa-motivo-dispositivo-${deviceId}`}
              name="reason"
              label="Motivo (obrigatório)"
              maxLength={500}
              required
              minLength={10}
              data-testid={`campo-motivo-da-baixa-${deviceId}`}
            />

            <p role="note" className={estilos['notaDoDialogo']}>
              O motivo fica registrado com o seu nome e a data.
            </p>
          </div>

          <div className={estilos['rodapeDoDialogo']}>
            <Button type="button" variant="ghost" onClick={() => setAposentando(false)}>
              Cancelar
            </Button>
            <BotaoDeAposentadoria testId={`confirmar-aposentadoria-${deviceId}`} />
          </div>
        </form>
      </dialog>
    </div>
  );
}
