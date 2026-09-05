'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../dialogo.module.css';
import proprios from './convite.module.css';

import { convidarUsuario, type EstadoDoConvite } from '../../actions/usuarios';

export interface Papel {
  readonly id: string;
  readonly name: string;
  readonly isSystem: boolean;
}

interface Props {
  readonly papeis: readonly Papel[];
}

const ESTADO_INICIAL: EstadoDoConvite = {};

function BotaoDeConvite() {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} data-testid="confirmar-convite">
      {pending ? 'Convidando…' : 'Convidar'}
    </Button>
  );
}

/**
 * Convite de usuário — issue #274.
 *
 * MODAL e não rota própria, pelo mesmo critério das outras ações de linha do
 * painel: são dois campos, e uma tela inteira faria quem convida perder o
 * contexto da lista para digitar um e-mail.
 *
 * O RESULTADO SUBSTITUI O FORMULÁRIO em vez de fechar o modal, ao contrário
 * de todas as outras ações: o link do convite aparece UMA VEZ (a API guarda
 * só o hash) e fechar sozinho o perderia para sempre, sem aviso. Quem fecha
 * é a pessoa, depois de copiar.
 */
export function ConvidarUsuario({ papeis }: Props) {
  const [aberto, setAberto] = useState(false);
  const [estado, acao] = useActionState(convidarUsuario, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', 'erro-do-convite');

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

  const convite = estado.sucesso;

  return (
    <>
      <Button type="button" onClick={() => setAberto(true)} data-testid="convidar-usuario">
        Convidar usuário
      </Button>

      <dialog ref={dialogo} className={estilos['dialogo']} aria-labelledby="titulo-do-convite">
        <div className={estilos['formularioDoDialogo']}>
          <div className={estilos['cabecalhoDoDialogo']}>
            <h2 className={estilos['tituloDoDialogo']} id="titulo-do-convite">
              {convite ? 'Convite criado' : 'Convidar usuário'}
            </h2>
          </div>

          {convite ? (
            <div className={estilos['corpoDoDialogo']} data-testid="convite-criado">
              <p className={estilos['notaDoDialogo']}>
                Envie este link para <strong>{convite.email}</strong>. Ele vale por 24 horas e
                permite definir a senha de acesso.
              </p>

              {/*
                O CAMINHO, e não a URL completa: o painel não sabe em que
                domínio está sendo servido (pode ser localhost, o domínio de
                produção ou um túnel), e montar `window.location.origin` aqui
                daria um link certo por acidente e errado quando alguém
                acessasse por outro endereço. O caminho relativo é verdade em
                qualquer um deles.
              */}
              <p className={proprios['link']} data-testid="link-do-convite">
                /convite/{convite.token}
              </p>

              {/*
                O AVISO É A PARTE IMPORTANTE desta tela. A API guarda só o
                hash do token: recarregar a página perde o link para sempre e
                a única saída é convidar de novo. Sem isto, quem fecha sem
                copiar descobre o problema quando a pessoa convidada nunca
                aparece.
              */}
              <p className={estilos['notaDoDialogo']} role="note">
                Copie agora — o link não aparece de novo. Se perder, convide a pessoa outra vez.
              </p>
            </div>
          ) : (
            <form action={acao}>
              <div className={estilos['corpoDoDialogo']}>
                <Field
                  id="email-do-convite"
                  name="email"
                  label="E-mail"
                  type="email"
                  autoComplete="off"
                  required
                  defaultValue={estado.valores?.email ?? ''}
                  data-testid="campo-email-do-convite"
                />

                <SelectField
                  id="papel-do-convite"
                  name="roleId"
                  label="Papel"
                  required
                  defaultValue={estado.valores?.roleId ?? ''}
                  data-testid="campo-papel-do-convite"
                >
                  {/*
                    Sem opção em branco: o papel é obrigatório, e um valor
                    vazio pré-selecionado só produz o erro `roleId` inválido
                    depois do envio.
                  */}
                  {papeis.map((papel) => (
                    <option key={papel.id} value={papel.id}>
                      {papel.name}
                    </option>
                  ))}
                </SelectField>

                <p className={estilos['notaDoDialogo']} role="note">
                  O convite vale por 24 horas. Não há envio de e-mail: o link aparece aqui e você
                  o entrega à pessoa.
                </p>
              </div>

              <div className={estilos['rodapeDoDialogo']}>
                <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                  Cancelar
                </Button>
                <BotaoDeConvite />
              </div>
            </form>
          )}

          {convite ? (
            <div className={estilos['rodapeDoDialogo']}>
              <Button type="button" onClick={() => setAberto(false)}>
                Fechar
              </Button>
            </div>
          ) : null}
        </div>
      </dialog>
    </>
  );
}
