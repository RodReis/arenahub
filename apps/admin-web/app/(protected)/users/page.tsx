import type { Metadata } from 'next';

import {
  Ausente,
  DataTable,
  EmptyState,
  EstadoSimples,
  Identidade,
  PageHeader,
  ProblemDetail,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { rotuloDePerfil } from '../../../src/iam/rotulos';
import { ConvidarUsuario, type Papel } from './convidar-usuario';
import { RevogarAcesso } from './revogar-acesso';

export const metadata: Metadata = {
  title: 'Usuários — ArenaHub',
};

interface Usuario {
  id: string;
  email: string;
  status: string;
  mfaStatus: string;
  /*
   * Os papéis da pessoa NESTA academia (F80). Lista e não string: o schema
   * permite mais de um por pessoa, e mostrar só o primeiro esconderia acesso
   * que existe.
   */
  papeis: string[];
}

/**
 * Usuários do painel — issue #274.
 *
 * A API tinha `GET /users` e `POST /users/invitations` sem nenhum chamador:
 * criar um administrador exigia `curl` com um `roleId` descoberto direto no
 * banco. Esta tela dá o caminho normal.
 *
 * NÃO HÁ EDIÇÃO NEM REMOÇÃO, e a ausência é deliberada: a API não tem rota
 * para nenhuma das duas, e um botão que leva a 404 é pior que botão nenhum.
 */
export default async function PaginaDeUsuarios() {
  /*
   * As duas em paralelo: a lista é o conteúdo, os papéis alimentam o modal
   * de convite. Em série, toda visita pagaria os dois tempos de rede para
   * desenhar uma tela só.
   */
  const [resposta, respostaDePapeis] = await Promise.all([
    chamarApi<Usuario[]>('/api/v1/users'),
    chamarApi<Papel[]>('/api/v1/roles'),
  ]);

  if (!resposta.ok) {
    /*
     * Negação explícita, com o código estável visível. Tela vazia deixaria
     * quem abriu sem saber se não há usuário ou se ele não tem `user.manage`
     * -- e a segunda hipótese é a provável, porque a permissão é rara.
     */
    return (
      <section aria-labelledby="titulo-usuarios">
        <PageHeader id="titulo-usuarios" title="Usuários" />
        <ProblemDetail
          testId="erro-de-permissao"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Sem permissão para ver os usuários (${resposta.erro?.code ?? 'erro'}).`,
          }}
        />
      </section>
    );
  }

  const usuarios = resposta.dados ?? [];
  const papeis = respostaDePapeis.dados ?? [];

  return (
    <section aria-labelledby="titulo-usuarios">
      <PageHeader
        id="titulo-usuarios"
        title="Usuários"
        breadcrumb={<span>Administração</span>}
        /*
          O botão só aparece com papel para escolher. Sem papel, o convite
          seria recusado pela API por `roleId` ausente -- e a recepção veria
          um formulário com um combo vazio, sem entender o que falta.
        */
        actions={papeis.length > 0 ? <ConvidarUsuario papeis={papeis} /> : null}
      />

      <DataTable
        testId="tabela-de-usuarios"
        rows={usuarios}
        rowKey={(usuario) => usuario.id}
        caption="Usuários com acesso ao painel"
        columns={[
          {
            key: 'email',
            header: 'E-mail',
            role: 'identity',
            /*
              `semAvatar`: a inicial num círculo daria a cada linha um rosto
              que ela não tem -- o painel conhece o e-mail, não a pessoa. Não
              há campo de nome em `User`.
            */
            render: (u) => <Identidade semAvatar nome={u.email} />,
          },
          {
            key: 'perfil',
            header: 'Perfil',
            /*
              O QUE A LISTA NÃO DIZIA ATÉ A F80: quem é quem. Com um papel só
              no sistema (), a coluna teria sido ruído; com cinco, ela
              é a informação que decide se alguém precisa ser revogado.

              Rótulo em pt-BR pelo mapa único de . Sem papel
              nenhum é estado real (vínculo criado, papel ainda não), e um
              traço diz isso melhor que célula vazia.
            */
            render: (u) =>
              u.papeis.length === 0 ? (
                <Ausente />
              ) : (
                <>{u.papeis.map((papel) => rotuloDePerfil(papel)).join(', ')}</>
              ),
          },
          {
            key: 'situacao',
            header: 'Situação',
            role: 'state',
            /*
              `EstadoSimples` e não `StateBadge`: o `CONVENTION.md` §7 define
              as máquinas de estado do domínio e NENHUMA é de usuário.
              Inventar `machine="user"` no dicionário canônico seria decisão
              de produto, e ela não é minha.

              Texto, não só cor: `M1-NFR-008` exige WCAG 2.2 AA.
            */
            render: (u) =>
              u.status === 'ACTIVE' ? (
                <EstadoSimples label="Ativo" tom="positivo" />
              ) : (
                <EstadoSimples label="Inativo" tom="neutro" />
              ),
          },
          {
            key: 'mfa',
            header: 'MFA',
            role: 'state',
            /*
              MFA PENDENTE NÃO É ERRO -- é o estado normal de quem acabou de
              aceitar o convite e ainda não abriu o painel. Marcar em vermelho
              ensinaria a recepção a ignorar o vermelho.
            */
            render: (u) =>
              u.mfaStatus === 'ENABLED' ? (
                <EstadoSimples label="Ativado" tom="positivo" />
              ) : (
                <EstadoSimples label="Pendente" tom="neutro" />
              ),
          },
          {
            key: 'acoes',
            header: 'Ações',
            role: 'actions',
            render: (u) => <RevogarAcesso userId={u.id} email={u.email} />,
          },
        ]}
        empty={
          <EmptyState
            testId="lista-vazia"
            title="Nenhum usuário com acesso ao painel."
            hint="Convide alguém para dar acesso — o convite vale por 24 horas."
          />
        }
      />
    </section>
  );
}
