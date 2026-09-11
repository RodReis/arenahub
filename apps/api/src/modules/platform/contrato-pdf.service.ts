import PDFDocument from 'pdfkit';

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
 * PDF do contrato entre o ArenaHub e a academia -- ADR-052 §8.
 *
 * SEM ASSINATURA ELETRONICA, por decisao registrada: o documento REGISTRA o
 * que foi acordado, e nao substitui contrato assinado fora do sistema.
 *
 * `pdfkit`, e nao HTML para PDF: um renderizador de navegador no servidor e
 * uma dependencia de centenas de megabytes e um processo a mais para gerar
 * uma pagina de texto. Montar os bytes do PDF a mao foi descartado pelo outro
 * lado -- fonte, encoding e tabela de offsets sao onde esse arquivo quebra.
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

    documento.font('Helvetica-Bold').fontSize(18).fillColor('#111111').text('Contrato de prestação de serviço');
    documento.font('Helvetica').fontSize(10).fillColor('#555555').text(`ArenaHub · nº ${dados.numero}`);

    secao('Contratante');
    linha('Nome', dados.tenant.displayName);
    linha('Razão social', dados.tenant.legalName);
    linha('CNPJ', dados.tenant.cnpj ?? 'não informado');

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

    documento.end();
  });
}
