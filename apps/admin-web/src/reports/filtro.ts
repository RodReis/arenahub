/**
 * As cinco chaves do filtro do Relatório de Alunos -- a MESMA lista na tela,
 * no link de exportação e na Route Handler. UMA lista, para que filtro novo
 * entre nos três lugares de uma vez.
 */
export const CHAVES_DO_FILTRO = ['gymUnitId', 'status', 'profile', 'planId', 'financeiro'] as const;

/**
 * Whitelist: só estas chaves, e só se tiverem valor. Qualquer outra coisa da
 * URL (`tenantId`, `format`, lixo) fica de fora -- a Route Handler repassa
 * cookie de sessão, e o que ela encaminha tem de ser decidido aqui, não pelo
 * navegador.
 */
export function consultaDoFiltro(ler: (chave: string) => string | undefined): URLSearchParams {
  const consulta = new URLSearchParams();

  for (const chave of CHAVES_DO_FILTRO) {
    const valor = ler(chave);

    if (valor) consulta.set(chave, valor);
  }

  return consulta;
}
