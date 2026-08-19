import { createHash } from 'node:crypto';

/**
 * O documento do recibo e o seu codigo de verificacao. F16, INV-075.
 *
 * Funcoes puras: sem banco, sem relogio, sem rede (`CLAUDE.md`). Ficam no
 * dominio e nao no caso de uso porque o codigo impresso e uma AFIRMACAO sobre
 * o conteudo -- e afirmacao se prova com teste que nao precisa de Postgres de
 * pe para rodar.
 */

/**
 * O documento congelado.
 *
 * O QUE NUNCA ENTRA AQUI: PAN, CVV, token do provedor, id de webhook, CPF
 * completo (INV-098, INV-133). O recibo e impresso, entregue em maos e fica no
 * historico -- e o lugar errado para qualquer segredo.
 */
export interface SnapshotDoRecibo {
  readonly tipo: 'RECIBO NÃO FISCAL';
  readonly numero: number;
  readonly emitidoEm: string;
  readonly tenant: { readonly nome: string };
  readonly pagador: { readonly nome: string; readonly matricula: string };
  readonly invoice: { readonly numero: number; readonly competencia: string };
  readonly pagamento: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly pagoEm: string;
    readonly metodo: string;
    /**
     * Ultimos digitos do id no provedor, para conferencia sem expor a
     * referencia inteira -- que serve para consultar a API dele.
     */
    readonly referenciaFinal: string | null;
  };
  readonly itens: readonly {
    readonly descricao: string;
    readonly quantidade: number;
    readonly totalMinor: number;
  }[];
}

/**
 * SHA-256 do snapshot em JSON canonico -- o codigo de verificacao impresso.
 *
 * CANONICO IMPORTA: `JSON.stringify` preserva a ordem de insercao das chaves,
 * e duas emissoes do mesmo conteudo montadas em ordem diferente dariam hashes
 * diferentes. A conferencia falharia num recibo legitimo, e a academia
 * aprenderia a ignorar o codigo -- que e o mesmo que nao te-lo.
 *
 * Ordenar as chaves faz o codigo depender do CONTEUDO, que e o que ele afirma
 * verificar.
 */
export function hashDoRecibo(snapshot: SnapshotDoRecibo): string {
  return createHash('sha256').update(canonico(snapshot)).digest('hex');
}

function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') {
    return JSON.stringify(valor);
  }

  if (Array.isArray(valor)) {
    return `[${valor.map(canonico).join(',')}]`;
  }

  const chaves = Object.keys(valor as Record<string, unknown>).sort();

  return `{${chaves
    .map((c) => `${JSON.stringify(c)}:${canonico((valor as Record<string, unknown>)[c])}`)
    .join(',')}}`;
}
