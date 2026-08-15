import { redirect } from 'next/navigation';

/**
 * A raiz nao tem conteudo proprio: manda para as unidades, e o layout
 * protegido decide se a pessoa entra ou volta para o login.
 */
export default function PaginaInicial() {
  redirect('/units');
}
