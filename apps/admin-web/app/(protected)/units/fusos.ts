/**
 * Os fusos do Brasil, e só eles.
 *
 * LISTA FECHADA e não campo livre: o ADR-019 faz o bloqueio por
 * inadimplência depender do fuso da unidade, **sem fallback** -- um
 * `America/Sao Paulo` digitado com espaço em vez de sublinhado passaria pela
 * checagem de "campo preenchido" e viraria decisão de acesso errada meses
 * depois. A API valida contra a base IANA e recusaria, mas descobrir isso
 * depois de preencher o cadastro é trabalho jogado fora.
 *
 * ARQUIVO PRÓPRIO porque cadastro e edição usam a MESMA lista: duas cópias
 * divergiriam no primeiro fuso novo, e a unidade criada por uma tela não
 * poderia ser editada pela outra.
 *
 * São os cinco fusos oficiais do país (UTC−2 a UTC−5). Academia fora do
 * Brasil é caso que não existe hoje; quando existir, a lista cresce aqui e a
 * API já aceita qualquer IANA válido.
 */
export const FUSOS = [
  { valor: 'America/Sao_Paulo', rotulo: 'Brasília (UTC−3) — SP, RJ, MG, PR, SC, RS, GO, DF, BA…' },
  { valor: 'America/Manaus', rotulo: 'Amazonas (UTC−4) — AM, MT, MS, RO, RR' },
  { valor: 'America/Rio_Branco', rotulo: 'Acre (UTC−5) — AC e sudoeste do AM' },
  { valor: 'America/Belem', rotulo: 'Pará (UTC−3) — PA, AP, MA, TO' },
  { valor: 'America/Noronha', rotulo: 'Fernando de Noronha (UTC−2)' },
] as const;
