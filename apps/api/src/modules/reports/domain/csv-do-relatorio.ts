import { formatarCelula } from '../../exports/domain/csv.js';
import type { DadosDoRelatorioImpresso } from './dados-do-relatorio.js';
import {
  formatarCnpj,
  formatarCpf,
  formatarDataHora,
  formatarTelefone,
} from './formato-brasileiro.js';

const SEPARADOR = ';';
const BOM = String.fromCharCode(0xfeff);
const FIM_DE_LINHA = '\r\n';

type Celula = string | number | null;

/**
 * Ponto e vírgula, e não vírgula: o Excel em pt-BR usa vírgula como separador
 * decimal e abriria o arquivo inteiro numa coluna só. O BOM é o que faz o
 * Excel reconhecer UTF-8 -- sem ele, "Ação" vira "AÃ§Ã£o".
 */
const linha = (celulas: readonly Celula[]): string =>
  celulas.map((c) => formatarCelula(c, SEPARADOR)).join(SEPARADOR);

export function montarCsvDoRelatorio(dados: DadosDoRelatorioImpresso): Buffer {
  const { academia } = dados;

  const linhas: (readonly Celula[])[] = [
    ['Relatório de Alunos'],
    [academia.nome],
    ['Razão social', academia.razaoSocial],
    ['CNPJ', academia.cnpj === null ? '' : formatarCnpj(academia.cnpj)],
    ['Endereço', academia.endereco ?? ''],
    ['Telefone', formatarTelefone(academia.telefone)],
    ['Gerado em', formatarDataHora(dados.geradoEm, academia.fuso)],
    ['Filtros', dados.filtros.length > 0 ? dados.filtros.join(' | ') : 'Nenhum'],
    ['Total de alunos', dados.total],
    [],
    ['Catraca', 'Nome', 'CPF', 'Contato', 'Plano'],
    ...dados.linhas.map((aluno) => [
      aluno.deviceIds.join(', '),
      aluno.fullName,
      formatarCpf(aluno.cpf),
      formatarTelefone(aluno.phone),
      aluno.planLabel ?? '',
    ]),
  ];

  return Buffer.from(BOM + linhas.map(linha).join(FIM_DE_LINHA) + FIM_DE_LINHA, 'utf8');
}
