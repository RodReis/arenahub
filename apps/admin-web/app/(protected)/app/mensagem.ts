/**
 * Mensagem que a recepcao manda ao aluno com o link do app (#538).
 *
 * Funcao pura: o painel monta a previa e o texto copiado com a MESMA funcao,
 * entao o que a recepcao ve no balao e exatamente o que o aluno recebe.
 */

export const MENSAGEM_PADRAO = `Olá! Baixe o app da {academia} no seu celular Android:
{link}

1. Toque no link e baixe o instalador.
2. Se o celular pedir, permita instalar apps desta origem.
3. Abra o app e toque em "Primeiro acesso" para entrar com o seu CPF.

Qualquer dúvida, fale com a recepção.`;

export interface DadosDaMensagem {
  readonly link: string;
  readonly academia: string;
}

export function montarMensagem(texto: string | null, dados: DadosDaMensagem): string {
  const base = texto?.trim() ? texto : MENSAGEM_PADRAO;
  const montada = base.replaceAll('{academia}', dados.academia).replaceAll('{link}', dados.link);

  // Texto proprio que esqueceu o marcador ainda entrega o link: mensagem de
  // "baixe o app" sem o link e a unica que nao serve para nada.
  return base.includes('{link}') ? montada : `${montada}\n\n${dados.link}`;
}

/**
 * O navegador manda o `<textarea>` com CRLF no envio do formulario. Sem
 * normalizar, o texto padrao nunca bate com `MENSAGEM_PADRAO` e passa a ser
 * gravado como "personalizado" -- e a academia perde as melhorias do padrao.
 */
export function normalizarQuebras(texto: string): string {
  return texto.replace(/\r\n?/g, '\n');
}

/** Abre o WhatsApp com a mensagem pronta; o contato a recepcao escolhe la. */
export function linkDoWhatsApp(mensagem: string): string {
  return `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
}
