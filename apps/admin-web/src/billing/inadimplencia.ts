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
): string | null {
  const numero = apenasDigitos(telefone);

  /**
   * SEM DIGITO NAO HA LINK, apontado pela revisao. `wa.me/?text=...` abre o
   * WhatsApp sem destinatario -- a recepcao clica, o app abre vazio, e ela nao
   * entende o que aconteceu. Devolver `null` faz a tela cair no mesmo caminho
   * de "sem telefone", que ao menos explica.
   */
  if (numero === '') {
    return null;
  }
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

/**
 * Telefone legivel na propria linha da tabela.
 *
 * O PI pediu o numero VISIVEL, e a razao e operacional: a recepcao liga do
 * telefone fixo tanto quanto manda mensagem, e um numero escondido dentro de
 * um link `wa.me` obriga a abrir o WhatsApp so para le-lo.
 *
 * Formata o que reconhece e devolve o resto como veio -- inventar formato para
 * numero estrangeiro ou mal cadastrado produziria um telefone com aparencia de
 * certo e digitos no lugar errado.
 */
export function telefoneLegivel(telefone: string | null): string | null {
  if (telefone === null) {
    return null;
  }

  /**
   * `+` NA ENTRADA E NUMERO INTERNACIONAL -- devolve como veio.
   *
   * DEFEITO ACHADO PELO TESTE, e ele nao era hipotetico: `+1 415 555 0000`
   * tem onze digitos e saia formatado como `(14) 15555-0000`, um telefone
   * brasileiro que nao existe. Contar digitos nao distingue origem; o `+`
   * distingue, e e o unico sinal confiavel que o cadastro guarda.
   */
  if (telefone.trim().startsWith('+') && !telefone.replace(/\D/g, '').startsWith('55')) {
    return telefone;
  }

  const digitos = telefone.replace(/\D/g, '');
  const nacionais = digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;

  if (nacionais.length === 11) {
    return `(${nacionais.slice(0, 2)}) ${nacionais.slice(2, 7)}-${nacionais.slice(7)}`;
  }

  if (nacionais.length === 10) {
    return `(${nacionais.slice(0, 2)}) ${nacionais.slice(2, 6)}-${nacionais.slice(6)}`;
  }

  return telefone;
}

/**
 * Os motivos que explicam POR QUE esta pessoa esta na fila.
 *
 * A tabela anterior repetia colunas; o mockup de retencao que o PI aprovou usa
 * CHIPS de motivo, e a diferenca e grande: "12 dias" e "3a fatura" dizem numa
 * olhada o que tres colunas de numero obrigam a comparar mentalmente.
 *
 * Ordem por severidade, e no maximo tres -- a partir dai o olho para de ler e
 * a linha vira ruido.
 */
export function motivosDaLinha(linha: {
  diasEmAtraso: number;
  situacao: string;
  liberadoAte: string | null;
}): readonly string[] {
  const motivos: string[] = [];

  if (linha.liberadoAte !== null) {
    motivos.push('liberado com prazo');
  }

  motivos.push(linha.diasEmAtraso === 1 ? '1 dia de atraso' : `${String(linha.diasEmAtraso)} dias de atraso`);

  if (linha.situacao === 'BLOQUEADO' && linha.liberadoAte === null) {
    motivos.push('sem acesso à catraca');
  }

  return motivos.slice(0, 3);
}
