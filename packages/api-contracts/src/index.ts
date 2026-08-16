/**
 * Contratos compartilhados entre API, Edge Agent e clientes.
 *
 * O que entra aqui e o que PRECISA ser identico nos dois lados. Duas
 * implementacoes da mesma regra divergem no primeiro detalhe esquecido.
 */
export {
  assinar,
  assinaturaConfere,
  calcularHashDoCorpo,
  calcularHashDoNonce,
  montarTextoCanonico,
  normalizarCaminhoEQuery,
  timestampEstaNaJanela,
  CABECALHOS,
  JANELA_DE_RELOGIO_EM_SEGUNDOS,
  PREFIXO_CANONICO,
  type MotivoDeRecusa,
  type RequisicaoAssinavel,
} from './edge-auth.js';
