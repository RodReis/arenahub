/**
 * Parser puro do JSON exportado do Pacto (F47/#118, ADR-033).
 *
 * Sem banco, sem relogio, sem I/O -- so transformacao. `import-pacto.ts` le o
 * arquivo e grava; este modulo so decide COMO cada registro vira dado do
 * ArenaHub, e por isso e testavel sem Postgres.
 */

export interface RegistroPacto {
  dados_pessoais: {
    matricula: string;
    nome: string;
    data_nascimento: string | null;
    telefone: string | null;
    email: string | null;
    email_truncado: boolean;
    sexo: string | null;
    documento: string | null;
    documento_valido: boolean | null;
  };
  endereco: {
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    complemento: string | null;
    cep: string | null;
  };
  plano: {
    nome_plano: string | null;
    situacao: string;
  };
}

export interface EnderecoPronto {
  postalCode: string;
  street: string;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string;
  state: 'GO';
}

export interface ContatoPronto {
  type: 'PHONE' | 'EMAIL';
  value: string;
  isPrimary: boolean;
}

export interface AlunoPronto {
  membershipNumber: string;
  fullName: string;
  birthDate: Date;
  registeredSex: 'MALE' | 'FEMALE' | 'NOT_INFORMED';
  cpf: string | null;
  contacts: ContatoPronto[];
  address: EnderecoPronto | null;
  /** Nome do plano original do Pacto -- vira `Subscription.lastReason`. */
  planoOriginal: string | null;
}

export interface RegistroRejeitado {
  matricula: string;
  nome: string;
  motivo: 'SEM_DATA_NASCIMENTO';
}

/** `dd/mm/yyyy` para `Date` em meia-noite UTC. `@db.Date` nao tem fuso. */
export function parsearDataBr(valor: string): Date {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);

  if (!partes) throw new Error(`Data fora do formato dd/mm/yyyy: "${valor}"`);

  const [, dia, mes, ano] = partes;

  return new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
}

/** `AP-2026-{matricula do Pacto em 8 digitos}` -- regra 5 do ADR-033. */
export function matriculaImportada(matriculaPacto: string): string {
  return `AP-2026-${matriculaPacto.padStart(8, '0')}`;
}

function sexoParaRegistrado(sexo: string | null): 'MALE' | 'FEMALE' | 'NOT_INFORMED' {
  if (sexo === 'Masculino') return 'MALE';
  if (sexo === 'Feminino') return 'FEMALE';

  return 'NOT_INFORMED';
}

function enderecoPronto(endereco: RegistroPacto['endereco']): EnderecoPronto | null {
  // Regra 6 do ADR-033: so entra endereco COMPLETO. `street`, `city` e
  // `postalCode` sao NOT NULL no schema -- registro com so o bairro fica sem
  // endereco, em vez de entrar pela metade.
  if (!endereco.logradouro || !endereco.cidade || !endereco.cep) return null;

  return {
    postalCode: endereco.cep,
    street: endereco.logradouro,
    number: endereco.numero,
    complement: endereco.complemento,
    district: endereco.bairro,
    city: endereco.cidade,
    state: 'GO',
  };
}

function contatosProntos(dadosPessoais: RegistroPacto['dados_pessoais']): ContatoPronto[] {
  const contatos: ContatoPronto[] = [];

  if (dadosPessoais.telefone) {
    contatos.push({ type: 'PHONE', value: dadosPessoais.telefone, isPrimary: true });
  }

  // Regra 9 do ADR-033/#118: e-mail truncado na impressao do PDF nao entra --
  // 59 casos, o proprio relatorio corta a string, e gravar a metade seria
  // dado inventado no caminho de producao (CLAUDE.md).
  if (dadosPessoais.email && !dadosPessoais.email_truncado) {
    contatos.push({ type: 'EMAIL', value: dadosPessoais.email, isPrimary: contatos.length === 0 });
  }

  return contatos;
}

/**
 * Converte um registro do Pacto no formato pronto para gravar, ou devolve o
 * motivo da rejeicao.
 *
 * Regra 7 do ADR-033: os 20 sem `data_nascimento` nao entram -- o campo e
 * `NOT NULL` no schema, e inventar data e dado falso no caminho de producao.
 */
export function converterRegistro(
  registro: RegistroPacto,
): { ok: true; aluno: AlunoPronto } | { ok: false; rejeitado: RegistroRejeitado } {
  const { dados_pessoais: dadosPessoais, endereco, plano } = registro;

  if (!dadosPessoais.data_nascimento) {
    return {
      ok: false,
      rejeitado: {
        matricula: dadosPessoais.matricula,
        nome: dadosPessoais.nome,
        motivo: 'SEM_DATA_NASCIMENTO',
      },
    };
  }

  return {
    ok: true,
    aluno: {
      membershipNumber: matriculaImportada(dadosPessoais.matricula),
      fullName: dadosPessoais.nome,
      birthDate: parsearDataBr(dadosPessoais.data_nascimento),
      registeredSex: sexoParaRegistrado(dadosPessoais.sexo),
      // `documento_valido` ja veio conferido do extrator (digito verificador).
      // So grava quando o proprio Pacto confirmou -- CPF invalido gravado
      // hoje vira falso negativo de duplicata amanha.
      cpf: dadosPessoais.documento_valido ? dadosPessoais.documento : null,
      contacts: contatosProntos(dadosPessoais),
      address: enderecoPronto(endereco),
      planoOriginal: plano.nome_plano,
    },
  };
}
