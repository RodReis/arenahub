/**
 * Formatação pt-BR do Relatório de Alunos, em funções puras.
 *
 * Existe aqui, e não no painel, porque PDF e CSV nascem NA API: o arquivo não
 * passa pelo navegador de ninguém. O painel tem a própria máscara
 * (`src/lib/mascaras.ts`) para o que mostra na tela; as duas precisam
 * concordar no formato, e os testes dos dois lados o fixam.
 */

const soDigitos = (valor: string): string => valor.replace(/\D/g, '');

export function formatarCpf(cpf: string | null): string {
  if (cpf === null) return '';

  const d = soDigitos(cpf);

  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}

export function formatarCnpj(cnpj: string): string {
  const d = soDigitos(cnpj);

  return d.length === 14
    ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
    : cnpj;
}

export function formatarTelefone(valor: string | null): string {
  if (valor === null) return '';

  const d = soDigitos(valor);
  const nacional = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;

  if (nacional.length === 11) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 7)}-${nacional.slice(7)}`;
  }
  if (nacional.length === 10) {
    return `(${nacional.slice(0, 2)}) ${nacional.slice(2, 6)}-${nacional.slice(6)}`;
  }

  return valor;
}

/**
 * Partes da data no fuso pedido. `formatToParts`, e não `format`: o texto de
 * `format` varia com a versão do ICU do servidor, as partes não.
 */
function partesDaData(data: Date, fuso: string): (tipo: string) => string {
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(data);

  return (tipo) => partes.find((p) => p.type === tipo)?.value ?? '';
}

/** `10/10/2026 14:32` no fuso da academia. */
export function formatarDataHora(data: Date, fuso: string): string {
  const p = partesDaData(data, fuso);

  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}`;
}

/** `2026-10-10`, para o nome do arquivo. */
export function dataParaNomeDeArquivo(data: Date, fuso: string): string {
  const p = partesDaData(data, fuso);

  return `${p('year')}-${p('month')}-${p('day')}`;
}

const ROTULO_DE_ORIGEM: Readonly<Record<string, string>> = {
  SUBSCRIPTION: 'Assinatura',
  COURTESY: 'Cortesia',
  EMPLOYEE: 'Funcionário',
  PERSONAL_TRAINER: 'Personal trainer',
  VISITOR: 'Visitante',
  TRIAL_CLASS: 'Aula experimental',
  DEPENDENT: 'Dependente',
  PARTNER: 'Parceiro',
  CORPORATE: 'Convênio corporativo',
};

/**
 * O que a coluna PLANO mostra -- a mesma regra da Lista de Alunos
 * (`planoDaListagem`, em `admin-web/src/students/formatar.ts`): nome do plano
 * quando há assinatura; origem do vínculo quando o acesso não nasce de
 * assinatura; `null` quando não há nada (célula vazia, não "sem plano").
 */
export function rotuloDoPlano(planName: string | null, accessSource: string | null): string | null {
  if (planName !== null) return planName;
  if (accessSource === null || accessSource === 'SUBSCRIPTION') return null;

  return ROTULO_DE_ORIGEM[accessSource] ?? accessSource;
}

export const ROTULO_DE_SITUACAO: Readonly<Record<string, string>> = {
  LEAD: 'Interessado',
  TRIAL: 'Experimental',
  ACTIVE: 'Ativo',
  SUSPENDED: 'Suspenso',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
  ARCHIVED: 'Arquivado',
};

export const ROTULO_DE_PERFIL: Readonly<Record<string, string>> = {
  STUDENT: 'Aluno',
  TRAINER: 'Professor',
  STAFF: 'Funcionário',
  ADMIN: 'Administrador',
  PERMUTA_TACIO: 'Permuta-Tacio',
  PERMUTA_DOUGLAS: 'Permuta-Douglas',
};

export const ROTULO_FINANCEIRO: Readonly<Record<string, string>> = {
  INADIMPLENTES: 'Inadimplentes',
  PAGANTES: 'Pagantes',
};
