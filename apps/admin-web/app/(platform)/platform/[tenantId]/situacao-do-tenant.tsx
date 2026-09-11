'use client';

import { useState } from 'react';

import {
  Button,
  ConfirmDialog,
  EstadoSimples,
  SectionCard,
  useToastDeErro,
} from '@arenahub/ui';

import estilos from '../../../formulario.module.css';
import proprios from './cliente.module.css';

import { alternarStatusDoTenant, type EstadoDoStatus } from '../../../actions/platform';

interface Props {
  readonly tenantId: string;
  readonly status: string;
}

/**
 * Situação do cliente — ato com motivo auditado, separado da edição cadastral.
 *
 * ABA PRÓPRIA e não um campo do formulário de cadastro: corrigir um CNPJ e
 * desligar um cliente não podem compartilhar o mesmo botão "Salvar". Quem
 * desliga escreve por quê, e o motivo vai para a auditoria da plataforma.
 *
 * A CONFIRMAÇÃO VIRA DIÁLOGO na F68. O motivo era um `<textarea>` sempre
 * visível ao lado de um botão vermelho: quem rolava a página encontrava os
 * dois sem ter pedido, e o ato ficava a um clique de distância de quem só
 * passava por ali. Agora o botão abre o `SensitiveAction` — o mesmo padrão da
 * revogação de biometria e do estorno —, e o motivo continua obrigatório.
 *
 * `SUSPENDED` NÃO APARECE, e a ausência é o desenho: quem escreve suspensão é
 * a inadimplência (F65). Oferecê-la aqui deixaria o painel fabricar uma
 * suspensão que a cobrança não conhece — e que a cobrança não saberia levantar.
 */
export function SituacaoDoTenant({ tenantId, status }: Props) {
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoDoStatus>({});

  useToastDeErro(estado.erro, 'error', 'erro-da-situacao');

  const inativando = status === 'ACTIVE';
  const suspensa = status === 'SUSPENDED';

  const aplicar = (motivo: string): void => {
    const dados = new FormData();

    dados.set('tenantId', tenantId);
    dados.set('status', inativando ? 'INACTIVE' : 'ACTIVE');
    dados.set('reason', motivo);

    setConfirmando(false);
    void alternarStatusDoTenant({}, dados).then(setEstado);
  };

  return (
    <SectionCard
      title="Situação do cliente"
      icon="power"
      /*
        O TOM DE PERIGO só quando o ato disponível é destrutivo. Num cliente já
        inativo a ação é reativar, que não destrói nada — pintar o card de
        vermelho ali gastaria o sinal que o caso real precisa.
      */
      tom={inativando ? 'perigo' : 'neutro'}
      summary={
        inativando
          ? 'Cliente inativo não libera catraca nem é cobrado. Os dados permanecem, e a reativação devolve tudo.'
          : 'Reativar devolve o cliente à operação normal.'
      }
      testId="situacao-do-tenant"
    >
      <div className={proprios['situacao']}>
        <p className={proprios['estado-atual']} data-testid="situacao-atual">
          <span className={estilos['nota']}>Situação atual</span>
          {status === 'ACTIVE' ? <EstadoSimples label="Ativo" tom="positivo" /> : null}
          {suspensa ? <EstadoSimples label="Suspenso" tom="atencao" /> : null}
          {status === 'INACTIVE' ? <EstadoSimples label="Inativo" tom="neutro" /> : null}
        </p>

        {suspensa ? (
          /*
            Suspensão é da cobrança, e reativar aqui esconderia a dívida em vez
            de resolvê-la. Dizer isso é mais útil que um botão que a API
            recusaria.
          */
          <p className={estilos['nota']} data-testid="situacao-da-cobranca">
            Este cliente está suspenso por inadimplência. A situação volta ao normal pela cobrança,
            não por aqui.
          </p>
        ) : (
          <>
            {estado.salvo ? (
              <p className={proprios['salvo']} role="status" data-testid="situacao-alterada">
                Situação alterada.
              </p>
            ) : null}

            <div className={estilos['acoes']}>
              {/*
                VERBO REAL, nunca "OK" (DS-PAINEL §6): quem lê o botão tem de
                saber o que vai acontecer sem reler o resumo. `destructive` só
                ao desligar -- reativar não destrói nada.
              */}
              <Button
                variant={inativando ? 'destructive' : 'solid'}
                onClick={() => setConfirmando(true)}
                data-testid="confirmar-situacao"
              >
                {inativando ? 'Inativar cliente' : 'Reativar cliente'}
              </Button>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmando}
        verb={inativando ? 'Inativar cliente' : 'Reativar cliente'}
        summary={
          inativando
            ? 'A catraca deixa de liberar e a cobrança para. Os dados permanecem, e a reativação devolve tudo.'
            : 'O cliente volta à operação normal: catraca liberada e cobrança retomada.'
        }
        onConfirm={aplicar}
        onCancel={() => setConfirmando(false)}
        testId="dialogo-de-situacao"
      />
    </SectionCard>
  );
}
