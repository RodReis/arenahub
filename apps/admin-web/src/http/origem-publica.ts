import 'server-only';

import { headers } from 'next/headers';

/**
 * Endereco publico do painel, de onde o aluno abre o link curto (#538). Vem do
 * proprio pedido (o proxy da Railway manda `x-forwarded-*`): o mesmo codigo
 * monta `localhost:3000` em dev e o dominio de producao la, sem variavel nova.
 *
 * Atras de mais de um proxy o cabecalho vem como lista ("a.com, b.com"):
 * vale o primeiro, o que o cliente pediu.
 */
export async function origemPublica(): Promise<string> {
  const h = await headers();
  const primeiro = (valor: string | null): string | undefined =>
    valor?.split(',')[0]?.trim() || undefined;
  const host = primeiro(h.get('x-forwarded-host')) ?? primeiro(h.get('host')) ?? 'localhost:3000';
  const protocolo =
    primeiro(h.get('x-forwarded-proto')) ?? (host.startsWith('localhost') ? 'http' : 'https');

  return `${protocolo}://${host}`;
}
