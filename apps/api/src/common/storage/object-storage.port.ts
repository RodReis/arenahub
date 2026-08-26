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
 * Monta a chave do objeto de midia.
 *
 * Formato: `tenants/{tenantId}/kiosk-media/{gymUnitId}/{id}.mp4`.
 *
 * SERVIDOR GERA, cliente nunca escolhe prefixo -- mesma disciplina de
 * `montarChaveDeCadastro`. Aceitar `key` do corpo deixaria o tenant A
 * escrever em `tenants/{B}/...`, que e a regra de arquitetura no 2 furada
 * pela porta dos fundos.
 */
export function montarChaveDeMidia(
  tenantId: string,
  gymUnitId: string,
  id: string,
): string {
  return `${prefixoDeMidia(tenantId, gymUnitId)}${id}.mp4`;
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
