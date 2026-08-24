import { redirect } from 'next/navigation';

/**
 * A raiz nao tem conteudo proprio: manda para a Operacao, e o layout
 * protegido decide se a pessoa entra ou volta para o login.
 *
 * Era `/units` ate 24/08/2026. Mudou junto do redirect do login, pela mesma
 * razao: quem abre o painel pergunta "a catraca esta de pe?", e Unidades
 * passou a ser tela de Administracao.
 */
export default function PaginaInicial() {
  redirect('/operations');
}
