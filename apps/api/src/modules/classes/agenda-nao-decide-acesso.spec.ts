import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

/**
 * ADR-061 decisao no 2: a catraca NAO SABE QUE AULA EXISTE. Nenhuma PR da
 * F77 pode mudar isso (SPEC-077 §4, escopo negativo).
 *
 * MESMO DESENHO ESTRUTURAL de `gym-unit-nao-decide-acesso.spec.ts`: le o
 * CODIGO-FONTE do motor de decisao, em vez de montar cenario. Um teste de
 * comportamento so pegaria a regressao no dia em que alguem testasse
 * exatamente o caso "aluno com aula lotada" -- este pega no dia em que a
 * import entrar, antes de causar dano.
 *
 * QUANDO ESTE TESTE FALHAR, a correcao quase nunca e edita-lo: e tirar a
 * referencia a `Class`/`ClassException` do modulo de acesso. Se a leitura
 * for mesmo necessaria, ela exige ADR novo aprovado pelo PI que revogue o
 * ADR-061 decisao no 2 -- e ai sim a excecao entra aqui, nomeada.
 */

const PASTAS_DO_MOTOR_DE_ACESSO = [
  join(process.cwd(), 'src', 'modules', 'access'),
  join(process.cwd(), 'src', 'modules', 'access-query'),
];

function arquivosDeProducao(): string[] {
  return PASTAS_DO_MOTOR_DE_ACESSO.flatMap((pasta) =>
    readdirSync(pasta)
      .filter((nome) => nome.endsWith('.ts') && !nome.endsWith('.spec.ts'))
      .map((nome) => join(pasta, nome)),
  );
}

describe('a agenda de aulas nao participa da decisao de acesso', () => {
  it('os modulos de acesso existem e tem arquivos a inspecionar', () => {
    // Sem esta assercao, pasta renomeada faria os testes abaixo passarem
    // por vacuidade -- verde por nao ter olhado nada.
    expect(arquivosDeProducao().length).toBeGreaterThan(0);
  });

  it.each(arquivosDeProducao())('%s nao referencia a agenda de aulas', (caminho) => {
    const fonte = readFileSync(caminho, 'utf8');

    expect(fonte).not.toMatch(/\bdb\.class\b|\bClassRepository\b|\bClassException\b/);
  });
});
