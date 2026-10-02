import type { Metadata } from 'next';
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

  const { androidUrl, androidVersion, updatedAt, updatedByEmail, updatedByRole } = resposta.dados;
  const podeSalvar = perfil.dados?.permissions?.includes('user.manage') ?? false;
  const qrSvg = androidUrl
    ? await QRCode.toString(androidUrl, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' })
    : null;

  return (
    <section aria-labelledby="titulo-aplicativo">
      {cabecalho}

      <div className={estilos['layout']}>
        <div className={estilos['coluna']}>
          <SectionCard
            title="Instalador Android"
            icon="qr-code"
            summary="Mostre o QR ao aluno ou envie o link."
            actions={
              updatedAt ? (
                <span className={estilos['horario']}>
                  <Icon name="clock" />
                  Atualizado às{' '}
                  <TenantDateTime iso={updatedAt} timeZone={FUSO_PROVISORIO} format="time" />
                </span>
              ) : null
            }
          >
            {androidUrl && qrSvg ? (
              <div className={estilos['principal']}>
                <div
                  className={estilos['qr']}
                  data-testid="qr-do-instalador"
                  role="img"
                  aria-label="QR do instalador Android"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />

                <div className={estilos['informacao']}>
                  <span className={estilos['rotulo']}>Android · APK</span>
                  <p className={estilos['versao']} data-testid="versao-do-instalador">
                    {androidVersion ? `Versão ${androidVersion}` : 'Versão não informada'}
                  </p>
                  {updatedAt ? (
                    <p className={estilos['autoria']} data-testid="autoria-do-instalador">
                      Atualizado em{' '}
                      <TenantDateTime iso={updatedAt} timeZone={FUSO_PROVISORIO} format="datetime" />
                      {updatedByEmail
                        ? ` por ${updatedByEmail}${updatedByRole ? ` (${rotuloDePerfil(updatedByRole)})` : ''}`
                        : ''}
                    </p>
                  ) : null}

                  <span className={estilos['rotulo']}>Link</span>
                  <div className={estilos['linhaDoLink']}>
                    <p className={estilos['link']} data-testid="link-do-instalador" title={androidUrl}>
                      {androidUrl}
                    </p>
                    <CopiarLink url={androidUrl} />
                  </div>

                  <hr className={estilos['divisor']} />

                  <p className={estilos['status']}>
                    <span className={estilos['ponto']} aria-hidden="true" />
                    O totem mostra o botão “Baixar o app” na tela de espera.
                  </p>
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

          <div className={estilos['aviso']} role="note">
            <span className={estilos['avisoIcone']}>
              <Icon name="alert-circle" />
            </span>
            <p style={{ margin: 0 }}>
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
            <FormularioDoInstalador androidUrl={androidUrl} androidVersion={androidVersion} />
          </SectionCard>
        ) : null}
      </div>
    </section>
  );
}
