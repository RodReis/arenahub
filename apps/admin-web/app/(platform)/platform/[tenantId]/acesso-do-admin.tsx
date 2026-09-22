'use client';

import { useState } from 'react';

import {
  Button,
  ConfirmDialog,
  EstadoSimples,
  Field,
  SectionCard,
  TenantDateTime,
  useToastDeErro,
} from '@arenahub/ui';

import estilos from '../../../formulario.module.css';
import proprios from './cliente.module.css';

import {
  convidarAdminDoTenant,
  revogarConviteDeAdmin,
  type EstadoDoConviteDeAdmin,
} from '../../../actions/platform';

interface Props {
  readonly tenantId: string;
  readonly timezone: string;
  readonly estado: 'ATIVO' | 'PENDENTE' | 'VENCIDO' | 'SEM_CONVITE';
  readonly email: string | null;
  readonly desde: string | null;
  readonly expiraEm: string | null;
}

/**
 * O acesso do Admin da academia — F79.
 *
 * A PERGUNTA DESTA ABA É UMA SÓ: o administrador consegue entrar? Até aqui ela
 * não tinha resposta em lugar nenhum. O convite nasce junto do tenant, vale 24
 * horas e não havia como reenviá-lo — cliente que demorasse dois dias ficava
 * trancado fora da própria academia, e o único conserto era escrever no banco.
 *
 * QUATRO ESTADOS, TRÊS ATOS. O estado manda: quem já entrou não tem botão
 * nenhum (não há o que consertar), e quem nunca foi convidado só tem um. Os
 * atos não aparecem porque existem na API — aparecem quando fazem sentido.
 *
 * CORRIGIR O E-MAIL FICA ATRÁS DE UM BOTÃO, e o campo não nasce aberto. O
 * reenvio é o caso comum e não pede digitar nada; deixar o endereço editável o
 * tempo todo convidaria a trocá-lo quando a intenção era só mandar de novo.
 */
export function AcessoDoAdmin(props: Props) {
  const [corrigindo, setCorrigindo] = useState(false);
  const [revogando, setRevogando] = useState(false);
  const [emailNovo, setEmailNovo] = useState('');
  const [resultado, setResultado] = useState<EstadoDoConviteDeAdmin>({});

  useToastDeErro(resultado.erro, 'error', 'erro-do-acesso');

  const ativo = props.estado === 'ATIVO';
  const semConvite = props.estado === 'SEM_CONVITE';
  const vencido = props.estado === 'VENCIDO';

  const enviar = (email: string): void => {
    const dados = new FormData();

    dados.set('tenantId', props.tenantId);
    dados.set('email', email);

    setCorrigindo(false);
    setEmailNovo('');
    void convidarAdminDoTenant({}, dados).then(setResultado);
  };

  const revogar = (motivo: string): void => {
    const dados = new FormData();

    dados.set('tenantId', props.tenantId);
    dados.set('reason', motivo);

    setRevogando(false);
    void revogarConviteDeAdmin({}, dados).then(setResultado);
  };

  return (
    <SectionCard
      title="Acesso do administrador"
      icon="user-check"
      summary={
        ativo
          ? 'O administrador desta academia já entrou e gerencia a própria equipe.'
          : 'O administrador entra por convite e, a partir daí, cria os próprios usuários.'
      }
      testId="acesso-do-admin"
    >
      <div className={proprios['situacao']}>
        <p className={proprios['estado-atual']} data-testid="estado-do-admin">
          <span className={estilos['nota']}>Situação</span>
          {ativo ? <EstadoSimples label="Ativo" tom="positivo" /> : null}
          {props.estado === 'PENDENTE' ? (
            <EstadoSimples label="Convite pendente" tom="atencao" />
          ) : null}
          {vencido ? <EstadoSimples label="Convite vencido" tom="negativo" /> : null}
          {semConvite ? <EstadoSimples label="Sem convite" tom="neutro" /> : null}
        </p>

        {props.email === null ? (
          <p className={estilos['nota']} data-testid="admin-sem-email">
            Ninguém foi convidado para administrar esta academia.
          </p>
        ) : (
          <p className={estilos['nota']} data-testid="email-do-admin">
            {props.email}
          </p>
        )}

        {/*
          A DATA DIZ O QUE O RÓTULO NÃO DIZ: "pendente" sem prazo não informa se
          há três horas ou três minutos para agir. `TenantDateTime` no fuso da
          academia, nunca `Intl` cru — o lint recusa, e o fuso de quem lê não é
          necessariamente o de quem opera.
        */}
        {ativo && props.desde !== null ? (
          <p className={estilos['nota']} data-testid="admin-desde">
            Entrou em <TenantDateTime iso={props.desde} timeZone={props.timezone} />
          </p>
        ) : null}

        {props.estado === 'PENDENTE' && props.expiraEm !== null ? (
          <p className={estilos['nota']} data-testid="convite-expira">
            O convite vale até <TenantDateTime iso={props.expiraEm} timeZone={props.timezone} />
          </p>
        ) : null}

        {vencido && props.expiraEm !== null ? (
          <p className={estilos['nota']} data-testid="convite-venceu">
            O convite venceu em <TenantDateTime iso={props.expiraEm} timeZone={props.timezone} /> e
            o link não funciona mais. Reenvie para gerar um novo.
          </p>
        ) : null}

        {/*
          AVISO QUE NÃO SE PODE OMITIR: com o provedor de e-mail fora, o convite
          existe e o link vale, mas ninguém o recebeu. Silêncio aqui faria a
          academia esperar por um e-mail que não saiu.
        */}
        {resultado.convidado ? (
          <p
            /*
              O TOM SEGUE O QUE ACONTECEU: entrega feita é sucesso; convite
              criado sem e-mail é aviso, porque sobra trabalho para quem leu.
            */
            className={
              resultado.convidado.emailEnviado ? proprios['salvo'] : proprios['aviso']
            }
            role="status"
            data-testid="convite-enviado"
          >
            {resultado.convidado.emailEnviado
              ? `Convite enviado para ${resultado.convidado.email}.`
              : `Convite criado para ${resultado.convidado.email}, mas o e-mail não saiu. Avise o administrador por outro canal.`}
          </p>
        ) : null}

        {resultado.revogado ? (
          <p className={proprios['salvo']} role="status" data-testid="convite-revogado">
            Convite revogado. O link parou de valer.
          </p>
        ) : null}

        {ativo ? (
          /*
            NENHUM ATO, e a ausência é o desenho: o administrador entrou, e
            trocar o e-mail dele agora é alteração de conta — outra tela, outro
            assunto. Um botão aqui prometeria algo que a API recusa com 409.
          */
          <p className={estilos['nota']} data-testid="admin-sem-acao">
            A partir daqui, a equipe da academia é gerenciada por ele, dentro do painel dela.
          </p>
        ) : (
          <>
            {corrigindo ? (
              <div className={proprios['correcao']}>
                <Field
                  id="email-do-admin"
                  name="emailNovo"
                  label="E-mail do administrador"
                  type="email"
                  value={emailNovo}
                  onChange={(evento) => setEmailNovo(evento.target.value)}
                  hint="O convite anterior é revogado e um novo link é enviado para este endereço."
                  data-testid="campo-email-do-admin"
                />

                <div className={estilos['acoes']}>
                  <Button
                    onClick={() => enviar(emailNovo)}
                    disabled={emailNovo.trim() === ''}
                    data-testid="salvar-email-do-admin"
                  >
                    Enviar convite
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCorrigindo(false);
                      setEmailNovo('');
                    }}
                    data-testid="cancelar-email-do-admin"
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className={estilos['acoes']}>
                {semConvite ? (
                  <Button onClick={() => setCorrigindo(true)} data-testid="criar-convite-de-admin">
                    Convidar administrador
                  </Button>
                ) : (
                  <>
                    {/*
                      VERBO REAL, nunca "OK" (DS-PAINEL §6). "Reenviar convite"
                      diz o que acontece; o resumo do card não precisa ser
                      relido para entender o botão.
                    */}
                    <Button onClick={() => enviar('')} data-testid="reenviar-convite-de-admin">
                      Reenviar convite
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setCorrigindo(true)}
                      data-testid="corrigir-email-do-admin"
                    >
                      Corrigir e-mail
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setRevogando(true)}
                      data-testid="revogar-convite-de-admin"
                    >
                      Revogar convite
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/*
        REVOGAR PEDE CONFIRMAÇÃO pelo mesmo motivo que desligar o cliente pede:
        tira o acesso de alguém e não se desfaz — o link antigo morre, e o
        caminho de volta é convidar de novo.
      */}
      <ConfirmDialog
        open={revogando}
        verb="Revogar convite"
        summary="O link enviado ao administrador para de valer imediatamente. Para dar acesso de novo, será preciso convidá-lo outra vez."
        onConfirm={revogar}
        onCancel={() => setRevogando(false)}
        testId="dialogo-de-revogacao"
      />
    </SectionCard>
  );
}
