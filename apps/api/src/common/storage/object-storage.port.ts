/**
 * Fronteira de armazenamento privado de objeto.
 *
 * Existe como porta, e nao como chamada direta ao S3, por dois motivos que
 * nao sao gosto arquitetural:
 *
 *   1. a foto de cadastro biometrico e dado pessoal sensivel (LGPD art. 11).
 *      Toda escrita e leitura dela passa por aqui -- um lugar so para auditar,
 *      um lugar so para trocar de provedor;
 *   2. teste de integracao roda contra MinIO local; producao usa S3. A porta e
 *      o que permite os dois sem `if (ambiente)` espalhado.
 *
 * A CHAVE E GERADA PELO SERVIDOR (`montarChaveDeCadastro`). Cliente nunca
 * escolhe prefixo: aceitar `key` do corpo deixaria o tenant A escrever em
 * `tenants/{B}/...` -- quebra da regra de arquitetura no 2 pela porta dos
 * fundos.
 */

/** Tipos aceitos no cadastro. Lista fechada: nada de `image/*`. */
export type ContentTypeDeCadastro = 'image/jpeg' | 'image/png';

export interface UploadPrivado {
  /** URL pre-assinada, de uso unico e curta duracao. */
  uploadUrl: string;
  /** Instante de expiracao em ISO-8601, para a UI avisar antes de falhar. */
  expiresAt: string;
}

export interface MetadadosDeObjeto {
  size: number;
  contentType: string;
}

export interface ObjectStoragePort {
  /**
   * Devolve URL pre-assinada para o cliente enviar a imagem DIRETO ao
   * storage, sem passar pela API.
   *
   * `maxBytes` entra na assinatura: sem ele, a URL vira upload ilimitado.
   */
  createPrivateUpload(entrada: {
    key: string;
    contentType: ContentTypeDeCadastro;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadPrivado>;

  /**
   * Confere o que realmente chegou ao storage.
   *
   * O cliente diz o que enviou; isto verifica. Sem esta checagem, um upload
   * de 0 byte ou de `application/zip` viraria identidade biometrica valida.
   */
  headPrivateObject(key: string): Promise<MetadadosDeObjeto>;

  /**
   * Apaga o objeto. Idempotente: apagar o que nao existe e sucesso.
   *
   * INV-142 exige expurgo verificavel; um `delete` que estoura em objeto
   * ausente faria o job de expurgo travar justamente no caso ja resolvido.
   */
  deletePrivateObject(key: string): Promise<void>;

  /**
   * Grava um objeto gerado PELO SERVIDOR -- F11, exportacao.
   *
   * Diferente de `createPrivateUpload`, que devolve URL para o CLIENTE
   * enviar. Aqui o conteudo nasce na API (o CSV montado a partir do banco) e
   * nunca passa pelo navegador de ninguem.
   */
  putPrivateObject(entrada: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void>;

  /**
   * Le o objeto INTEIRO para a memoria -- F62, identidade visual.
   *
   * Diferente de `createPrivateDownload`, que devolve link para o NAVEGADOR
   * buscar direto no storage. Aqui os bytes passam pela API, e isso e a
   * escolha, nao um descuido:
   *
   *   1. o logo e o icone entram na tela de LOGIN, antes de existir sessao.
   *      URL assinada expira, e favicon com link expirado vira aba sem icone
   *      no meio do expediente -- sem erro visivel, sem ninguem para reclamar;
   *   2. servindo pela API, o `Content-Security-Policy` e o `X-Content-Type-
   *      Options` da resposta sao NOSSOS. Numa URL do bucket quem escolhe os
   *      cabecalhos e o storage, e SVG e justamente o formato em que esses
   *      cabecalhos sao a diferenca entre imagem e execucao de script.
   *
   * SO PARA OBJETO PEQUENO E DE TETO CONHECIDO. Exportacao e video do totem
   * continuam por URL assinada: carregar um CSV de milhares de alunos na
   * memoria da API para depois cuspi-lo pelo socket e o caminho para derrubar
   * o processo com um download concorrente.
   */
  getPrivateObject(key: string): Promise<{ body: Buffer; contentType: string }>;

  /**
   * URL assinada de leitura, de vida curta.
   *
   * Curta de proposito: exportacao carrega evento de acesso de aluno, e um
   * link que dura o dia inteiro vira link compartilhado por e-mail.
   */
  createPrivateDownload(entrada: {
    key: string;
    expiresInSeconds: number;
    /** Nome sugerido ao navegador. */
    fileName: string;
  }): Promise<{ downloadUrl: string; expiresAt: string }>;
}

/** Token de injecao -- a porta e interface, e interface some no runtime. */
export const OBJECT_STORAGE = Symbol('ObjectStoragePort');

/**
 * Monta a chave do objeto de cadastro.
 *
 * Formato: `tenants/{tenantId}/biometrics/{identityId}/enrollment`.
 *
 * Sem CPF, sem nome, sem matricula: quem enxergar a listagem do bucket ve
 * dois UUIDs, nao a identificacao de uma pessoa (INV-012 e o espirito do
 * INV-022).
 */
export function montarChaveDeCadastro(tenantId: string, identityId: string): string {
  return `tenants/${tenantId}/biometrics/${identityId}/enrollment`;
}

/**
 * A extensao de cada `content-type` que pode entrar na midia do totem.
 *
 * Existe porque a chave nasceu com `.mp4` FIXO, quando video era a unica
 * midia. Com o upload de logotipo (28/08/2026) isso passou a gravar PNG sob
 * nome `.mp4`: funcionava -- o `content-type` do storage e quem manda na
 * hora de servir --, mas mentia sobre o conteudo para qualquer um que
 * abrisse o bucket, e transformava "que arquivo e este?" numa investigacao.
 */
const EXTENSAO_POR_TIPO: Readonly<Record<string, string>> = {
  'video/mp4': 'mp4',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Monta a chave do objeto de midia.
 *
 * Formato: `tenants/{tenantId}/kiosk-media/{gymUnitId}/{id}.{ext}`.
 *
 * SERVIDOR GERA, cliente nunca escolhe prefixo -- mesma disciplina de
 * `montarChaveDeCadastro`. Aceitar `key` do corpo deixaria o tenant A
 * escrever em `tenants/{B}/...`, que e a regra de arquitetura no 2 furada
 * pela porta dos fundos.
 *
 * O `contentType` e OPCIONAL e cai em `mp4`: as chamadas que ja existiam
 * (upload de video, ingestao de reel) nao mudam de comportamento nem de
 * assinatura. A extensao NAO participa da checagem de pertencimento --
 * `prefixoDeMidia` olha so o comeco da chave --, entao chave antiga com
 * `.mp4` continua valendo sem migracao.
 *
 * Tipo desconhecido tambem cai em `mp4` em vez de lancar: quem decide o que
 * entra sao os dominios de aceitacao (`midia-do-totem.ts`,
 * `logotipo-do-patrocinador.ts`), e duplicar a lista aqui criaria duas
 * fontes da verdade que divergem no primeiro formato novo.
 */
export function montarChaveDeMidia(
  tenantId: string,
  gymUnitId: string,
  id: string,
  contentType = 'video/mp4',
): string {
  const extensao = EXTENSAO_POR_TIPO[contentType.toLowerCase()] ?? 'mp4';

  return `${prefixoDeMidia(tenantId, gymUnitId)}${id}.${extensao}`;
}

/**
 * O diretorio em que a midia daquela unidade pode morar.
 *
 * Existe separado porque a LEITURA precisa conferir o que a ESCRITA montou:
 * `midiaKey` vem do payload da configuracao, que e dado de banco, e assinar
 * leitura de uma chave sem conferir o prefixo entregaria objeto de outro
 * tenant a quem editasse o payload.
 *
 * `startsWith` sobre este prefixo basta porque ele termina em `/` -- sem a
 * barra, `tenants/t1/kiosk-media/u1` casaria com `.../u10`, dando ao totem
 * da unidade 1 a midia da unidade 10.
 */
export function prefixoDeMidia(tenantId: string, gymUnitId: string): string {
  return `tenants/${tenantId}/kiosk-media/${gymUnitId}/`;
}

/** A chave pertence a esta unidade deste tenant? */
export function chaveDeMidiaPertenceA(
  midiaKey: string,
  tenantId: string,
  gymUnitId: string,
): boolean {
  return midiaKey.startsWith(prefixoDeMidia(tenantId, gymUnitId));
}
