import PDFDocument from 'pdfkit';

import { A_DEFINIR, termosDaVersao } from './domain/termos-do-contrato.js';

/**
 * Qualificacao de uma parte no contrato -- F70 (ADR-055 §6, SPEC-070 §4).
 *
 * Campo `null` vira `A_DEFINIR` no papel, NUNCA "não informado" -- e a
 * distincao que a SPEC-070 §6 exige: "não informado" leu como dado que
 * ninguem preencheu ainda; a marca visivel le como contrato que nao pode
 * ativar sem ele (ver `tenant-contract.use-case.ts`).
 */
export interface ParteDoContrato {
  readonly razaoSocial: string;
  readonly cnpj: string | null;
  readonly endereco: string | null;
  readonly representante: string | null;
  readonly email: string | null;
}

/**
 * O que sai impresso no contrato. Note o que NAO esta aqui: nenhum campo do
 * `SaasPlan`.
 *
 * E o aceite da fatia -- "o PDF gerado reproduz os valores do contrato, nao
 * do plano atual". Aceitar o plano como parametro deixaria o proximo autor
 * imprimir `plano.fixedPriceMinor` sem perceber, e o documento passaria a
 * mudar sozinho toda vez que alguem editasse o catalogo. O tipo e a defesa:
 * o dado nao esta ao alcance.
 */
export interface DadosDoContratoImpresso {
  readonly numero: string;
  readonly tenant: { readonly displayName: string; readonly legalName: string; readonly cnpj: string | null };
  /** Nome do plano COPIADO no fechamento -- rotulo, nao referencia viva. */
  readonly planoNome: string;
  readonly model: 'PER_STUDENT' | 'FIXED_MONTHLY';
  readonly activeStudentPriceMinor: number | null;
  readonly inactiveStudentPriceMinor: number | null;
  readonly fixedPriceMinor: number | null;
  readonly currency: string;
  readonly indexCode: string;
  readonly baseDate: Date;
  readonly anniversaryDay: number;
  readonly anniversaryMonth: number;
  readonly graceDays: number;
  readonly issueDay: number;
  /** Superficies contratadas -- o que a academia recebe, e o que ela nao recebe. */
  readonly mobileEnabled: boolean;
  readonly kioskEnabled: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly geradoEm: Date;
  /**
   * Seçao II e III -- F70. Opcional para nao quebrar chamador antigo, mas
   * `tenant-contract.use-case.ts` sempre preenche a partir da F70 em diante.
   */
  readonly clausulas?: {
    readonly termsVersion: string;
    readonly contratada: ParteDoContrato;
    readonly contratante: ParteDoContrato;
    readonly foroCidade: string | null;
    readonly foroUf: string | null;
  };
}

/**
 * Centavos -> `R$ 1.234,56`.
 *
 * `Intl.NumberFormat` NAO entra aqui: o documento e o mesmo em qualquer
 * maquina, e o formato do PDF nao pode depender do locale do servidor. A
 * formatacao e explicita pelo mesmo motivo que dinheiro e inteiro.
 */
function formatarDinheiro(minor: number, moeda: string): string {
  const sinal = minor < 0 ? '-' : '';
  const absoluto = Math.abs(minor);
  const inteiros = Math.trunc(absoluto / 100).toString();
  const centavos = (absoluto % 100).toString().padStart(2, '0');
  const comSeparador = inteiros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const simbolo = moeda === 'BRL' ? 'R$ ' : `${moeda} `;

  return `${sinal}${simbolo}${comSeparador},${centavos}`;
}

/** `2026-03-01` -> `01/03/2026`, sempre em UTC (a data e `@db.Date`). */
function formatarData(data: Date): string {
  const dia = data.getUTCDate().toString().padStart(2, '0');
  const mes = (data.getUTCMonth() + 1).toString().padStart(2, '0');

  return `${dia}/${mes}/${data.getUTCFullYear()}`;
}

const MARGEM = 56;
const LARGURA_DO_ROTULO = 190;

/**
 * PDF do contrato entre o ArenaHub e a academia -- F63/F70 (ADR-052 §8,
 * ADR-055).
 *
 * TRES SECOES, nesta ordem: I. Quadro resumo (o que ja existia -- valores
 * copiados do contrato, nunca do plano); II. Clausulas (texto versionado por
 * `termsVersion`, lido de `termos-do-contrato.ts`); III. Assinaturas (as
 * duas partes e duas testemunhas). A Secao I sozinha era "ficha de dados";
 * as tres juntas sao contrato (SPEC-070 §1).
 *
 * SEM ASSINATURA ELETRONICA, por decisao registrada (ADR-055, "Assinatura:
 * por que nao integrar agora"): o documento REGISTRA o que foi acordado, e
 * quem assina sobe o PDF assinado depois pela rota propria.
 *
 * `pdfkit`, e nao HTML para PDF: um renderizador de navegador no servidor e
 * uma dependencia de centenas de megabytes e um processo a mais para gerar
 * um documento de texto. Montar os bytes do PDF a mao foi descartado pelo
 * outro lado -- fonte, encoding e tabela de offsets sao onde esse arquivo
 * quebra.
 */
export function gerarPdfDoContrato(dados: DadosDoContratoImpresso): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const documento = new PDFDocument({ size: 'A4', margin: MARGEM, info: { Title: `Contrato ${dados.numero}` } });
    const pedacos: Buffer[] = [];

    documento.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    documento.on('end', () => resolver(Buffer.concat(pedacos)));
    documento.on('error', rejeitar);

    const linha = (rotulo: string, valor: string): void => {
      const y = documento.y;

      documento.font('Helvetica').fontSize(10).fillColor('#555555');
      documento.text(rotulo, MARGEM, y, { width: LARGURA_DO_ROTULO });
      documento.font('Helvetica-Bold').fontSize(10).fillColor('#111111');
      documento.text(valor, MARGEM + LARGURA_DO_ROTULO, y, {
        width: documento.page.width - MARGEM * 2 - LARGURA_DO_ROTULO,
      });
      documento.moveDown(0.6);
    };

    const secao = (titulo: string): void => {
      documento.moveDown(0.8);
      documento.font('Helvetica-Bold').fontSize(12).fillColor('#111111').text(titulo);
      documento.moveDown(0.4);
    };

    const paragrafo = (texto: string, opcoes: { negrito?: boolean; tamanho?: number; cor?: string } = {}): void => {
      documento
        .font(opcoes.negrito ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opcoes.tamanho ?? 10)
        .fillColor(opcoes.cor ?? '#111111')
        .text(texto, MARGEM, documento.y, { width: documento.page.width - MARGEM * 2 });
      documento.moveDown(0.4);
    };

    // -------------------------------------------------------------------
    // CABECALHO
    // -------------------------------------------------------------------
    const titulo = dados.clausulas
      ? 'Contrato de licença de uso de software em regime de assinatura e prestação de serviços de suporte'
      // Chamador antigo (sem `clausulas`) mantem o titulo pre-F70 -- nao ha
      // chamador assim em producao, mas o tipo continua opcional.
      : 'Contrato de prestação de serviço';

    documento.font('Helvetica-Bold').fontSize(16).fillColor('#111111').text(titulo);
    documento.font('Helvetica').fontSize(10).fillColor('#555555').text(`ArenaHub · nº ${dados.numero}`);
    if (dados.clausulas) {
      documento.text(`Versão dos termos: ${dados.clausulas.termsVersion}`);
    }

    // -------------------------------------------------------------------
    // QUALIFICACAO DAS PARTES -- so quando ha dados de clausulas (F70).
    // -------------------------------------------------------------------
    if (dados.clausulas) {
      const { contratada, contratante } = dados.clausulas;

      secao('Contratada');
      linha('Razão social', contratada.razaoSocial);
      linha('CNPJ', contratada.cnpj ?? A_DEFINIR);
      linha('Endereço', contratada.endereco ?? A_DEFINIR);
      linha('Representante', contratada.representante ?? A_DEFINIR);
      linha('E-mail', contratada.email ?? A_DEFINIR);

      secao('Contratante');
      linha('Razão social', contratante.razaoSocial);
      linha('CNPJ', contratante.cnpj ?? A_DEFINIR);
      linha('Endereço', contratante.endereco ?? A_DEFINIR);
      linha('Representante', contratante.representante ?? A_DEFINIR);
      linha('E-mail', contratante.email ?? A_DEFINIR);

      documento.moveDown(0.4);
      paragrafo(
        'As partes acima qualificadas celebram o presente contrato, que se regerá pelas cláusulas seguintes e pelo Quadro resumo da Seção I, parte integrante deste instrumento.',
        { tamanho: 9, cor: '#555555' },
      );
    } else {
      secao('Contratante');
      linha('Nome', dados.tenant.displayName);
      linha('Razão social', dados.tenant.legalName);
      linha('CNPJ', dados.tenant.cnpj ?? 'não informado');
    }

    // -------------------------------------------------------------------
    // SECAO I -- QUADRO RESUMO (F63, mantida integralmente)
    // -------------------------------------------------------------------
    documento.addPage();
    secao('Seção I — Quadro resumo');

    secao('Plano contratado');
    linha('Plano', dados.planoNome);

    if (dados.model === 'PER_STUDENT') {
      linha('Modelo', 'Por aluno');
      linha(
        'Aluno ativo',
        `${formatarDinheiro(dados.activeStudentPriceMinor ?? 0, dados.currency)} por mês`,
      );
      linha(
        'Aluno inativo',
        `${formatarDinheiro(dados.inactiveStudentPriceMinor ?? 0, dados.currency)} por mês`,
      );
      documento
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#555555')
        .text(
          'Aluno ativo é o aluno em situação ativa no dia da emissão; inativo é qualquer outra situação.',
          MARGEM,
          documento.y,
          { width: documento.page.width - MARGEM * 2 },
        );
      documento.moveDown(0.6);
    } else {
      linha('Modelo', 'Fixo mensal');
      linha('Valor mensal', formatarDinheiro(dados.fixedPriceMinor ?? 0, dados.currency));
    }

    /*
     * SUPERFICIES NO PAPEL, incluindo as NAO contratadas.
     *
     * Imprimir so o que foi incluido faria o documento calar sobre a metade
     * que mais gera discussao depois -- "o totem nao liga" com um contrato
     * que nao diz nada a respeito. O "Nao incluido" impresso e a prova do que
     * foi negociado.
     */
    secao('Superfícies contratadas');
    linha('App mobile do aluno', dados.mobileEnabled ? 'incluído' : 'não incluído');
    linha('Totem de autoatendimento', dados.kioskEnabled ? 'incluído' : 'não incluído');

    secao('Reajuste e cobrança');
    linha('Índice de correção', dados.indexCode);
    linha('Data-base', formatarData(dados.baseDate));
    linha(
      'Aniversário',
      `dia ${dados.anniversaryDay} do mês ${dados.anniversaryMonth.toString().padStart(2, '0')}`,
    );
    linha('Dia de emissão', `dia ${dados.issueDay} de cada mês`);
    linha('Carência', `${dados.graceDays} dias após o vencimento`);

    secao('Vigência');
    linha('Início', formatarData(dados.startsAt));
    linha('Término', dados.endsAt ? formatarData(dados.endsAt) : 'indeterminado');

    documento.moveDown(1.5);
    documento
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#777777')
      .text(
        `Documento gerado pelo ArenaHub em ${formatarData(dados.geradoEm)}. Os valores acima são os acordados no fechamento deste contrato e não mudam com alterações posteriores no catálogo de planos.`,
        MARGEM,
        documento.y,
        { width: documento.page.width - MARGEM * 2 },
      );

    // -------------------------------------------------------------------
    // SECAO II -- CLAUSULAS, e SECAO III -- ASSINATURAS (F70)
    // -------------------------------------------------------------------
    if (dados.clausulas) {
      const termos = termosDaVersao(dados.clausulas.termsVersion);

      documento.addPage();
      secao('Seção II — Cláusulas');

      for (const clausula of termos.clausulas) {
        documento.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text(clausula.titulo);
        documento.moveDown(0.3);

        for (const paragrafoTexto of clausula.paragrafos) {
          paragrafo(paragrafoTexto, { tamanho: 9.5 });
        }

        documento.moveDown(0.4);
      }

      documento.addPage();
      secao('Seção III — Assinaturas');

      const foro = dados.clausulas.foroCidade
        ? `${dados.clausulas.foroCidade}${dados.clausulas.foroUf ? `/${dados.clausulas.foroUf}` : ''}`
        : A_DEFINIR;

      paragrafo(`Local e data: ${foro}, ${formatarData(dados.geradoEm)}.`, { tamanho: 10 });
      documento.moveDown(1.5);

      const larguraColuna = (documento.page.width - MARGEM * 2 - 20) / 2;
      const yAssinaturas = documento.y;

      documento
        .font('Helvetica')
        .fontSize(9)
        .text('_______________________________', MARGEM, yAssinaturas, { width: larguraColuna });
      documento.text('CONTRATADA', MARGEM, documento.y, { width: larguraColuna });
      documento.text(dados.clausulas.contratada.razaoSocial, MARGEM, documento.y, { width: larguraColuna });
      documento.text(dados.clausulas.contratada.representante ?? A_DEFINIR, MARGEM, documento.y, {
        width: larguraColuna,
      });

      const xColunaDois = MARGEM + larguraColuna + 20;

      documento
        .font('Helvetica')
        .fontSize(9)
        .text('_______________________________', xColunaDois, yAssinaturas, { width: larguraColuna });
      documento.text('CONTRATANTE', xColunaDois, undefined, { width: larguraColuna });
      documento.text(dados.clausulas.contratante.razaoSocial, xColunaDois, undefined, { width: larguraColuna });
      documento.text(
        `${dados.clausulas.contratante.representante ?? A_DEFINIR}`,
        xColunaDois,
        undefined,
        { width: larguraColuna },
      );

      documento.moveDown(2);
      documento.font('Helvetica-Bold').fontSize(10).text('Testemunhas', MARGEM, documento.y);
      documento.moveDown(1.5);

      const yTestemunhas = documento.y;

      documento
        .font('Helvetica')
        .fontSize(9)
        .text('_______________________________', MARGEM, yTestemunhas, { width: larguraColuna });
      documento.text('Nome:', MARGEM, documento.y, { width: larguraColuna });
      documento.text('CPF:', MARGEM, documento.y, { width: larguraColuna });

      documento
        .font('Helvetica')
        .fontSize(9)
        .text('_______________________________', xColunaDois, yTestemunhas, { width: larguraColuna });
      documento.text('Nome:', xColunaDois, undefined, { width: larguraColuna });
      documento.text('CPF:', xColunaDois, undefined, { width: larguraColuna });
    }

    documento.end();
  });
}
