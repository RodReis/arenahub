'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, SelectField, useToastDeErro } from '@arenahub/ui';

import estilos from '../dialogo.module.css';

import { convidarUsuario, type EstadoDoConvite } from '../../actions/usuarios';
import { ROTULO_DE_PERFIL, ordenarPerfis, rotuloDePerfil } from '../../../src/iam/rotulos';
import { LinkDoConvite } from './link-do-convite';

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
export function ConvidarUsuario({ papeis: recebidos }: Props) {
  /*
    DO MAIS AMPLO AO MAIS ESTREITO, e nao alfabetico: a API ordena por `name`,
    que e o codigo em ingles, e em portugues isso vira "Financeiro, Gerente,
    Dono..." -- com "Financeiro" pre-selecionado. Quem convidasse sem prestar
    atencao daria o painel financeiro a recepcao.
  */
  const papeis = ordenarPerfis(recebidos);

  const [aberto, setAberto] = useState(false);
  /*
    O COMBO É CONTROLADO (F80) porque a descrição abaixo dele depende do que
    está escolhido -- com `defaultValue`, a tela não saberia o que mostrar.
    Nasce no primeiro perfil da lista, que é a ordem de `PAPEIS_DE_SISTEMA`
    (do mais amplo ao mais estreito) e nunca vazio: papel é obrigatório.
  */
  const [perfil, setPerfil] = useState(papeis[0]?.id ?? '');
  const [estado, acao] = useActionState(convidarUsuario, ESTADO_INICIAL);
  const dialogo = useRef<HTMLDialogElement>(null);

  useToastDeErro(estado.erro, 'error', 'erro-do-convite');

  // O texto do perfil selecionado. Papel herdado de antes da F80 não está no
  // mapa, e aí não há frase a mostrar -- melhor nada que uma inventada.
  const descricao = ROTULO_DE_PERFIL[papeis.find((p) => p.id === perfil)?.name ?? '']?.descricao;

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
              {/*
                A FRASE MUDA CONFORME O E-MAIL SAIU (issue #277), e o link
                aparece NOS DOIS CASOS.
                ---------------------------------------------------------------
                Mesmo com o e-mail entregue, o link continua na tela: e-mail
                cai em spam, demora e chega a caixa errada, e o convite tem 24
                horas. Esconde-lo porque "ja foi enviado" trocaria um caminho
                que funciona por um que depende de terceiro.
              */}
              {convite.emailEnviado ? (
                <p className={estilos['notaDoDialogo']} data-testid="convite-enviado-por-email">
                  Convite enviado para <strong>{convite.email}</strong>. Ele vale por 24 horas.
                  Se a pessoa não receber, entregue o link abaixo.
                </p>
              ) : (
                <p className={estilos['notaDoDialogo']} data-testid="convite-sem-email">
                  <strong>O e-mail não saiu</strong> — envie este link para{' '}
                  <strong>{convite.email}</strong>. Ele vale por 24 horas e permite definir a
                  senha de acesso.
                </p>
              )}

              {/*
                O LINK MONTA A URL NO CLIENTE (issue #276): aqui só se sabe o
                caminho. Ver `LinkDoConvite` para por que o servidor não pode
                montá-la e o cliente pode.
              */}
              <LinkDoConvite caminho={`/convite/${convite.token}`} />

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
                  label="Perfil"
                  required
                  value={perfil}
                  onChange={(evento) => setPerfil(evento.target.value)}
                  data-testid="campo-papel-do-convite"
                >
                  {/*
                    Sem opção em branco: o papel é obrigatório, e um valor
                    vazio pré-selecionado só produz o erro `roleId` inválido
                    depois do envio.

                    RÓTULO EM pt-BR (F80): até aqui o combo mostrava o código
                    cru -- `RECEPTION`, `TRAINER` --, que era tolerável com uma
                    opção só e vira escolha às cegas com cinco.
                  */}
                  {papeis.map((papel) => (
                    <option key={papel.id} value={papel.id}>
                      {rotuloDePerfil(papel.name)}
                    </option>
                  ))}
                </SelectField>

                {/*
                  O QUE O PERFIL ESCOLHIDO PERMITE, em uma linha.

                  O nome sozinho não decide: "Recepção" e "Financeiro" soam
                  igualmente plausíveis para quem vai mexer com mensalidade, e
                  a diferença entre os dois é justamente quem enxerga o painel
                  financeiro da academia inteira.
                */}
                {descricao ? (
                  <p className={estilos['dica']} data-testid="descricao-do-perfil">
                    {descricao}
                  </p>
                ) : null}

                {/*
                  A FRASE NÃO PROMETE O E-MAIL (issue #277): ele depende de
                  chave configurada e domínio verificado no provedor, e a
                  tela só sabe se saiu DEPOIS de convidar. Prometer aqui e
                  desmentir depois é pior que não prometer.
                */}
                <p className={estilos['notaDoDialogo']} role="note">
                  O convite vale por 24 horas. O link aparece aqui depois de convidar — e também
                  vai por e-mail, quando o envio estiver configurado.
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
