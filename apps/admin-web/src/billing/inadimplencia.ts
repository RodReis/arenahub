/**
 * Regras de apresentacao da tela de inadimplencia -- F15, Slice 2.4.
 *
 * FUNCOES PURAS, fora do componente: dentro dele so seriam testaveis montando
 * a pagina inteira, e as duas tem caso de borda que merece teste proprio.
 */

export interface LinhaDeInadimplencia {
  readonly studentName: string;
  readonly situacao: string;
  readonly liberadoAte: string | null;
}

/**
 * O que o badge mostra.
 *
 * LIBERACAO VENCE BLOQUEIO na exibicao, porque e o que responde a pergunta que
 * traz a recepcao a esta tela: "este aluno entra agora?". Um aluno liberado
 * ainda esta bloqueado no sentido financeiro -- a divida nao sumiu --, mas
 * mostrar "Bloqueado" faria a recepcao barrar quem tem passagem autorizada,
 * que e o oposto do que a liberacao existe para permitir.
 *
 * A divida continua visivel nas outras colunas: valor, vencimento e dias de
 * atraso nao mudam. So o badge de ACESSO reflete a liberacao.
 */
export function situacaoVisivel(linha: LinhaDeInadimplencia): string {
  return linha.liberadoAte !== null ? 'LIBERADO' : linha.situacao;
}

/**
 * Link `wa.me` com a mensagem pronta.
 *
 * NAO E INTEGRACAO: abre o WhatsApp do proprio operador, que revisa e envia.
 * Decisao do PI em 19/08/2026 -- API oficial exigiria provedor, template
 * homologado e consentimento de contato, o que e fatia propria.
 *
 * O texto e deliberadamente CURTO e sem valor em reais: a recepcao completa o
 * que quiser antes de mandar, e uma cobranca automatica com numero pode chegar
 * errada se o aluno acabou de pagar.
 */
export function linkDeCobranca(
  telefone: string,
  nomeDoAluno: string,
  numeroDaFatura: number,
): string {
  const numero = apenasDigitos(telefone);
  const primeiroNome = nomeDoAluno.trim().split(/\s+/)[0] ?? '';

  const mensagem = `Ola, ${primeiroNome}! Passando para lembrar da fatura ${String(numeroDaFatura)}, que esta em aberto. Qualquer duvida e so chamar.`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

/**
 * Telefone em digitos, com DDI do Brasil quando falta.
 *
 * O `wa.me` exige o numero internacional sem sinal nem pontuacao. Cadastro
 * brasileiro raramente traz o `55`, e sem ele o link abre uma conversa com
 * numero invalido -- falha silenciosa, que a recepcao so descobre com o
 * cliente esperando.
 */
function apenasDigitos(telefone: string): string {
  const digitos = telefone.replace(/\D/g, '');

  /**
   * 10 ou 11 digitos e numero nacional (DDD + assinante). 12 ou 13 ja vem com
   * DDI. Fora dessas faixas, devolve o que veio: adivinhar mais do que isso
   * produziria link errado com aparencia de certo.
   */
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }

  return digitos;
}
