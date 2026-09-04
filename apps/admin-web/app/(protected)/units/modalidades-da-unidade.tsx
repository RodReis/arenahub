'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, EstadoSimples, Field, useToastDeErro } from '@arenahub/ui';

import estilos from '../dialogo.module.css';

import {
  alternarSituacaoDaModalidade,
  cadastrarModalidade,
  type EstadoDaModalidade,
} from '../../actions/modalidades';

export interface Modalidade {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

interface Props {
  readonly unitId: string;
  readonly code: string;
  readonly modalidades: readonly Modalidade[];
}

const ESTADO_INICIAL: EstadoDaModalidade = {};

function BotaoDeCadastro() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-nova-modalidade">
      {pending ? 'Adicionando…' : 'Adicionar'}
    </Button>
  );
}

function BotaoDeSituacao({ ativa }: { readonly ativa: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="ghost" disabled={pending}>
      {ativa ? 'Inativar' : 'Reativar'}
    </Button>
  );
}

/**
 * Modalidades de uma unidade — ação de linha da tabela (F60).
 *
 * MODAL e não rota própria, pelo mesmo critério do `EditarUnidade` ao lado: é
 * uma lista curta de nomes, e uma tela inteira faria a operadora perder o
 * contexto da lista de unidades para digitar uma palavra.
 *
 * A LISTA VEM DO SERVIDOR, por props: quem busca é o Server Component da
 * página, e a `revalidatePath('/units')` da action recarrega. Buscar aqui no
 * cliente faria a mesma consulta duas vezes e exporia o token ao navegador.
 */
export function ModalidadesDaUnidade({ unitId, code, modalidades }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(cadastrarModalidade, ESTADO_INICIAL);
  const [estadoDaSituacao, acaoDaSituacao] = useActionState(
    alternarSituacaoDaModalidade,
    ESTADO_INICIAL,
  );
  const dialogo = useRef<HTMLDialogElement>(null);
  const formulario = useRef<HTMLFormElement>(null);

  useToastDeErro(estado.erro, 'error', `erro-da-modalidade-${unitId}`);
  useToastDeErro(estadoDaSituacao.erro, 'error', `erro-da-situacao-da-modalidade-${unitId}`);

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
    // O MODAL FICA ABERTO depois de adicionar, ao contrário da edição: quem
    // está cadastrando modalidade quase sempre cadastra várias seguidas
    // ("Quadras de Areia", depois "Cross Fit"). Fechar a cada uma faria a
    // operadora reabrir quatro vezes.
    //
    // `reset()` no form, e não `ref` no campo: o `Field` do design system não
    // repassa `ref` ao `<input>`, e furar isso aqui obrigaria a mexer num
    // componente compartilhado por causa de uma tela.
    if (estado.sucesso) formulario.current?.reset();
  }, [estado.sucesso]);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setAberto(true)}
        data-testid={`modalidades-da-unidade-${unitId}`}
      >
        Modalidades
      </Button>

      <dialog
        ref={dialogo}
        className={estilos['dialogo']}
        aria-labelledby={`titulo-modalidades-${unitId}`}
      >
        <div className={estilos['formularioDoDialogo']}>
          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id={`titulo-modalidades-${unitId}`}>
              Modalidades da unidade
            </h2>
            {/* O código identifica DE QUAL unidade se trata -- o modal cobre a lista. */}
            <p className={estilos['codigoDoDialogo']}>{code}</p>
          </div>

          <div className={estilos['corpoDoDialogo']}>
            <form ref={formulario} action={acao} className={estilos['linhaDeCadastro']}>
              <input type="hidden" name="unitId" value={unitId} />

              <Field
                id={`nova-modalidade-${unitId}`}
                name="name"
                label="Nova modalidade"
                defaultValue={estado.valores?.name ?? ''}
                maxLength={80}
                required
                placeholder="Ex.: Quadras de Areia"
                data-testid="campo-nova-modalidade"
              />

              <BotaoDeCadastro />
            </form>

            {modalidades.length === 0 ? (
              <p role="note" className={estilos['notaDoDialogo']} data-testid="sem-modalidades">
                Esta unidade ainda não tem modalidade. Cadastre a primeira para poder escolhê-la no
                cadastro de aluno.
              </p>
            ) : (
              <ul className={estilos['listaDoDialogo']} data-testid="lista-de-modalidades">
                {modalidades.map((modalidade) => (
                  <li key={modalidade.id} className={estilos['itemDaLista']}>
                    <span>{modalidade.name}</span>

                    {/* Texto, e não só cor: `M1-NFR-008` exige WCAG 2.2 AA. */}
                    {modalidade.isActive ? (
                      <EstadoSimples label="Ativa" tom="positivo" />
                    ) : (
                      <EstadoSimples label="Inativa" tom="neutro" />
                    )}

                    {/*
                      INATIVAR, e não excluir: aluno já vinculado ficaria
                      órfão, e o histórico de quem treinou o quê sumiria. Não
                      há exclusão na API, e esta tela não promete uma.
                    */}
                    <form action={acaoDaSituacao}>
                      <input type="hidden" name="unitId" value={unitId} />
                      <input type="hidden" name="modalityId" value={modalidade.id} />
                      <input
                        type="hidden"
                        name="situacao"
                        value={modalidade.isActive ? 'INACTIVE' : 'ACTIVE'}
                      />
                      <BotaoDeSituacao ativa={modalidade.isActive} />
                    </form>
                  </li>
                ))}
              </ul>
            )}

            <p role="note" className={estilos['notaDoDialogo']}>
              Modalidade inativa deixa de aparecer no cadastro de aluno novo, e continua nas fichas
              de quem já a tem. Ela não controla a catraca — quem libera o acesso é o plano.
            </p>
          </div>

          <div className={estilos['rodapeDoDialogo']}>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
              Fechar
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
