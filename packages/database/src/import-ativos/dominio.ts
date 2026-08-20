/**
 * Regras puras da importacao da base corrente do Pacto -- F48.
 *
 * Tudo aqui e funcao pura (`CLAUDE.md`): sem banco, sem rede, sem relogio.
 * O "agora" entra por parametro. E o que permite provar as decisoes que
 * decidem se uma pessoa entra na academia sem subir infraestrutura.
 */

/** Menor e maior idade que um cadastro de academia admite. */
const IDADE_MINIMA_ANOS = 3;
const IDADE_MAXIMA_ANOS = 110;

/**
 * Data do Pacto em `Date`, ou `null` quando o valor nao e uma data.
 *
 * O arquivo usa DOIS formatos: `AAAAMMDD` na vigencia do plano e
 * `DD/MM/AAAA` no nascimento. Aceitar os dois aqui evita espalhar o
 * conhecimento do formato pelo seed.
 *
 * VALIDA O CALENDARIO, nao so o formato: `Date.UTC(2026, 1, 31)` devolve 3
 * de marco sem reclamar, e uma data que "existe" errado e pior que uma
 * ausente -- ela passa despercebida.
 */
export function parsearDataDoPacto(valor: string): Date | null {
  const texto = valor.trim();

  if (texto === '') return null;

  const compacto = /^(\d{4})(\d{2})(\d{2})$/.exec(texto);
  const barrado = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto);

  let ano: number;
  let mes: number;
  let dia: number;

  if (compacto) {
    ano = Number(compacto[1]);
    mes = Number(compacto[2]);
    dia = Number(compacto[3]);
  } else if (barrado) {
    dia = Number(barrado[1]);
    mes = Number(barrado[2]);
    ano = Number(barrado[3]);
  } else {
    return null;
  }

  const data = new Date(Date.UTC(ano, mes - 1, dia));

  // Ida e volta: se o mes ou o dia mudou, a data nao existe no calendario.
  if (
    data.getUTCFullYear() !== ano ||
    data.getUTCMonth() !== mes - 1 ||
    data.getUTCDate() !== dia
  ) {
    return null;
  }

  return data;
}

/**
 * O nascimento faz sentido para um aluno de academia?
 *
 * O arquivo do Pacto traz nascimentos em 2026 e 2022 -- alguem digitou a
 * data de hoje no campo errado. Sobrescrever o cadastro com isso apagaria
 * dado bom com dado impossivel.
 */
export function nascimentoEhPlausivel(nascimento: Date, agora: Date): boolean {
  const idadeMs = agora.getTime() - nascimento.getTime();

  if (idadeMs < 0) return false;

  const anos = idadeMs / (365.25 * 24 * 60 * 60 * 1000);

  return anos >= IDADE_MINIMA_ANOS && anos <= IDADE_MAXIMA_ANOS;
}

/** Os quatro papeis que a academia opera hoje. Espelha `StudentProfile`. */
export type PerfilImportado = 'ADMIN' | 'STUDENT' | 'STAFF' | 'TRAINER';

/**
 * `Codigo Perfil` do Pacto para o papel do ArenaHub.
 *
 * LISTA FECHADA, e o desconhecido vira `null`: os codigos 4, 5 e 6
 * aparecem no arquivo apenas em registros de teste, e adivinhar o
 * significado deles daria acesso a alguem que nem existe.
 */
const PERFIL_POR_CODIGO: Record<string, PerfilImportado> = {
  '0': 'ADMIN',
  '1': 'STUDENT',
  '2': 'STAFF',
  '3': 'TRAINER',
};

export function traduzirPerfil(codigo: string): PerfilImportado | null {
  return PERFIL_POR_CODIGO[codigo.trim()] ?? null;
}

/**
 * De onde vem o direito de acesso desse papel.
 *
 * O perfil NAO decide acesso -- ele diz qual `EntitlementSource` origina o
 * direito. Quem decide continua sendo o `Entitlement` (regra no 1).
 */
export function origemDoDireito(
  perfil: PerfilImportado,
): 'SUBSCRIPTION' | 'EMPLOYEE' | 'PERSONAL_TRAINER' {
  if (perfil === 'STUDENT') return 'SUBSCRIPTION';
  if (perfil === 'TRAINER') return 'PERSONAL_TRAINER';

  return 'EMPLOYEE';
}
