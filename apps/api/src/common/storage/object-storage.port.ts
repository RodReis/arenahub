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
