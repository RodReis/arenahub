/**
 * Raiz provisoria: existe para o `next build` ter o que compilar.
 *
 * As telas de verdade -- login, MFA, unidade e convite -- nascem na Task 6
 * desta mesma fatia, sob `app/(auth)` e `app/(protected)`.
 */
export default function PaginaInicial() {
  return (
    <main>
      <h1>ArenaHub</h1>
      <p>Painel administrativo.</p>
    </main>
  );
}
