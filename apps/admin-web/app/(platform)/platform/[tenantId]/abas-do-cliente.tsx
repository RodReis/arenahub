'use client';

import { Tabs } from '@arenahub/ui';

import estilos from './cliente.module.css';

import { AcessoDoAdmin } from './acesso-do-admin';
import { ArquivosDaMarca } from './arquivos-da-marca';
import { ElevarTenant } from './elevar-tenant';
import { FormularioDeEdicao } from './formulario-de-edicao';
import { SituacaoDoTenant } from './situacao-do-tenant';

interface Props {
  readonly tenantId: string;
  readonly slug: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly cnpj: string;
  readonly timezone: string;
  readonly responsavelNome: string;
  readonly responsavelEmail: string;
  readonly missionText: string;
  readonly highlightsText: string;
  readonly temLogo: boolean;
  readonly temIcone: boolean;
  readonly status: string;
  /*
    Estado do Admin (F79). Vem ACHATADO da pagina, com `null` onde o campo nao
    se aplica -- e a mesma forma que a API devolve, e evita que esta camada
    tenha de remontar a uniao discriminada so para repassa-la.
  */
  readonly acessoDoAdmin: {
    estado: 'ATIVO' | 'PENDENTE' | 'VENCIDO' | 'SEM_CONVITE';
    email: string | null;
    desde: string | null;
    expiraEm: string | null;
  };
}

/**
 * As quatro seções do cliente, em abas — F68.
 *
 * ANTES ERAM QUATRO BLOCOS EMPILHADOS, e o defeito não era o comprimento: era
 * que a rolagem punha o ato mais perigoso da tela (desligar o cliente) no
 * lugar mais difícil de alcançar e, ao mesmo tempo, no caminho de quem só
 * queria corrigir um CNPJ. Quem rolava para conferir a missão passava por um
 * botão vermelho e um campo de motivo vazio.
 *
 * QUATRO ABAS PORQUE SÃO QUATRO ASSUNTOS, não porque quatro é um bom número:
 * cadastro (o que o cliente é), marca (como ele aparece), situação (se ele
 * opera) e suporte (entrar no lugar dele). Cada um tem gravidade própria e
 * botão próprio — foi a razão de já serem quatro formulários separados.
 *
 * `'use client'` AQUI E NÃO NA PÁGINA: a página continua Server Component e
 * busca os dados; este componente só arranja o que ela já trouxe. Os quatro
 * filhos já eram Client Components com Server Action própria.
 */
export function AbasDoCliente(props: Props) {
  return (
    <Tabs
      label="Seções do cliente"
      testId="abas-do-cliente"
      abas={[
        {
          id: 'dados',
          label: 'Dados do cliente',
          icon: 'building',
          content: (
            <FormularioDeEdicao
              tenantId={props.tenantId}
              slug={props.slug}
              displayName={props.displayName}
              legalName={props.legalName}
              cnpj={props.cnpj}
              timezone={props.timezone}
              responsavelNome={props.responsavelNome}
              responsavelEmail={props.responsavelEmail}
              missionText={props.missionText}
              highlightsText={props.highlightsText}
            />
          ),
        },
        {
          id: 'layout',
          label: 'Layout',
          icon: 'image',
          /*
            O CONTADOR DIZ O QUE FALTA sem abrir a aba: "0/2" é a única
            informação desta seção que importa de fora dela, e é a que manda
            alguém entrar. Contador de peças ENVIADAS, não de peças possíveis.
          */
          contador: (props.temLogo ? 1 : 0) + (props.temIcone ? 1 : 0),
          content: (
            <div className={estilos['painel']}>
            <ArquivosDaMarca
              tenantId={props.tenantId}
              slug={props.slug}
              temLogo={props.temLogo}
              temIcone={props.temIcone}
            />
            </div>
          ),
        },
        {
          id: 'situacao',
          label: 'Situação',
          icon: 'power',
          content: (
            <div className={estilos['painel']}>
              <SituacaoDoTenant tenantId={props.tenantId} status={props.status} />
            </div>
          ),
        },
        {
          /*
            ACESSO ANTES DE SUPORTE, e a ordem e o argumento: entrar como
            suporte e o ultimo recurso; a pergunta que vem antes dele e se o
            administrador da academia consegue entrar sozinho.
          */
          id: 'acesso',
          label: 'Acesso',
          icon: 'user-check',
          content: (
            <div className={estilos['painel']}>
              <AcessoDoAdmin
                tenantId={props.tenantId}
                timezone={props.timezone}
                estado={props.acessoDoAdmin.estado}
                email={props.acessoDoAdmin.email}
                desde={props.acessoDoAdmin.desde}
                expiraEm={props.acessoDoAdmin.expiraEm}
              />
            </div>
          ),
        },
        {
          id: 'contato',
          label: 'Suporte',
          icon: 'shield',
          content: (
            <div className={estilos['painel']}>
              <ElevarTenant tenantId={props.tenantId} displayName={props.displayName} />
            </div>
          ),
        },
      ]}
    />
  );
}
