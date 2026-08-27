import { triarAlias } from './triagem-de-alias.js';

const SEM_BLOQUEIO: readonly string[] = [];

describe('triarAlias -- normalizacao', () => {
  it('normaliza para NFKC e minusculas', () => {
    // 'Ｔｉｇｒｅ' em largura total vira 'tigre' -- senao dois alunos ficam
    // com aliases visualmente iguais e o indice unico nao percebe.
    expect(triarAlias('Ｔｉｇｒｅ', SEM_BLOQUEIO).normalizado).toBe('tigre');
  });

  it('colapsa espaco repetido e apara as pontas', () => {
    expect(triarAlias('  Tigre   de   Aco  ', SEM_BLOQUEIO).normalizado).toBe('tigre de aco');
  });

  it('remove caractere invisivel e SINALIZA', () => {
    // U+200B (zero-width space) faz 'tigre' e 'ti​gre' passarem por
    // alias diferentes no banco e identicos na tela.
    const resultado = triarAlias('ti​gre', SEM_BLOQUEIO);
    expect(resultado.normalizado).toBe('tigre');
    expect(resultado.sinais).toContain('CARACTERE_INVISIVEL');
  });
});

describe('triarAlias -- sinais', () => {
  it('sinaliza alias curto demais', () => {
    expect(triarAlias('a', SEM_BLOQUEIO).sinais).toContain('CURTO_DEMAIS');
  });

  it('sinaliza alias longo demais', () => {
    expect(triarAlias('a'.repeat(25), SEM_BLOQUEIO).sinais).toContain('LONGO_DEMAIS');
  });

  it.each([
    ['ana@exemplo.com', 'PARECE_EMAIL'],
    ['41999998888', 'PARECE_TELEFONE'],
    ['529.982.247-25', 'PARECE_CPF'],
  ] as const)('sinaliza PII: %s', (bruto, sinal) => {
    expect(triarAlias(bruto, SEM_BLOQUEIO).sinais).toContain(sinal);
  });

  it('sinaliza palavra bloqueada do tenant', () => {
    expect(triarAlias('Tigre Palavrao', ['palavrao']).sinais).toContain('PALAVRA_BLOQUEADA');
  });

  it('pega palavra bloqueada com acento e caixa diferentes', () => {
    expect(triarAlias('ARROMBÁDO', ['arrombado']).sinais).toContain('PALAVRA_BLOQUEADA');
  });

  it('sinaliza alias so de simbolos', () => {
    expect(triarAlias('!!!###', SEM_BLOQUEIO).sinais).toContain('SO_SIMBOLOS');
  });

  it('alias limpo nao gera sinal nenhum', () => {
    expect(triarAlias('Tigre', SEM_BLOQUEIO).sinais).toEqual([]);
  });
});
