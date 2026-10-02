import type { Metadata } from 'next';
import { headers } from 'next/headers';
import QRCode from 'qrcode';

import {
  Breadcrumb,
  EmptyState,
  Icon,
  PageHeader,
  ProblemDetail,
  SectionCard,
  TenantDateTime,
} from '@arenahub/ui';

import { chamarApi } from '../../../lib/api/server-client';
import { rotuloDePerfil } from '../../../src/iam/rotulos';
import estilos from './aplicativo.module.css';
import { CopiarLink } from './copiar-link';
import { FormularioDoInstalador } from './formulario-do-instalador';
import { montarMensagem } from './mensagem';
import { MensagemParaAluno } from './mensagem-para-aluno';
import { QrAmpliavel } from './qr-ampliavel';

export const metadata: Metadata = {
  title: 'Aplicativo — ArenaHub',
};

export const dynamic = 'force-dynamic';

/** Fuso FIXO, o mesmo da ficha do aluno -- mesma divida das outras telas. */
const FUSO_PROVISORIO = 'America/Sao_Paulo';

interface Instalador {
  androidUrl: string | null;
  androidVersion: string | null;
  updatedAt: string | null;
  updatedByEmail: string | null;
  updatedByRole: string | null;
  shortSlug: string | null;
  messageTemplate: string | null;
  academia: string;
  slugSugerido: string;
}

/**
 * Endereco publico do painel, de onde o aluno abre o link curto. Vem do
 * proprio pedido (o proxy da Railway manda `x-forwarded-*`): o mesmo codigo
 * monta `localhost:3000` em dev e o dominio de producao la, sem variavel nova.
 */
async function origemPublica(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const protocolo = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  return `${protocolo}://${host}`;
}

/**
 * Aplicativo -- issue #534. A recepcao mostra o QR ao aluno (ou manda o link);
 * quem administra a equipe troca o link a cada build novo.
 *
 * O QR sai do servidor, como o do 2FA: nenhuma biblioteca de QR vai para o
 * bundle do navegador. Preto sobre branco em qualquer tema -- leitor de camera
 * falha com QR invertido.
 */
export default async function PaginaDoAplicativo() {
  const [resposta, perfil] = await Promise.all([
    chamarApi<Instalador>('/api/v1/app-distribution'),
    chamarApi<{ permissions?: string[] }>('/api/v1/auth/me'),
  ]);

  const cabecalho = (
    <PageHeader
      id="titulo-aplicativo"
      title="Aplicativo"
      breadcrumb={<Breadcrumb trilha={[{ rotulo: 'Administração' }, { rotulo: 'Aplicativo' }]} />}
    />
  );

  if (!resposta.ok || !resposta.dados) {
    return (
      <section aria-labelledby="titulo-aplicativo">
        {cabecalho}
        <ProblemDetail
          testId="erro-do-instalador"
          problem={{
            ...(resposta.erro ?? {
              type: 'about:blank',
              status: 0,
              code: 'erro',
              correlationId: '',
            }),
            title: `Não foi possível carregar o instalador (${resposta.erro?.code ?? 'erro'}). Recarregue a página.`,
          }}
        />
      </section>
    );
  }

  const {
    androidUrl,
    androidVersion,
    updatedAt,
    updatedByEmail,
    updatedByRole,
    shortSlug,
    messageTemplate,
    academia,
    slugSugerido,
  } = resposta.dados;
  const podeSalvar = perfil.dados?.permissions?.includes('user.manage') ?? false;
  const origem = await origemPublica();
  const prefixoDoLink = `${origem.replace(/^https?:\/\//, '')}/baixar/`;
  /*
   * O QR e a mensagem usam o LINK CURTO quando existe: menos denso (a camera
   * le de mais longe) e nao muda entre builds -- um QR impresso no balcao
   * continua valendo. Sem final reservado ainda, cai no APK direto.
   */
  const linkCurto = shortSlug ? `${origem}/baixar/${shortSlug}` : null;
  const linkDoAluno = linkCurto ?? androidUrl;
  const qrSvg = linkDoAluno
    ? await QRCode.toString(linkDoAluno, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
    : null;
  const mensagem = linkDoAluno ? montarMensagem(messageTemplate, { link: linkDoAluno, academia }) : null;

  return (
    <section aria-labelledby="titulo-aplicativo">
      {cabecalho}

      <div className={estilos['layout']}>
        <div className={estilos['coluna']}>
          <SectionCard
            title="Instalador Android"
            icon="qr-code"
            summary="Mostre o QR ao aluno no balcão ou envie o link."
          >
            {androidUrl && qrSvg && linkDoAluno ? (
              <div className={estilos['principal']}>
                {/*
                  O PALCO DO QR: o unico lugar da tela com accent do tenant.
                  E o artefato que a recepcao vira para o aluno -- o resto da
                  ficha so o explica. `key` pela URL: trocar o link remonta o
                  palco e o QR novo "imprime" de cima para baixo (aplicativo
                  .module.css), que e exatamente o que aconteceu.
                */}
                <div className={estilos['palco']} key={linkDoAluno}>
                  <QrAmpliavel svg={qrSvg} link={linkDoAluno} />
                </div>

                <div className={estilos['informacao']}>
                  <ul className={estilos['chips']} aria-label="Situação do instalador">
                    <li className={estilos['chipPublicado']} data-testid="instalador-publicado">
                      <span className={estilos['ponto']} aria-hidden="true" />
                      No totem
                    </li>
                    <li className={estilos['chip']}>Android</li>
                    <li className={estilos['chip']}>APK</li>
                  </ul>

                  <p className={estilos['versao']} data-testid="versao-do-instalador">
                    {androidVersion ? `Versão ${androidVersion}` : 'Versão não informada'}
                  </p>
                  {updatedAt ? (
                    <p className={estilos['autoria']} data-testid="autoria-do-instalador">
                      <Icon name="clock" />
                      <span>
                        Atualizado em{' '}
                        <TenantDateTime iso={updatedAt} timeZone={FUSO_PROVISORIO} format="datetime" />
                        {updatedByEmail
                          ? ` por ${updatedByEmail}${updatedByRole ? ` (${rotuloDePerfil(updatedByRole)})` : ''}`
                          : ''}
                      </span>
                    </p>
                  ) : null}

                  <div className={estilos['blocoDoLink']}>
                    <span className={estilos['rotuloDoLink']} id="rotulo-do-link">
                      {linkCurto ? 'Link para o aluno' : 'Link do APK'}
                    </span>
                    <div className={estilos['linhaDoLink']}>
                      <p
                        className={estilos['link']}
                        data-testid="link-do-instalador"
                        title={linkDoAluno}
                        aria-labelledby="rotulo-do-link"
                      >
                        {linkDoAluno}
                      </p>
                      <CopiarLink url={linkDoAluno} />
                    </div>
                    <p className={estilos['dicaDoLink']}>
                      {linkCurto ? (
                        <>
                          Leva sempre ao APK atual — o QR e a mensagem não mudam quando o build for
                          trocado.
                        </>
                      ) : (
                        <>Defina o final do link ao lado para ter um link curto que não muda.</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                testId="sem-instalador"
                title="Nenhum instalador configurado."
                hint={
                  podeSalvar
                    ? 'Cole ao lado o link do build atual. Enquanto não houver link, o totem não mostra o botão “Baixar o app”.'
                    : 'Peça a quem administra a equipe para colar o link do build atual.'
                }
              />
            )}
          </SectionCard>

          {mensagem ? (
            <SectionCard
              title="Mensagem para o aluno"
              icon="message-circle"
              summary="Copie e envie, ou abra direto no WhatsApp."
            >
              <MensagemParaAluno mensagem={mensagem} />
            </SectionCard>
          ) : null}

          <div className={estilos['aviso']} role="note">
            <span className={estilos['avisoIcone']}>
              <Icon name="alert-circle" />
            </span>
            <p className={estilos['avisoTexto']}>
              Para instalar o APK, o celular do aluno precisa permitir{' '}
              <strong>instalar apps desconhecidos</strong>. O Android pede essa autorização na
              primeira instalação, para o navegador ou gerenciador de arquivos usado.
            </p>
          </div>
        </div>

        {podeSalvar ? (
          <SectionCard
            title="Atualizar link"
            icon="pencil"
            summary="Só Dono e Gerente alteram. A recepção vê o QR e copia o link."
          >
            <FormularioDoInstalador
              androidUrl={androidUrl}
              androidVersion={androidVersion}
              shortSlug={shortSlug ?? slugSugerido}
              messageTemplate={messageTemplate}
              prefixoDoLink={prefixoDoLink}
            />
          </SectionCard>
        ) : null}
      </div>
    </section>
  );
}
