import type { LinhaDoRelatorioDeAlunos } from './filtro-do-relatorio-de-alunos.js';

/** Quem emite o relatório -- o que vai no cabeçalho do PDF e do CSV. */
export interface CabecalhoDaAcademia {
  readonly nome: string;
  readonly razaoSocial: string;
  /** 14 dígitos, como no cadastro. */
  readonly cnpj: string | null;
  readonly endereco: string | null;
  readonly telefone: string | null;
  /** Fuso IANA em que `geradoEm` é mostrado. */
  readonly fuso: string;
  /** `null` = sem logo, ilegível ou de outro tenant: o cabeçalho cai para texto. */
  readonly logo: { readonly body: Buffer; readonly contentType: string } | null;
}

export interface DadosDoRelatorioImpresso {
  readonly academia: CabecalhoDaAcademia;
  /** Linhas já em pt-BR (`descreverFiltro`). Vazia = "Nenhum". */
  readonly filtros: readonly string[];
  readonly geradoEm: Date;
  readonly total: number;
  readonly linhas: readonly LinhaDoRelatorioDeAlunos[];
}
