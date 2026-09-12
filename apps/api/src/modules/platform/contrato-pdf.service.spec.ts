import { describe, expect, it } from '@jest/globals';

import { gerarPdfDoContrato, type DadosDoContratoImpresso } from './contrato-pdf.service.js';

const BASE: DadosDoContratoImpresso = {
  numero: 'C-0001',
  tenant: { displayName: 'Arena Positiva', legalName: 'Arena Positiva LTDA', cnpj: '12345678000199' },
  planoNome: 'Plano Base',
  model: 'PER_STUDENT',
  activeStudentPriceMinor: 500,
  inactiveStudentPriceMinor: 250,
  fixedPriceMinor: null,
  currency: 'BRL',
  indexCode: 'IPCA',
  baseDate: new Date('2026-03-01T00:00:00.000Z'),
  anniversaryDay: 1,
  anniversaryMonth: 3,
  graceDays: 15,
  issueDay: 1,
  mobileEnabled: true,
  kioskEnabled: true,
  startsAt: new Date('2026-03-01T00:00:00.000Z'),
  endsAt: null,
  geradoEm: new Date('2026-03-05T00:00:00.000Z'),
};

/**
 * Le o PDF DE VOLTA em vez de conferir o buffer.
 *
 * Afirmar tamanho ou prefixo `%PDF` passaria com uma pagina em branco -- e o
 * aceite da fatia e sobre o CONTEUDO: os valores impressos sao os do
 * contrato. `unpdf` ja e dependencia da API (extrator de laudo).
 */
async function textoDoPdf(bytes: Buffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const documento = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(documento, { mergePages: true });

  return Array.isArray(text) ? text.join(' ') : text;
}

describe('gerarPdfDoContrato', () => {
  it('imprime os valores por aluno em reais, e nao em centavos', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(BASE));

    expect(texto).toContain('R$ 5,00');
    expect(texto).toContain('R$ 2,50');
    expect(texto).toContain('Arena Positiva');
    expect(texto).toContain('IPCA');
  });

  it('imprime o valor fixo do contrato, e nao os precos por aluno', async () => {
    const texto = await textoDoPdf(
      await gerarPdfDoContrato({
        ...BASE,
        model: 'FIXED_MONTHLY',
        activeStudentPriceMinor: null,
        inactiveStudentPriceMinor: null,
        fixedPriceMinor: 149_900,
      }),
    );

    expect(texto).toContain('R$ 1.499,00');
    expect(texto).toContain('Fixo mensal');
    expect(texto).not.toContain('Aluno ativo');
  });

  it('imprime vigencia indeterminada quando o contrato nao tem fim', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(BASE));

    expect(texto).toContain('indeterminado');
    expect(texto).toContain('01/03/2026');
  });

  /*
   * O DOCUMENTO DIZ O QUE NAO FOI CONTRATADO -- F69.
   *
   * AFIRMA O PAR rotulo->valor, e nao cada palavra solta. `toContain('incluído')`
   * sozinho e inutil aqui: ele e substring de "não incluído", e passaria com um
   * PDF que imprimisse as DUAS superficies como nao contratadas -- exatamente o
   * defeito que este teste existe para pegar.
   *
   * Uma ligada e uma desligada no mesmo PDF pela mesma razao: prova que cada
   * linha le a propria flag, em vez de repetir um texto fixo.
   */
  it('imprime a superficie nao contratada, e nao so a contratada', async () => {
    const texto = await textoDoPdf(
      await gerarPdfDoContrato({ ...BASE, mobileEnabled: true, kioskEnabled: false }),
    );

    expect(texto).toMatch(/App mobile do aluno\s*incluído/);
    expect(texto).toMatch(/Totem de autoatendimento\s*não incluído/);
  });

  it('separa milhar e mantem os centavos exatos', async () => {
    const texto = await textoDoPdf(
      await gerarPdfDoContrato({
        ...BASE,
        model: 'FIXED_MONTHLY',
        activeStudentPriceMinor: null,
        inactiveStudentPriceMinor: null,
        fixedPriceMinor: 1_234_567,
      }),
    );

    expect(texto).toContain('R$ 12.345,67');
  });

  /*
   * SECAO II E III -- F70 (ADR-055).
   *
   * `clausulas` presente muda o titulo, qualifica as DUAS partes e acrescenta
   * as clausulas 1-13 e o bloco de assinaturas. Ausente (chamador antigo),
   * o comportamento pre-F70 continua identico -- os testes acima provam isso.
   */
  const COM_CLAUSULAS: DadosDoContratoImpresso = {
    ...BASE,
    clausulas: {
      termsVersion: '2026.1',
      contratada: {
        razaoSocial: 'RRB TRADING LTDA',
        cnpj: '11222333000144',
        endereco: 'Rua Exemplo, 100, São Paulo/SP',
        representante: 'Rodrigo Reis',
        email: 'contato@rrbtrading.com',
      },
      contratante: {
        razaoSocial: 'Arena Positiva LTDA',
        cnpj: '12345678000199',
        endereco: 'Av. Central, 200, Arenápolis/MT',
        representante: 'Fulano de Tal',
        email: 'contato@arenapositiva.com',
      },
      foroCidade: 'Cuiabá',
      foroUf: 'MT',
    },
  };

  it('imprime o titulo de licenca de uso quando ha clausulas, e qualifica as duas partes', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(COM_CLAUSULAS));

    expect(texto).toContain('Contrato de licença de uso de software');
    expect(texto).toContain('RRB TRADING LTDA');
    expect(texto).toContain('Arena Positiva LTDA');
    expect(texto).toContain('2026.1');
  });

  it('imprime as clausulas da versao gravada, incluindo suspensao por inadimplencia e LGPD', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(COM_CLAUSULAS));

    expect(texto).toContain('Cláusula 5 — Inadimplência e suspensão');
    expect(texto).toContain('CONTRATANTE é a controladora');
    expect(texto).toContain('CONTRATADA é a operadora');
    expect(texto).toContain('biometria facial é dado pessoal sensível');
  });

  it('imprime a secao de assinaturas com as duas partes e testemunhas', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(COM_CLAUSULAS));

    expect(texto).toContain('Seção III — Assinaturas');
    expect(texto).toContain('CONTRATADA');
    expect(texto).toContain('CONTRATANTE');
    expect(texto).toContain('Testemunhas');
    expect(texto).toContain('Cuiabá/MT');
  });

  it('marca campo sem valor decidido com placeholder visivel, nunca com silencio', async () => {
    const texto = await textoDoPdf(
      await gerarPdfDoContrato({
        ...COM_CLAUSULAS,
        clausulas: {
          ...COM_CLAUSULAS.clausulas!,
          contratada: { ...COM_CLAUSULAS.clausulas!.contratada, cnpj: null },
          foroCidade: null,
          foroUf: null,
        },
      }),
    );

    expect(texto).toContain('[a definir pelo PI]');
    expect(texto).not.toContain('não informado');
  });

  it('nao muda a secao I quando chamado sem clausulas -- compatibilidade com o chamador anterior', async () => {
    const texto = await textoDoPdf(await gerarPdfDoContrato(BASE));

    expect(texto).toContain('Contrato de prestação de serviço');
    expect(texto).not.toContain('Seção II');
  });
});
