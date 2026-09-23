import { z } from 'zod';

/**
 * `z.enum(valores).optional()` para filtro de query string -- FIX.
 *
 * O NAVEGADOR MANDA STRING VAZIA, NAO AUSENCIA. Um link com combo "Todos"
 * serializa como `?outcome=&mode=`, e `URLSearchParams`/Express entregam
 * `outcome: ''` -- nao `undefined`. `z.enum(...).optional()` so aceita
 * `undefined`; `''` nao e um dos valores do enum, e o `.parse()` inteiro
 * falha com `VALIDATION_FAILED` generico, mesmo a pessoa nao tendo escolhido
 * filtro nenhum.
 *
 * Achado em `GET /access-events` (`outcome`, `mode`) e reproduzido de proposito
 * em `GET /billing/invoices` (`status`) e `GET /billing/reconciliation/items`
 * (`status`) -- os tres schemas de filtro por enum opcional no repositorio,
 * todos com o mesmo defeito. Corrigido na raiz, uma vez, aqui.
 *
 * `<const T>` NO PARAMETRO DE TIPO, e nao so `T extends [string, ...string[]]`:
 * sem `const`, o TypeScript alarga o array literal do chamador
 * (`['ALLOW', 'DENY']`) para `string[]` ANTES de entrar na funcao, e
 * `z.enum(valores)` sai com literais genericos -- todo `where: { status:
 * filtro.status }` rio abaixo perde o tipo e quebra contra `StatusDeInvoice`,
 * `ReconciliationItemStatus` etc. sob `exactOptionalPropertyTypes`.
 *
 * `.preprocess`, e nao `.catch(undefined)`: catch trocaria QUALQUER valor
 * invalido por `undefined` silenciosamente -- `outcome=lixo` deixaria de
 * ser erro de validacao e viraria "sem filtro" sem avisar quem chamou.
 * O preprocess so intercepta o caso que interessa (string vazia); todo
 * resto continua caindo na validacao normal do enum.
 */
export function enumOpcionalDeQuery<const T extends readonly [string, ...string[]]>(valores: T) {
  return z.preprocess((valor) => (valor === '' ? undefined : valor), z.enum(valores).optional());
}
