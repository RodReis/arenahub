import { Ausente } from './Ausente.js';
import { IconeWhatsApp } from './IconeWhatsApp.js';
import estilos from './Telefone.module.css';

interface Props {
  /** O número como está cadastrado. `null` renderiza `<Ausente />`. */
  readonly numero: string | null;
  /**
   * Mensagem pronta para o WhatsApp. Sem ela, o link abre a conversa vazia.
   *
   * QUEM ESCREVE A MENSAGEM É A TELA, não este componente: "lembrando da
   * fatura 8222" pertence à cobrança, "sua avaliação venceu" pertence à saúde.
   * Um texto genérico aqui obrigaria cada tela a contorná-lo.
   */
  readonly mensagem?: string;
  readonly testId?: string;
}

/**
 * Telefone com atalho para o WhatsApp — DS-PAINEL.md §9.
 *
 * A RECEPÇÃO FALA COM O ALUNO POR WHATSAPP. Exibir o número como texto
 * significa que alguém o copia, abre o aplicativo, cola e digita a mensagem —
 * quatro passos, com um aluno esperando no balcão. O atalho faz os quatro.
 *
 * O NÚMERO CONTINUA VISÍVEL E COPIÁVEL, e isso não é redundância: a academia
 * também liga do telefone fixo, e um botão que só abre o WhatsApp esconderia o
 * dado de quem precisa discá-lo.
 *
 * Nasceu de `linkDeCobranca` + `telefoneLegivel`, que viviam em
 * `apps/admin-web/src/billing/` e serviam uma tela só. A lógica é a mesma em
 * qualquer lugar onde há telefone; o que muda é a mensagem.
 */
export function Telefone({ numero, mensagem, testId }: Props) {
  if (numero === null || numero.trim() === '') {
    return <Ausente />;
  }

  const digitos = numero.replace(/\D/g, '');
  const legivel = formatarTelefone(numero);

  /**
   * SEM DÍGITO NÃO HÁ LINK. `wa.me/?text=...` abre o WhatsApp sem
   * destinatário: a recepção clica, o aplicativo abre vazio, e ela não entende
   * o que aconteceu. Melhor mostrar só o texto — que ao menos é discável.
   */
  if (digitos === '') {
    return <span className={estilos['texto']}>{legivel}</span>;
  }

  const href =
    mensagem === undefined
      ? `https://wa.me/${digitos}`
      : `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`;

  return (
    <a
      className={estilos['link']}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Conversar com ${legivel} no WhatsApp`}
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
    >
      <IconeWhatsApp />
      <span className={estilos['numero']}>{legivel}</span>
    </a>
  );
}

/**
 * Formata para leitura. Devolve o que veio quando não reconhece o formato.
 *
 * `+` NA ENTRADA É NÚMERO INTERNACIONAL — devolve como veio.
 *
 * Defeito achado por teste na F15, e ele não era hipotético: `+1 415 555 0000`
 * tem onze dígitos e saía formatado como `(14) 15555-0000`, um telefone
 * brasileiro que não existe. Contar dígitos não distingue origem; o `+` sim, e
 * é o único sinal confiável que o cadastro guarda.
 */
export function formatarTelefone(telefone: string): string {
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
