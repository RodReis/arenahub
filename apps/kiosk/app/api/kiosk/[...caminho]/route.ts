import 'server-only';

import { randomBytes } from 'node:crypto';

import { CABECALHOS_DO_KIOSK, assinar } from '@arenahub/api-contracts';

/**
 * Ponte assinada entre o navegador do totem e a API.
 *
 * Existe por uma razao so, e ela nao e conveniencia: o segredo HMAC do
 * dispositivo NAO pode chegar ao navegador. O totem fica numa recepcao,
 * fisicamente acessivel; qualquer segredo no bundle e um segredo publicado.
 * Este handler roda no servidor Node do proprio totem, ao lado do processo,
 * e e o unico lugar onde o segredo existe.
 *
 * O que ele NAO faz, de proposito: nao decide nada, nao filtra resposta, nao
 * traduz erro. O tenant, a unidade e o dispositivo saem da CREDENCIAL do
 * lado da API (regra de arquitetura no 2) -- este arquivo nao tem como
 * afirmar identidade nenhuma, e e isso que o mantem burro e seguro.
 */

const URL_INTERNA = process.env['API_INTERNAL_URL'] ?? 'http://localhost:3344';

/**
 * Metodos repassados. Lista fechada: um handler que aceitasse qualquer verbo
 * viraria proxy generico para a API inteira -- assinado com a credencial do
 * totem, que e exatamente o que nao se quer dar de graca a quem alcance a
 * porta local do quiosque. O Next so exporta os tres abaixo; qualquer outro
 * verbo recebe 405 sem passar por aqui.
 */
type Metodo = 'GET' | 'POST' | 'DELETE';

/**
 * Credencial do dispositivo, lida do ambiente.
 *
 * Lancar (em vez de devolver 500 silencioso) e deliberado: totem sem
 * credencial nao tem operacao possivel, e um erro que aparece na primeira
 * chamada e melhor do que uma tela que falha sempre sem dizer por que.
 */
function credencial(): { keyId: string; secret: string } {
  const keyId = process.env['KIOSK_KEY_ID'];
  const secret = process.env['KIOSK_SECRET'];

  if (!keyId || !secret) {
    throw new Error(
      'KIOSK_KEY_ID e KIOSK_SECRET sao obrigatorios -- veja o .env.example.',
    );
  }

  return { keyId, secret };
}

async function repassar(requisicao: Request, metodo: Metodo): Promise<Response> {
  const { keyId, secret } = credencial();

  const url = new URL(requisicao.url);
  // O caminho do totem espelha o da API: `/api/kiosk/config` daqui vira
  // `/api/v1/kiosk/config` la. A reescrita e literal, sem tabela de rotas --
  // acrescentar endpoint na API nao pede mexer aqui.
  const caminho = `/api/v1/kiosk/${url.pathname.replace(/^\/api\/kiosk\/?/, '')}`;
  const pathAndQuery = `${caminho}${url.search}`;

  // Le UMA VEZ e usa a MESMA string para assinar e enviar: reserializar
  // reordena chave e o hash deixa de bater, com sintoma de 401 sem causa.
  const corpo = metodo === 'GET' || metodo === 'DELETE' ? '' : await requisicao.text();

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('base64url');

  const assinatura = assinar(
    { keyId, timestamp, nonce, method: metodo, pathAndQuery, body: corpo },
    secret,
  );

  const cabecalhos: Record<string, string> = {
    [CABECALHOS_DO_KIOSK.keyId]: keyId,
    [CABECALHOS_DO_KIOSK.timestamp]: String(timestamp),
    [CABECALHOS_DO_KIOSK.nonce]: nonce,
    [CABECALHOS_DO_KIOSK.signature]: assinatura,
  };

  if (corpo !== '') cabecalhos['content-type'] = 'application/json';

  // O token do ALUNO atravessa: e a credencial da SESSAO, distinta da do
  // dispositivo, e sem ela a API recusa `extend` e `DELETE`.
  const tokenDaSessao = requisicao.headers.get('x-session-token');

  if (tokenDaSessao !== null) cabecalhos['x-session-token'] = tokenDaSessao;

  const resposta = await fetch(`${URL_INTERNA}${pathAndQuery}`, {
    method: metodo,
    headers: cabecalhos,
    ...(corpo === '' ? {} : { body: corpo }),
    cache: 'no-store',
  });

  // 204 (encerrar) nao tem corpo, e devolver um o torna invalido.
  if (resposta.status === 204) {
    return new Response(null, { status: 204 });
  }

  const texto = await resposta.text();

  return new Response(texto, {
    status: resposta.status,
    headers: { 'content-type': resposta.headers.get('content-type') ?? 'application/json' },
  });
}

export async function GET(requisicao: Request): Promise<Response> {
  return repassar(requisicao, 'GET');
}

export async function POST(requisicao: Request): Promise<Response> {
  return repassar(requisicao, 'POST');
}

export async function DELETE(requisicao: Request): Promise<Response> {
  return repassar(requisicao, 'DELETE');
}
