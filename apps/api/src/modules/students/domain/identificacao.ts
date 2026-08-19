import { createHash } from 'node:crypto';

/**
 * Normalizacao e mascaramento dos dados que identificam um aluno.
 *
 * Tudo aqui e funcao pura. A deteccao de duplicidade (INV-014) so funciona
 * se os dois lados da comparacao passarem pela MESMA normalizacao -- e por
 * isso a normalizacao mora no dominio, e nao espalhada no controller.
 */

/** E-mail em minusculas, sem espaco nas pontas. */
export function normalizarEmail(valor: string): string {
  return valor.trim().toLowerCase();
}

/**
 * Telefone reduzido a digitos.
 *
 * `(41) 99999-0000` e `41999990000` sao a mesma pessoa; sem isso, a busca
 * por duplicata nao acha nada e a recepcao cadastra o aluno duas vezes.
 */
export function normalizarTelefone(valor: string): string {
  return valor.replace(/\D/g, '');
}

/** CPF reduzido a digitos, do mesmo jeito e pelo mesmo motivo. */
export function normalizarCpf(valor: string): string {
  return valor.replace(/\D/g, '');
}

/**
 * Valida CPF por digito verificador.
 *
 * Nao e preciosismo: CPF invalido gravado hoje vira falso negativo de
 * duplicata amanha -- o mesmo aluno entra duas vezes com dois numeros
 * errados diferentes, e nenhuma busca os aproxima.
 */
export function cpfEhValido(valor: string): boolean {
  const digitos = normalizarCpf(valor);

  if (digitos.length !== 11) return false;
  // Sequencias como 111.111.111-11 passam na aritmetica do verificador e
  // nao existem como documento.
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  const verificador = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i += 1) {
      soma += Number(digitos[i]) * (ate + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return verificador(9) === Number(digitos[9]) && verificador(10) === Number(digitos[10]);
}

/**
 * Hash do CPF para busca por igualdade.
 *
 * SHA-256 do valor normalizado, com pimenta por tenant: dois tenants com o
 * mesmo aluno produzem hashes diferentes, entao vazar a tabela de um nao
 * permite cruzar bases. Hash e nao cifra porque a unica operacao necessaria
 * e comparar igualdade -- e hash nao tem chave que possa vazar junto.
 */
export function calcularHashDeCpf(tenantId: string, cpf: string): string {
  return createHash('sha256').update(`${tenantId}:${normalizarCpf(cpf)}`).digest('hex');
}

/**
 * Os tres ultimos digitos, para a recepcao confirmar "e este mesmo?".
 *
 * O CPF completo NAO e persistido nem devolvido pela API (`CLAUDE.md`:
 * nunca logar PII; INV-022 para o principio geral).
 */
export function ultimosTresDigitosDoCpf(cpf: string): string {
  return normalizarCpf(cpf).slice(-3);
}

/**
 * Mascara de exibicao. Os tres ultimos digitos de `12345678901` viram
 * `•••.•••.••9-01`.
 *
 * UM SO CARACTERE DE OCULTACAO, e isso era um bug de verdade: a versao
 * anterior misturava `•` e `*` na mesma string (`•••.•••.**1-91`), e o
 * resultado nao parecia um CPF -- a recepcao, que usa isto para confirmar
 * "e este mesmo?", tinha de decifrar o formato antes de comparar o numero.
 * O proprio comentario da funcao ja descrevia a forma certa; o codigo e que
 * nao a seguia.
 *
 * A FORMA DO CPF E PRESERVADA (`XXX.XXX.XXX-XX`) porque e ela que permite
 * comparar de relance com o documento na mao: contar posicao em `•••.•••.••9`
 * e imediato, em `***.***.**9` nao.
 */
export function mascararCpf(ultimos3: string | null): string | null {
  if (ultimos3 === null) return null;

  return `•••.•••.••${ultimos3.slice(0, 1)}-${ultimos3.slice(1)}`;
}

/**
 * Formata a matricula: `AP-{ano}-{8 digitos}`.
 *
 * NAO DERIVA DE CPF (INV-009, INV-011, `M1-BR-001`). O ano entra por
 * parametro, nunca de `new Date()` aqui dentro: funcao pura nao le relogio
 * (`CLAUDE.md`), e teste que depende do ano corrente quebra em 1o de
 * janeiro.
 */
export function formatarMatricula(ano: number, sequencial: number): string {
  return `AP-${ano}-${String(sequencial).padStart(8, '0')}`;
}
