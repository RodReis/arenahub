import PDFDocument from 'pdfkit';

import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import type { LinhaDoRelatorioDeAlunos } from './filtro-do-relatorio-de-alunos.js';
import {
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
} from './formato-brasileiro.js';

type Documento = InstanceType<typeof PDFDocument>;

const MARGEM = 40;
const LARGURA_UTIL = 515; // A4 (595,28) - 2 * MARGEM
const ALTURA_DA_LINHA = 18;
const RESERVA_DO_RODAPE = 36;
const LADO_DO_LOGO = 56;

/** A soma das larguras é `LARGURA_UTIL`. */
const COLUNAS = [
  { titulo: 'Catraca', largura: 62 },
  { titulo: 'Nome', largura: 168 },
  { titulo: 'CPF', largura: 90 },
  { titulo: 'Contato', largura: 95 },
  { titulo: 'Plano', largura: 100 },
] as const;

/**
 * Tipos que o `pdfkit` embute. SVG é aceito no upload da identidade visual
 * (F62), mas `pdfkit` não o renderiza -- o relatório sai com cabeçalho só de
 * texto. ponytail: SVG fica sem logo no PDF; subir `svg-to-pdfkit` só se o PI
 * pedir (é dependência nova para um cabeçalho).
 */
const IMAGENS_ACEITAS = new Set(['image/png', 'image/jpeg']);

/**
 * PDF do Relatório de Alunos.
 *
 * `pdfkit` (já usado no contrato da plataforma), tabela desenhada à mão com
 * posição explícita: toda linha tem altura fixa e o texto é cortado com
 * reticências, então a conta de "quantas linhas cabem na página" é exata e o
 * `pdfkit` nunca quebra página por conta própria no meio de uma linha.
 *
 * Fonte Helvetica (WinAnsi): acentos do português funcionam; caractere fora
 * do Latin-1 (p.ex. "ł") sai errado. Aceito -- nomes de academia brasileira.
 */
export function gerarPdfDoRelatorio(dados: DadosDoRelatorioImpresso): Promise<Buffer> {
  return new Promise((resolver, rejeitar) => {
    const documento = new PDFDocument({
      size: 'A4',
      margin: MARGEM,
      bufferPages: true,
      info: { Title: 'Relatório de Alunos', Author: dados.academia.nome },
    });
    const pedacos: Buffer[] = [];

    documento.on('data', (pedaco: Buffer) => pedacos.push(pedaco));
    documento.on('end', () => resolver(Buffer.concat(pedacos)));
    documento.on('error', rejeitar);

    try {
      let y = desenharCabecalho(documento, dados);
      y = desenharTitulosDaTabela(documento, y);

      dados.linhas.forEach((aluno, indice) => {
        if (y + ALTURA_DA_LINHA > documento.page.height - MARGEM - RESERVA_DO_RODAPE) {
          documento.addPage();
          y = desenharTitulosDaTabela(documento, MARGEM);
        }

        desenharLinha(documento, aluno, y, indice % 2 === 1);
        y += ALTURA_DA_LINHA;
      });

      desenharRodapes(documento);
      documento.end();
    } catch (erro) {
      rejeitar(erro instanceof Error ? erro : new Error(String(erro)));
    }
  });
}

/** Devolve o `y` onde a tabela começa. */
function desenharCabecalho(doc: Documento, dados: DadosDoRelatorioImpresso): number {
  const { academia } = dados;
  let xDoTexto = MARGEM;
  let logoDesenhado = false;

  if (academia.logo && IMAGENS_ACEITAS.has(academia.logo.contentType)) {
    try {
      doc.image(academia.logo.body, MARGEM, MARGEM, { fit: [LADO_DO_LOGO, LADO_DO_LOGO] });
      xDoTexto = MARGEM + LADO_DO_LOGO + 12;
      logoDesenhado = true;
    } catch {
      // Imagem corrompida: o relatório vale mais que o logo. Segue só com texto.
    }
  }

  const largura = LARGURA_UTIL - (xDoTexto - MARGEM);

  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111111');
  doc.text(academia.nome, xDoTexto, MARGEM, { width: largura });

  const detalhes = [
    academia.razaoSocial !== academia.nome ? academia.razaoSocial : null,
    academia.cnpj === null ? null : `CNPJ ${formatarCnpj(academia.cnpj)}`,
    academia.endereco,
    academia.telefone === null ? null : `Tel. ${formatarTelefone(academia.telefone)}`,
  ].filter((linha): linha is string => linha !== null && linha !== '');

  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  for (const linha of detalhes) doc.text(linha, xDoTexto, doc.y, { width: largura });

  let y = Math.max(doc.y, logoDesenhado ? MARGEM + LADO_DO_LOGO : 0) + 14;

  doc.moveTo(MARGEM, y).lineTo(MARGEM + LARGURA_UTIL, y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  y += 12;

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111');
  doc.text('Relatório de Alunos', MARGEM, y, { width: LARGURA_UTIL });

  doc.font('Helvetica').fontSize(9).fillColor('#555555');
  doc.text(
    `Gerado em ${formatarDataHora(dados.geradoEm, academia.fuso)} · ${dados.total} aluno(s)`,
    MARGEM,
    doc.y + 4,
    { width: LARGURA_UTIL },
  );
  doc.text(
    `Filtros: ${dados.filtros.length > 0 ? dados.filtros.join(' · ') : 'nenhum'}`,
    MARGEM,
    doc.y + 2,
    { width: LARGURA_UTIL },
  );

  return doc.y + 12;
}

function desenharTitulosDaTabela(doc: Documento, y: number): number {
  doc.rect(MARGEM, y, LARGURA_UTIL, ALTURA_DA_LINHA).fill('#eeeeee');
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#111111');

  let x = MARGEM;
  for (const coluna of COLUNAS) {
    doc.text(coluna.titulo, x + 4, y + 5, { width: coluna.largura - 8, height: 11, ellipsis: true });
    x += coluna.largura;
  }

  return y + ALTURA_DA_LINHA;
}

function desenharLinha(doc: Documento, aluno: LinhaDoRelatorioDeAlunos, y: number, zebra: boolean): void {
  if (zebra) doc.rect(MARGEM, y, LARGURA_UTIL, ALTURA_DA_LINHA).fill('#f7f7f7');

  const celulas = [
    aluno.deviceIds.join(', '),
    aluno.fullName,
    formatarCpf(aluno.cpf),
    formatarTelefone(aluno.phone),
    aluno.planLabel ?? '',
  ];

  doc.font('Helvetica').fontSize(9).fillColor('#111111');

  let x = MARGEM;
  COLUNAS.forEach((coluna, i) => {
    doc.text(celulas[i] ?? '', x + 4, y + 5, { width: coluna.largura - 8, height: 11, ellipsis: true });
    x += coluna.largura;
  });
}

/** "Página X de Y" -- só dá para saber o Y no fim, por isso `bufferPages`. */
function desenharRodapes(doc: Documento): void {
  const { start, count } = doc.bufferedPageRange();

  for (let i = 0; i < count; i += 1) {
    doc.switchToPage(start + i);
    // Sem zerar a margem inferior, escrever no rodapé faz o pdfkit abrir uma página nova.
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor('#777777');
    doc.text(`Página ${i + 1} de ${count}`, MARGEM, doc.page.height - 30, {
      width: LARGURA_UTIL,
      align: 'center',
    });
  }
}
