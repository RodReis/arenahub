import { TenantDateTime } from './TenantDateTime.js';
import estilos from './ConsentCard.module.css';

interface Props {
  readonly version: string;
  readonly grantedAt: string;
  readonly ip: string;
  readonly device: string;
  readonly timeZone: string;
}

/**
 * Prova do consentimento -- DS-PAINEL.md §9: versao, data, IP e dispositivo.
 *
 * Consentimento biometrico e VERSIONADO (regra de arquitetura 7): provar o
 * consentimento exige saber QUAL texto a pessoa aceitou, nao so que aceitou.
 * Um termo reescrito depois nao cobre quem assinou o anterior.
 */
export function ConsentCard({ version, grantedAt, ip, device, timeZone }: Props) {
  return (
    <dl className={estilos['cartao']}>
      <dt>Versão do termo</dt>
      <dd data-numeric>{version}</dd>

      <dt>Aceito em</dt>
      <dd>
        <TenantDateTime iso={grantedAt} timeZone={timeZone} format="datetime" />
      </dd>

      <dt>Endereço IP</dt>
      <dd data-numeric>{ip}</dd>

      <dt>Dispositivo</dt>
      <dd>{device}</dd>
    </dl>
  );
}
