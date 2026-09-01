import { redirect } from 'next/navigation';

/**
 * A raiz nao tem conteudo proprio: manda para o Dashboard, e o layout
 * protegido decide se a pessoa entra ou volta para o login.
 *
 * Era `/units` ate 24/08/2026 e `/operations` ate 01/09/2026. A mudanca para
 * o dashboard e a decisao 2 da `SPEC-057`: `/operations` e a tela de
 * INVESTIGACAO -- lista de alertas, detalhe de dispositivo, fila de sync --, e
 * quem abre o painel primeiro quer o RESUMO que decide se vale investigar.
 * `Operacao` continua no menu, intacta.
 */
export default function PaginaInicial() {
  redirect('/dashboard');
}
